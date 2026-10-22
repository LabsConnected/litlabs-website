import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { authorizeOutboundCall, type CallAuthorizationRepo } from "@/lib/voice/call-authorization";
import { createSupabaseCallAuthorizationRepo, type SupabaseLike } from "@/lib/voice/call-authorization-repo.supabase";
import { MockTwilioProvider } from "@/lib/voice/providers/mock-twilio-provider";
import { DEX_TOLL_FREE_CALLER_ID } from "@/lib/voice/dex-call-config";
import { createReplayGuard } from "@/lib/voice/replay-guard";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 1: in-memory, default-deny repo. Used unless DEX_STAGING_REPO_ENABLED
// is exactly "true" — a second, independent gate on top of the real repo's
// own fail-closed behavior (call_kill_switch defaults to enabled=false in
// the migration, and the real supabaseAdmin client itself returns errors
// on every query when SUPABASE_SERVICE_ROLE_KEY isn't configured). Flipping
// this env var alone does not authorize any real call — it only switches
// which repo answers the authorization checks, and both repos deny by
// default.
const phase1Repo: CallAuthorizationRepo = {
  isKillSwitchEngaged: async () => true, // OFF by default: no calls allowed
  hasConsent: async () => false,
  getSpendCapCents: async () => 0,
  getAttemptsToday: async () => 0,
  recordAttempt: async () => {},
};

function getRepo(): CallAuthorizationRepo {
  if (process.env.DEX_STAGING_REPO_ENABLED === "true") {
    // supabaseAdmin's generated type doesn't structurally satisfy the
    // simplified SupabaseLike port (TS's generic PostgrestFilterBuilder
    // chain is too deep to structurally match a hand-written interface).
    // The runtime shape — .from().select().eq().maybeSingle() / .upsert()
    // — is the same chain voice-session-service.ts already calls directly
    // elsewhere in this codebase; this cast only bridges the type gap.
    return createSupabaseCallAuthorizationRepo(supabaseAdmin as unknown as SupabaseLike);
  }
  return phase1Repo;
}

// Exported for tests only, so a test can assert the mock provider was (or
// wasn't) invoked without reaching into module internals another way.
export const __test__mockProvider = new MockTwilioProvider();

// Exported for tests only, so a test can exercise replay behavior without
// waiting out the real window.
export const __test__replayGuard = createReplayGuard();

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.DEX_BRIDGE_SECRET ?? "";
  if (secret.length < 32 || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface CallRequestBody {
  phone: string;
  requestedBy: string;
  estimatedCostCents: number;
  requestId: string;
  timestamp: number;
}

function isValidBody(value: unknown): value is CallRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.phone === "string" &&
    v.phone.length > 0 &&
    typeof v.requestedBy === "string" &&
    typeof v.estimatedCostCents === "number" &&
    typeof v.requestId === "string" &&
    v.requestId.length > 0 &&
    typeof v.timestamp === "number"
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-dex-signature");

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!isValidBody(parsed)) {
    return NextResponse.json(
      { error: "Request body must include phone, requestedBy, estimatedCostCents, requestId, timestamp" },
      { status: 400 },
    );
  }

  const replayResult = __test__replayGuard.check(parsed.requestId, parsed.timestamp);
  if (!replayResult.ok) {
    return NextResponse.json({ error: "Request rejected", reason: replayResult.reason }, { status: 401 });
  }

  const decision = await authorizeOutboundCall(parsed, getRepo());

  if (!decision.allowed) {
    return NextResponse.json({ allowed: false, reason: decision.reason }, { status: 403 });
  }

  const result = await __test__mockProvider.placeCall({
    to: parsed.phone,
    from: DEX_TOLL_FREE_CALLER_ID,
    agentInstructions: "Phase 1 mock call — no real dial performed.",
  });

  return NextResponse.json({ allowed: true, providerCallId: result.providerCallId }, { status: 202 });
}
