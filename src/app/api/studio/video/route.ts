import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { adjustWalletBalance, getCreditBalances } from "@/lib/wallet-ledger";
import { isBillingExempt, getActiveSimulation } from "@/lib/owner";
import {
  getVideoTier,
  type VideoAspectRatio,
} from "@/config/video-tiers";

// ── Idempotency (P1-3) ─────────────────────────────────────────────
// Minimal keyed dedupe scoped to this route. A client-supplied idempotency
// key (`Idempotency-Key` header or `idempotencyKey` body field) maps to the
// completed result: a retry with the same key returns the stored result
// instead of calling the provider or debiting again, so a client retry can
// never double-charge. Completed results are cached in memory with a 24h
// TTL; the wallet ledger's own idempotency key (derived from the client key)
// is the cross-instance backstop — a replayed debit returns 409 instead of
// charging twice. Failures are NOT cached: a retry after a provider failure
// re-attempts the provider (correct retry semantics) and can only ever
// debit once, on success.

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX_ENTRIES = 2000;

type VideoOutcome = {
  status: number;
  body: Record<string, unknown>;
};

type CachedVideoOutcome = VideoOutcome & { expiresAt: number };

const idempotentVideoResults = new Map<string, CachedVideoOutcome>();
const inFlightVideoRequests = new Map<string, Promise<VideoOutcome>>();

function cacheVideoOutcome(scope: string, outcome: VideoOutcome) {
  if (idempotentVideoResults.size >= IDEMPOTENCY_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of idempotentVideoResults) {
      if (entry.expiresAt <= now) idempotentVideoResults.delete(key);
    }
    if (idempotentVideoResults.size >= IDEMPOTENCY_MAX_ENTRIES) {
      const oldest = idempotentVideoResults.keys().next();
      if (!oldest.done) idempotentVideoResults.delete(oldest.value);
    }
  }
  idempotentVideoResults.set(scope, {
    ...outcome,
    expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
  });
}

function getCachedVideoOutcome(scope: string): VideoOutcome | null {
  const entry = idempotentVideoResults.get(scope);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    idempotentVideoResults.delete(scope);
    return null;
  }
  return { status: entry.status, body: entry.body };
}

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      prompt,
      tierId = "draft",
      aspectRatio = "16:9",
      idempotencyKey: bodyIdempotencyKey,
    } = body as {
      prompt?: string;
      tierId?: string;
      aspectRatio?: VideoAspectRatio;
      idempotencyKey?: string;
    };

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return NextResponse.json(
        { error: "Prompt must be at least 3 characters" },
        { status: 400 },
      );
    }

    const tier = getVideoTier(tierId);
    if (!tier) {
      return NextResponse.json(
        { error: `Unknown video tier: ${tierId}` },
        { status: 400 },
      );
    }

    if (!tier.enabled) {
      return NextResponse.json(
        { error: `${tier.name} is coming soon. Try Draft, Quality, or Video with Audio.` },
        { status: 503 },
      );
    }

    // ── P1-3: provider/key checks BEFORE any debit ──
    // Read at request time (not module load) so a missing key fails here —
    // with 0 LiTTBits charged — instead of after the wallet debit.
    const falApiKey = process.env.FAL_KEY || process.env.FAL_API_KEY;
    if (!falApiKey) {
      return NextResponse.json(
        {
          error: "Video provider not configured. Set FAL_KEY environment variable.",
          setup_required: true,
        },
        { status: 503 },
      );
    }

    // ── P1-3: idempotency key from header or body ──
    const headerKey = req.headers.get("Idempotency-Key");
    const rawClientKey =
      (typeof headerKey === "string" && headerKey.trim()) ||
      (typeof bodyIdempotencyKey === "string" && bodyIdempotencyKey.trim()) ||
      "";
    const clientKey = rawClientKey.slice(0, 128) || null;
    const dedupeScope = clientKey ? `${userId}:${clientKey}` : null;

    if (dedupeScope) {
      const cached = getCachedVideoOutcome(dedupeScope);
      if (cached) {
        return NextResponse.json(
          { ...cached.body, replayed: true },
          { status: cached.status },
        );
      }
    }

    // Check billing exemption — owner skips balance check and debit
    const studioVideoSim = await getActiveSimulation().catch(() => null);
    const studioVideoExempt = isBillingExempt(userId, studioVideoSim);

    const runVideoRequest = async (): Promise<VideoOutcome> => {
      let studioBalance: number | null = null;

      if (!studioVideoExempt) {
        // Check balance (fail fast, before any provider spend)
        const balances = await getCreditBalances(userId);
        if (balances.total < tier.priceLiTTBits) {
          return {
            status: 402,
            body: {
              error: `Need ${tier.priceLiTTBits} LiTTBits for ${tier.name}. You have ${balances.total}.`,
              required: tier.priceLiTTBits,
              balance: balances.total,
            },
          };
        }
      }

      // Submit to fal.ai — provider failures charge 0 LiTTBits (no debit yet)
      const falResponse = await fetch("https://fal.run/fal-ai/" + tier.model, {
        method: "POST",
        headers: {
          Authorization: `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: prompt.trim(),
          duration: tier.maxDuration,
          aspect_ratio: aspectRatio,
          resolution: tier.resolution,
        }),
      });

      if (!falResponse.ok) {
        const errText = await falResponse.text().catch(() => "");
        return {
          status: 502,
          body: {
            error: `Video provider error: ${falResponse.status} ${errText.slice(0, 200)}`,
          },
        };
      }

      const result = await falResponse.json();

      // ── P1-3: debit ONLY after the provider succeeded ──
      // Every failure path above returns before any debit, so all provider
      // failures (missing key, non-OK response, thrown network errors) charge
      // 0 LiTTBits and no refund path is needed.
      if (!studioVideoExempt) {
        // Ledger idempotency key derives from the client key when one was
        // provided, so even a retry that missed the result cache (e.g. a
        // different instance) still cannot double-debit.
        const ledgerKey = clientKey
          ? `studio_video_${userId}_${clientKey}`
          : `studio_video_${userId}_${crypto.randomUUID()}`;
        const adjustment = await adjustWalletBalance({
          clerkId: userId,
          amount: -tier.priceLiTTBits,
          type: "spend",
          reason: `Video: ${tier.name} — ${tier.maxDuration}s clip`,
          idempotencyKey: ledgerKey,
        });

        if (adjustment.replayed) {
          return {
            status: 409,
            body: { error: "This video request was already processed." },
          };
        }
        studioBalance = adjustment.balance;
      }

      return {
        status: 200,
        body: {
          tier: tier.id,
          tierName: tier.name,
          model: tier.model,
          cost: tier.priceLiTTBits,
          balance: studioBalance,
          videoUrl: result.video?.url ?? result.url ?? null,
          requestId: result.request_id ?? null,
          status: "completed",
        },
      };
    };

    let outcome: VideoOutcome;
    if (dedupeScope) {
      // Singleflight: a concurrent retry with the same key awaits the
      // in-flight request instead of calling the provider / debiting again.
      const existing = inFlightVideoRequests.get(dedupeScope);
      if (existing) {
        outcome = await existing;
      } else {
        const inFlight = runVideoRequest();
        inFlightVideoRequests.set(dedupeScope, inFlight);
        try {
          outcome = await inFlight;
        } finally {
          inFlightVideoRequests.delete(dedupeScope);
        }
      }
      // Cache only completed successes — failures stay retryable and a
      // retry re-attempts the provider (charging at most once, on success).
      if (outcome.status === 200) cacheVideoOutcome(dedupeScope, outcome);
    } else {
      outcome = await runVideoRequest();
    }

    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Video generation failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = withRateLimit(handler, 60, 60);
