// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  count?: number;
}) {
  return {
    from(table: string) {
      const query: any = {
        select: () => query,
        eq: () => query,
        gte: () => query,
        limit: () => query,
        maybeSingle: async () => {
          if (table === "users") return { data: { id: "internal-1" }, error: null };
          if (table === "subscriptions") return { data: opts.plan ?? null, error: null };
          return { data: null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(
            opts.jobsError
              ? { data: null, error: { message: opts.jobsError }, count: null }
              : {
                  data: opts.rows ?? [],
                  error: null,
                  count: opts.count ?? (opts.rows ?? []).length,
                },
          ).then(resolve, reject),
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
      usage: { ...usage, freeImagesToday: FREE_IMAGE_DAILY_CAP.starter },
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
        usage: { ...usage, freeImagesToday: FREE_IMAGE_DAILY_CAP.owner },
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
});
