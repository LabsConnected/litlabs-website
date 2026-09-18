import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAdmin } = vi.hoisted(() => ({ getAdmin: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: getAdmin }));

import { claimGenerationJob } from "@/lib/generation/jobs";

const input = {
  id: "job-1",
  userId: "user-1",
  modality: "image" as const,
  provider: "pollinations",
  model: "default",
  prompt: "sunset",
  requestId: "agent:call-1",
  littBitsCharged: 0,
};

function job(status: string) {
  return {
    id: "job-1", user_id: "user-1", modality: "image", provider: "pollinations", model: "default",
    status, prompt: "sunset", request_id: input.requestId, provider_job_id: null,
    actual_provider_cost_cents: null, littbits_charged: 0, refund_status: "none",
    asset_id: null, error: null, metadata: {}, created_at: new Date().toISOString(), completed_at: null,
  };
}

function insertBuilder(result: unknown, error: { code?: string; message?: string } | null = null) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["insert", "update", "eq", "select"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: result, error }));
  return builder;
}

describe("generation job durable claim", () => {
  beforeEach(() => getAdmin.mockReset());

  it("claims before provider work and rejects a concurrent duplicate", async () => {
    const first = insertBuilder(job("generating"));
    getAdmin.mockReturnValue({ from: vi.fn(() => first) });
    const owner = await claimGenerationJob(input);
    expect(owner.claimed).toBe(true);
    expect(first.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "generating", request_id: input.requestId }));

    const duplicate = insertBuilder(null, { code: "23505", message: "duplicate" });
    const existing = insertBuilder(job("generating"));
    const from = vi.fn()
      .mockReturnValueOnce(duplicate)
      .mockReturnValueOnce(existing);
    getAdmin.mockReturnValue({ from });
    const loser = await claimGenerationJob({ ...input, id: "job-2" });
    expect(loser.claimed).toBe(false);
    expect(loser.job?.status).toBe("generating");
  });

  it("reclaims only an explicitly retried failed operation", async () => {
    const retryUpdate = insertBuilder(job("generating"));
    getAdmin.mockReturnValue({ from: vi.fn(() => retryUpdate) });
    const result = await claimGenerationJob(input, true);
    expect(result.claimed).toBe(true);
    expect(retryUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ status: "generating", error: null }));
    expect(retryUpdate.eq).toHaveBeenCalledWith("status", "failed");
  });
});
