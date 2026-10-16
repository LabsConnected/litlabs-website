// @vitest-environment node
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderCostCents, pricedGenerationInputs } from "@/lib/generation/cost-engine";
import { PLAN_MEDIA_MONTHLY_CAPS } from "@/lib/generation/media-caps";
import type { GenerationUsageRow } from "@/lib/generation/enforce-media-caps";

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase";
import {
  assertGenerationWithinPlanCaps,
  evaluateMediaCap,
  FREE_IMAGE_DAILY_CAP,
  summarizeMediaUsage,
} from "@/lib/generation/enforce-media-caps";

const NOW = new Date("2026-10-15T18:00:00.000Z");

function row(overrides: Partial<GenerationUsageRow> = {}): GenerationUsageRow {
  return {
    modality: "image",
    provider: "gemini",
    model: "gemini-3-pro-image",
    status: "completed",
    refund_status: "none",
    actual_provider_cost_cents: 8,
    created_at: "2026-10-02T00:00:00.000Z",
    request_id: "job",
    metadata: {},
    ...overrides,
  };
}

function admin(opts: {
  plan?: { plan: string; status: string } | null;
  rows?: GenerationUsageRow[];
  jobsError?: string;
  user?: { id: string } | null;
  now?: Date;
}) {
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name !== "claim_media_cap_slot") {
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    }
    if (opts.jobsError) return { data: null, error: { message: opts.jobsError } };
    const planId = (opts.plan?.plan ?? "starter") as "creator_beta";
    const usage = summarizeMediaUsage(
      opts.rows ?? [],
      opts.now ?? NOW,
      String(params.p_request_id ?? ""),
    );
    const decision = evaluateMediaCap({
      planId,
      modality: params.p_modality as "image",
      provider: String(params.p_provider),
      model: String(params.p_model),
      providerCostCents: Number(params.p_provider_cost_cents),
      usage,
      billingExempt: params.p_billing_exempt === true,
      units: Number(params.p_units ?? 1),
    });
    if (!decision) return { data: { allowed: true }, error: null };
    return {
      data: {
        allowed: false,
        status: decision.status,
        reason: decision.reason,
        error: decision.error,
      },
      error: null,
    };
  });
  return {
    rpc,
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        limit: () => query,
        maybeSingle: async () => {
          if (table === "users") {
            if (opts.user === null) return { data: null, error: null };
            return { data: opts.user ?? { id: "internal-1" }, error: null };
          }
          if (table === "subscriptions") return { data: opts.plan ?? null, error: null };
          return { data: null, error: null };
        },
      };
      return query;
    },
  };
}

describe("evaluateMediaCap", () => {
  const creator = PLAN_MEDIA_MONTHLY_CAPS.creator_beta;
  const usage = {
    imagesThisMonth: 0,
    videosThisMonth: 0,
    providerSpendCentsThisMonth: 0,
    freeImagesToday: 0,
    freeModelsToday: 0,
  };

  it("blocks the next paid image, video, and provider cent past the plan cap", () => {
    expect(
      evaluateMediaCap({
        planId: "creator_beta",
        modality: "image",
        provider: "gemini",
        model: "gemini-3-pro-image",
        providerCostCents: 8,
        usage: { ...usage, imagesThisMonth: creator.maxImages },
      })?.reason,
    ).toBe("monthly_image_cap");

    expect(
      evaluateMediaCap({
        planId: "creator_beta",
        modality: "video",
        provider: "veo",
        model: "veo-3.1-fast-generate-preview",
        providerCostCents: 40,
        usage: { ...usage, videosThisMonth: creator.maxVideos },
      })?.reason,
    ).toBe("monthly_video_cap");

    const spend = evaluateMediaCap({
      planId: "creator_beta",
      modality: "music",
      provider: "google",
      model: "lyria-3-clip-preview",
      providerCostCents: 8,
      usage: { ...usage, providerSpendCentsThisMonth: creator.maxProviderSpendCents },
    });
    expect(spend?.status).toBe(402);
    expect(spend?.reason).toBe("provider_spend_cap");
    expect(spend?.code).toBe("plan_limit");
  });

  it("allows a call that still fits, including music that only spends", () => {
    expect(
      evaluateMediaCap({
        planId: "pro_builder_beta",
        modality: "music",
        provider: "google",
        model: "lyria-3-pro-preview",
        providerCostCents: 8,
        usage,
      }),
    ).toBeNull();
  });

  it("gives free image models a per-plan daily cap instead of the paid image count", () => {
    expect(FREE_IMAGE_DAILY_CAP.starter).toBe(8);
    expect(FREE_IMAGE_DAILY_CAP.creator_beta).toBe(25);
    expect(FREE_IMAGE_DAILY_CAP.pro_builder_beta).toBe(50);
    expect(FREE_IMAGE_DAILY_CAP.founder).toBe(12);
    expect(FREE_IMAGE_DAILY_CAP.owner).toBe(40);

    expect(
      evaluateMediaCap({
        planId: "starter",
        modality: "image",
        provider: "pollinations",
        model: "flux",
        providerCostCents: 0,
        usage,
      }),
    ).toBeNull();

    const blocked = evaluateMediaCap({
      planId: "starter",
      modality: "image",
      provider: "cloudflare",
      model: "flux-1-schnell",
      providerCostCents: 0,
      usage: {
        ...usage,
        freeImagesToday: FREE_IMAGE_DAILY_CAP.starter,
        freeModelsToday: FREE_IMAGE_DAILY_CAP.starter,
      },
    });
    expect(blocked?.status).toBe(429);
    expect(blocked?.reason).toBe("free_model_daily_cap");

    expect(
      evaluateMediaCap({
        planId: "starter",
        modality: "image",
        provider: "gemini",
        model: "gemini-3-pro-image",
        providerCostCents: 8,
        usage,
      })?.reason,
    ).toBe("monthly_image_cap");
  });

  it("still applies the free daily cap to a billing-exempt caller", () => {
    expect(
      evaluateMediaCap({
        planId: "owner",
        modality: "image",
        provider: "gemini",
        model: "gemini-3-pro-image",
        providerCostCents: 8,
        usage: { ...usage, imagesThisMonth: 1000, providerSpendCentsThisMonth: 100000 },
        billingExempt: true,
      }),
    ).toBeNull();

    expect(
      evaluateMediaCap({
        planId: "owner",
        modality: "image",
        provider: "together",
        model: "flux-1-schnell-free",
        providerCostCents: 0,
        usage: {
          ...usage,
          freeImagesToday: FREE_IMAGE_DAILY_CAP.owner,
          freeModelsToday: FREE_IMAGE_DAILY_CAP.owner,
        },
        billingExempt: true,
      })?.reason,
    ).toBe("free_model_daily_cap");
  });
});

describe("summarizeMediaUsage", () => {
  it("counts this month's paid jobs and today's free images, skipping failures and refunds", () => {
    const usage = summarizeMediaUsage(
      [
        row(),
        row({
          request_id: "free-today",
          provider: "pollinations",
          model: "flux",
          actual_provider_cost_cents: 0,
          created_at: "2026-10-15T02:00:00.000Z",
        }),
        row({
          request_id: "free-yesterday",
          provider: "together",
          model: "flux-1-schnell-free",
          actual_provider_cost_cents: 0,
          created_at: "2026-10-14T02:00:00.000Z",
        }),
        row({ request_id: "failed", status: "failed" }),
        row({ request_id: "refunded", modality: "video", refund_status: "refunded" }),
        row({ request_id: "self", modality: "video", provider: "veo", model: "veo-3.1-fast-generate-preview" }),
      ],
      NOW,
      "self",
    );
    expect(usage.imagesThisMonth).toBe(1);
    expect(usage.videosThisMonth).toBe(0);
    expect(usage.freeImagesToday).toBe(1);
    expect(usage.freeModelsToday).toBe(1);
    expect(usage.providerSpendCentsThisMonth).toBe(8);
  });
});

describe("assertGenerationWithinPlanCaps", () => {
  beforeEach(() => {
    vi.mocked(getSupabaseAdmin).mockReset();
  });

  it("reads the subscription and this month's jobs before allowing the call", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      admin({
        plan: { plan: "creator_beta", status: "active" },
        rows: Array.from({ length: PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages }, (_, i) =>
          row({ request_id: `img-${i}` }),
        ),
      }) as any,
    );
    const denial = await assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId: "new",
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
      providerCostCents: 8,
      now: NOW,
    });
    expect(denial?.status).toBe(429);
    expect(denial?.code).toBe("plan_limit");
    expect(denial?.reason).toBe("monthly_image_cap");
  });

  it("does not count the in-flight row for this request", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      admin({
        plan: { plan: "creator_beta", status: "active" },
        rows: [row({ request_id: "same" })],
      }) as any,
    );
    const denial = await assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId: "same",
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
      providerCostCents: 8,
      now: NOW,
    });
    expect(denial).toBeNull();
  });

  it("returns 402 plan_limit when usage cannot be read", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(null);
    const missing = await assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      modality: "video",
      provider: "veo",
      model: "veo-3.1-fast-generate-preview",
      providerCostCents: 40,
    });
    expect(missing).toMatchObject({ status: 402, code: "plan_limit", reason: "usage_unavailable" });

    vi.mocked(getSupabaseAdmin).mockReturnValue(
      admin({ plan: { plan: "creator_beta", status: "active" }, jobsError: "ledger down" }) as any,
    );
    const failed = await assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      modality: "video",
      provider: "veo",
      model: "veo-3.1-fast-generate-preview",
      providerCostCents: 40,
    });
    expect(failed?.reason).toBe("usage_unavailable");
  });

  it("fails closed when the clerk has no user row to lock", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      admin({ plan: { plan: "starter", status: "active" }, user: null }) as any,
    );
    const denial = await assertGenerationWithinPlanCaps({
      clerkId: "clerk_missing",
      modality: "image",
      provider: "pollinations",
      model: "flux",
      providerCostCents: 0,
      now: NOW,
    });
    expect(denial).toMatchObject({ status: 402, reason: "usage_unavailable" });
  });
});

describe("every catalog model is capped", () => {
  const creator = PLAN_MEDIA_MONTHLY_CAPS.creator_beta;
  const starter = PLAN_MEDIA_MONTHLY_CAPS.starter;
  const empty = {
    imagesThisMonth: 0,
    videosThisMonth: 0,
    providerSpendCentsThisMonth: 0,
    freeImagesToday: 0,
    freeModelsToday: 0,
  };

  it("denies each priced model once its plan ceiling is exhausted, and allows the call under it", () => {
    const inputs = pricedGenerationInputs();
    expect(inputs.length).toBeGreaterThan(20);
    for (const input of inputs) {
      const cents = getProviderCostCents(input);
      const label = `${input.modality} ${input.provider}:${input.model}`;
      const under = { ...empty };
      const over = { ...empty };
      if (cents <= 0) {
        under.freeModelsToday = FREE_IMAGE_DAILY_CAP.creator_beta - 1;
        over.freeModelsToday = FREE_IMAGE_DAILY_CAP.creator_beta;
      } else if (input.modality === "image") {
        under.imagesThisMonth = creator.maxImages - 1;
        over.imagesThisMonth = creator.maxImages;
      } else if (input.modality === "video") {
        under.videosThisMonth = creator.maxVideos - 1;
        over.videosThisMonth = creator.maxVideos;
      } else {
        under.providerSpendCentsThisMonth = creator.maxProviderSpendCents - cents;
        over.providerSpendCentsThisMonth = creator.maxProviderSpendCents;
      }
      expect(evaluateMediaCap({
        planId: "creator_beta",
        modality: input.modality,
        provider: input.provider,
        model: input.model,
        providerCostCents: cents,
        usage: under,
      }), label).toBeNull();
      expect(evaluateMediaCap({
        planId: "creator_beta",
        modality: input.modality,
        provider: input.provider,
        model: input.model,
        providerCostCents: cents,
        usage: over,
      }), label).not.toBeNull();
    }
  });

  it("caps paid starter calls at zero and still gives free models the daily cap", () => {
    expect(starter.maxImages).toBe(0);
    expect(starter.maxVideos).toBe(0);
    expect(starter.maxProviderSpendCents).toBe(0);
    for (const input of pricedGenerationInputs()) {
      const cents = getProviderCostCents(input);
      const decision = evaluateMediaCap({
        planId: "starter",
        modality: input.modality,
        provider: input.provider,
        model: input.model,
        providerCostCents: cents,
        usage: empty,
      });
      if (cents <= 0) {
        expect(decision).toBeNull();
      } else {
        expect(decision?.code).toBe("plan_limit");
      }
    }
    expect(evaluateMediaCap({
      planId: "starter",
      modality: "music",
      provider: "mock",
      model: "mock",
      providerCostCents: 0,
      usage: { ...empty, freeModelsToday: FREE_IMAGE_DAILY_CAP.starter },
    })?.reason).toBe("free_model_daily_cap");
  });
});

describe("parallel generation reservations", () => {
  function serialAdmin(seed: GenerationUsageRow[]) {
    const holds = [...seed];
    let tail = Promise.resolve();
    const rpc = vi.fn((name: string, params: Record<string, unknown>) => {
      const run = async () => {
        if (name !== "claim_media_cap_slot") {
          return { data: null, error: { message: `unexpected rpc ${name}` } };
        }
        const usage = summarizeMediaUsage(holds, NOW, String(params.p_request_id ?? ""));
        const decision = evaluateMediaCap({
          planId: "creator_beta",
          modality: params.p_modality as "image",
          provider: String(params.p_provider),
          model: String(params.p_model),
          providerCostCents: Number(params.p_provider_cost_cents),
          usage,
          billingExempt: params.p_billing_exempt === true,
          units: Number(params.p_units ?? 1),
        });
        if (decision) {
          return {
            data: {
              allowed: false,
              status: decision.status,
              reason: decision.reason,
              error: decision.error,
            },
            error: null,
          };
        }
        holds.push(row({
          request_id: String(params.p_request_id),
          modality: String(params.p_modality),
          provider: String(params.p_provider),
          model: String(params.p_model),
          actual_provider_cost_cents: params.p_free_model === true ? 0 : Number(params.p_provider_cost_cents),
          units: Number(params.p_units ?? 1),
          created_at: NOW.toISOString(),
        }));
        return { data: { allowed: true }, error: null };
      };
      const next = tail.then(run, run);
      tail = next.then(() => undefined, () => undefined);
      return next;
    });
    return {
      holds,
      rpc,
      from(table: string) {
        const query: any = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => {
            if (table === "users") return { data: { id: "internal-1" }, error: null };
            if (table === "subscriptions") {
              return { data: { plan: "creator_beta", status: "active" }, error: null };
            }
            return { data: null, error: null };
          },
        };
        return query;
      },
    };
  }

  beforeEach(() => {
    vi.mocked(getSupabaseAdmin).mockReset();
  });

  it("lets exactly one of two parallel image calls take the last monthly slot", async () => {
    const cap = PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages;
    const client = serialAdmin(
      Array.from({ length: cap - 1 }, (_, i) => row({ request_id: `seed-${i}` })),
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(client as any);
    const call = (requestId: string) => assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId,
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
      providerCostCents: 8,
      now: NOW,
    });
    const [first, second] = await Promise.all([call("race-a"), call("race-b")]);
    const results = [first, second];
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result?.reason === "monthly_image_cap")).toHaveLength(1);
    expect(client.holds).toHaveLength(cap);
  });

  it("denies both parallel calls when the image cap is already exhausted", async () => {
    const cap = PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxImages;
    const client = serialAdmin(
      Array.from({ length: cap }, (_, i) => row({ request_id: `full-${i}` })),
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(client as any);
    const call = (requestId: string) => assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId,
      modality: "image",
      provider: "gemini",
      model: "gemini-3-pro-image",
      providerCostCents: 8,
      now: NOW,
    });
    const [first, second] = await Promise.all([call("full-a"), call("full-b")]);
    expect(first?.reason).toBe("monthly_image_cap");
    expect(second?.reason).toBe("monthly_image_cap");
    expect(client.holds).toHaveLength(cap);
  });

  it("lets exactly one of two parallel free-model calls take the last daily slot", async () => {
    const daily = FREE_IMAGE_DAILY_CAP.creator_beta;
    const client = serialAdmin(
      Array.from({ length: daily - 1 }, (_, i) => row({
        request_id: `free-${i}`,
        provider: "pollinations",
        model: "flux",
        actual_provider_cost_cents: 0,
        created_at: "2026-10-15T01:00:00.000Z",
      })),
    );
    vi.mocked(getSupabaseAdmin).mockReturnValue(client as any);
    const call = (requestId: string) => assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId,
      modality: "image",
      provider: "cloudflare",
      model: "flux-1-schnell",
      providerCostCents: 0,
      now: NOW,
    });
    const [first, second] = await Promise.all([call("free-a"), call("free-b")]);
    const results = [first, second];
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result?.reason === "free_model_daily_cap")).toHaveLength(1);
  });

  it("lets exactly one of two parallel music calls take the last spend cent", async () => {
    const cap = PLAN_MEDIA_MONTHLY_CAPS.creator_beta.maxProviderSpendCents;
    const client = serialAdmin([
      row({
        request_id: "spent",
        modality: "music",
        provider: "google",
        model: "lyria-3-clip-preview",
        actual_provider_cost_cents: cap - 4,
      }),
    ]);
    vi.mocked(getSupabaseAdmin).mockReturnValue(client as any);
    const call = (requestId: string) => assertGenerationWithinPlanCaps({
      clerkId: "clerk_creator",
      requestId,
      modality: "music",
      provider: "google",
      model: "lyria-3-clip-preview",
      providerCostCents: 4,
      now: NOW,
    });
    const [first, second] = await Promise.all([call("music-a"), call("music-b")]);
    const results = [first, second];
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.filter((result) => result?.status === 402 && result.reason === "provider_spend_cap")).toHaveLength(1);
  });
});

describe("claim_media_cap_slot migration", () => {
  const sql = readFileSync(
    "supabase/migrations/20261015120000_media_cap_holds.sql",
    "utf8",
  );

  it("locks per user and returns the same plan_limit reasons the runtime uses", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("claim_media_cap_slot");
    expect(sql).toContain("release_media_cap_hold");
    for (const reason of [
      "monthly_image_cap",
      "monthly_video_cap",
      "provider_spend_cap",
      "free_model_daily_cap",
    ]) {
      expect(sql).toContain(reason);
    }
    for (const model of [
      "cloudflare:flux-1-schnell",
      "together:flux-1-schnell-free",
      "pollinations:flux",
    ]) {
      expect(sql).toContain(model);
    }
    expect(sql).toContain("request_id <> p_request_id");
  });

  it("expires unsettled holds and settles successful ones", () => {
    const expiry = readFileSync(
      "supabase/migrations/20261015180000_media_cap_hold_expiry.sql",
      "utf8",
    );
    expect(expiry).toContain("settled_at");
    expect(expiry).toContain("settle_media_cap_hold");
    expect(expiry).toContain("sweep_expired_media_cap_holds");
    expect(expiry).toContain("interval '24 hours'");
    expect(expiry).toContain("failed");
  });
});
