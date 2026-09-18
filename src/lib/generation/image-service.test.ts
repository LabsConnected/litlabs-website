// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the shared image generation service
 * (src/lib/generation/image-service.ts) with injected fakes.
 *
 * These pin the billing + idempotency contract from the 2026-09-18
 * re-fix spec:
 *   - no provider success → no debit, ever
 *   - the same logical operation (stable requestId) → at most one
 *     provider generation and one debit; duplicates replay or collapse
 *   - identity comes only from trusted server-side context — the input
 *     type has no userId field, so a client can never supply one
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media", () => ({
  getProvider: (id: string) => {
    if (id === "pollinations") {
      return {
        id: "pollinations",
        label: "Pollinations",
        supportedFormats: ["image"],
        cost: () => 0,
        free: true,
      };
    }
    if (id === "gemini") {
      return {
        id: "gemini",
        label: "Gemini",
        supportedFormats: ["image"],
        cost: () => 50,
        free: false,
      };
    }
    return undefined;
  },
}));
vi.mock("@/lib/generation/cost-engine", () => ({
  calculateRetailBits: () => ({ providerCostCents: 2, retailLiTTBits: 50 }),
}));

import {
  generateImage,
  type ImageServiceDeps,
  type ImageGenerationInput,
} from "./image-service";
import type { GenerationJob } from "./types";

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job_1",
    userId: "internal_1",
    modality: "image",
    provider: "gemini",
    model: "gemini-3.1-flash-lite-image",
    status: "processing",
    prompt: "a sunny dog park",
    requestId: "op_1",
    providerJobId: null,
    actualProviderCostCents: null,
    littBitsCharged: 50,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ImageServiceDeps> = {}) {
  const jobs = new Map<string, GenerationJob>();
  const calls = {
    dispatch: 0,
    debit: [] as Array<{ amount: number; key: string }>,
    create: 0,
    setStatus: [] as Array<{ jobId: string; status: string }>,
  };
  const deps: ImageServiceDeps = {
    resolveInternalUserId: async () => "internal_1",
    getJobByRequestId: async (_uid, requestId) => jobs.get(requestId) ?? null,
    createJob: async (input) => {
      calls.create++;
      if (jobs.has(input.requestId!)) return null; // unique conflict → race lost
      const job = makeJob({
        id: input.id!,
        userId: input.userId,
        provider: input.provider,
        model: input.model ?? "m",
        prompt: input.prompt,
        requestId: input.requestId!,
        littBitsCharged: input.littBitsCharged ?? 0,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        status: "queued",
      });
      jobs.set(input.requestId!, job);
      return job;
    },
    setJobStatus: async (jobId, status) => {
      calls.setStatus.push({ jobId, status });
      for (const job of jobs.values()) {
        if (job.id === jobId) job.status = status as GenerationJob["status"];
      }
    },
    updateJobMetadata: async (jobId, updates) => {
      for (const job of jobs.values()) {
        if (job.id === jobId) job.metadata = { ...job.metadata, ...updates };
      }
    },
    getBalances: async () => ({ total: 1000 }),
    debit: async (_clerkId, amount, _reason, key) => {
      calls.debit.push({ amount, key });
      return { balance: 1000 - amount };
    },
    isBillingExempt: async () => false,
    persistImage: async (_uid, url) => url,
    dispatch: async (_providerId, _input, prompt) => {
      calls.dispatch++;
      return {
        id: "res_1",
        status: 200,
        title: prompt.slice(0, 60),
        format: "image" as const,
        downloadUrl: "https://provider/x.png",
      };
    },
    ...overrides,
  };
  return { deps, calls, jobs };
}

const paidInput: ImageGenerationInput = { prompt: "a sunny dog park", providerId: "gemini" };
const freeInput: ImageGenerationInput = { prompt: "a sunny dog park", providerId: "pollinations" };

describe("generateImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed without a trusted user id — no dispatch, no debit", async () => {
    const { deps, calls } = makeDeps();
    const result = await generateImage({ userId: "" }, paidInput, deps);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("UNAUTHORIZED");
    expect(calls.dispatch).toBe(0);
    expect(calls.debit).toHaveLength(0);
  });

  it("happy path: generates, debits exactly once with an idempotent key", async () => {
    const { deps, calls } = makeDeps();
    const result = await generateImage(
      { userId: "user_abc", projectId: "proj_1", requestId: "op_1" },
      paidInput,
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.downloadUrl).toBe("https://provider/x.png");
      expect(result.cost).toBe(50);
      expect(result.balance).toBe(950);
    }
    expect(calls.dispatch).toBe(1);
    expect(calls.debit).toHaveLength(1);
    expect(calls.debit[0]).toMatchObject({ amount: 50, key: "image:charge:op_1" });
  });

  it("replays a completed operation — no second generation, no second debit", async () => {
    const { deps, calls, jobs } = makeDeps();
    jobs.set(
      "op_1",
      makeJob({
        status: "completed",
        metadata: { durableUrl: "https://r2/x.png", chargedBits: 50 },
      }),
    );

    const result = await generateImage({ userId: "user_abc", requestId: "op_1" }, paidInput, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.replayed).toBe(true);
      expect(result.downloadUrl).toBe("https://r2/x.png");
      expect(result.cost).toBe(50);
    }
    expect(calls.dispatch).toBe(0);
    expect(calls.debit).toHaveLength(0);
  });

  it("collapses a duplicate in-flight claim — no second generation, no debit", async () => {
    const { deps, calls, jobs } = makeDeps();
    jobs.set("op_1", makeJob({ status: "processing" }));

    const result = await generateImage({ userId: "user_abc", requestId: "op_1" }, paidInput, deps);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("DUPLICATE_IN_FLIGHT");
      expect(result.retryable).toBe(true);
    }
    expect(calls.dispatch).toBe(0);
    expect(calls.debit).toHaveLength(0);
  });

  it("reuses a failed claim for a controlled retry — one generation, one debit", async () => {
    const { deps, calls, jobs } = makeDeps();
    jobs.set("op_1", makeJob({ status: "failed", error: "boom" }));

    const result = await generateImage({ userId: "user_abc", requestId: "op_1" }, paidInput, deps);

    expect(result.success).toBe(true);
    // The existing row is reused — no second claim row is created.
    expect(calls.create).toBe(0);
    expect(calls.dispatch).toBe(1);
    expect(calls.debit).toHaveLength(1);
    expect(calls.debit[0].key).toBe("image:charge:op_1");
  });

  it("never debits when the provider fails — and marks the job failed", async () => {
    const { deps, calls } = makeDeps({
      dispatch: async () => {
        calls.dispatch++;
        throw new Error("provider exploded");
      },
    });

    const result = await generateImage({ userId: "user_abc", requestId: "op_2" }, paidInput, deps);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("PROVIDER_ERROR");
    expect(calls.debit).toHaveLength(0);
    expect(calls.setStatus.map((s) => s.status)).toContain("failed");
  });

  it("does not dispatch when the wallet cannot cover the cost", async () => {
    const { deps, calls } = makeDeps({ getBalances: async () => ({ total: 10 }) });

    const result = await generateImage({ userId: "user_abc", requestId: "op_3" }, paidInput, deps);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("INSUFFICIENT_FUNDS");
    expect(calls.dispatch).toBe(0);
    expect(calls.debit).toHaveLength(0);
  });

  it("free providers skip the balance check and the debit entirely", async () => {
    const { deps, calls } = makeDeps({
      getBalances: async () => {
        throw new Error("wallet should not be consulted");
      },
    });

    const result = await generateImage({ userId: "user_abc", requestId: "op_4" }, freeInput, deps);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.free).toBe(true);
      expect(result.cost).toBe(0);
    }
    expect(calls.dispatch).toBe(1);
    expect(calls.debit).toHaveLength(0);
  });
});
