// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Regression tests for the 2026-11-11 production failure:
 * the Image Studio pane defaults to a PINNED provider ("openai"), and a
 * present-but-dead key (HTTP 401 from the provider) made the manual
 * dispatch path terminal — the request died with PROVIDER_ERROR (HTTP
 * 422 at the route) even though other configured providers (Gemini)
 * were healthy. A pinned provider whose credential is absent or
 * rejected is not actually configured; generation must fall through
 * the configured auto-quality chain instead of dying on the dead key.
 * Non-auth failures keep the pin's semantics (terminal, no fallthrough).
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media", () => ({
  getProvider: (id: string) => {
    const known: Record<string, unknown> = {
      openai: { id: "openai", label: "OpenAI", supportedFormats: ["image"], cost: () => 50, free: false },
      gemini: { id: "gemini", label: "Gemini", supportedFormats: ["image"], cost: () => 50, free: false },
      fal: { id: "fal", label: "FAL", supportedFormats: ["image"], cost: () => 50, free: false },
    };
    return known[id];
  },
}));
vi.mock("@/lib/generation/cost-engine", () => ({
  calculateRetailBits: () => ({ providerCostCents: 2, retailLiTTBits: 50 }),
}));

import type { ImageServiceDeps } from "./image-service";
import type { GenerationJob } from "./types";

type GenerateImageFn = typeof import("./image-service").generateImage;
let generateImage: GenerateImageFn;

beforeAll(async () => {
  // Module-level key consts are read at import time: stub the env
  // BEFORE importing the service. OpenAI + Gemini keys present (as in
  // production); FAL/Recraft absent so the auto-quality chain is
  // exactly [openai, gemini].
  vi.stubEnv("OPENAI_API_KEY", "sk-test-dead-key");
  vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
  vi.stubEnv("FAL_API_KEY", "");
  vi.stubEnv("RECRAFT_API_KEY", "");
  ({ generateImage } = await import("./image-service"));
});

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job_1",
    userId: "internal_1",
    modality: "image",
    provider: "openai",
    model: "gpt-image-1",
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

function makeDeps(dispatchImpl: ImageServiceDeps["dispatch"]) {
  const jobs = new Map<string, GenerationJob>();
  const calls = {
    dispatched: [] as string[],
    debit: [] as Array<{ amount: number; key: string }>,
  };
  const deps: ImageServiceDeps = {
    resolveInternalUserId: async () => "internal_1",
    getJobByRequestId: async (_uid, requestId) => jobs.get(requestId) ?? null,
    createJob: async (input) => {
      if (jobs.has(input.requestId!)) return null;
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
    dispatch: async (providerId, input, prompt) => {
      calls.dispatched.push(providerId);
      return dispatchImpl(providerId, input, prompt);
    },
  };
  return { deps, calls };
}

const okResult = (prompt: string) => ({
  id: "res_1",
  status: 200,
  title: prompt.slice(0, 60),
  format: "image" as const,
  downloadUrl: "https://provider/x.png",
});

describe("generateImage — pinned provider with a dead key (production 2026-11-11)", () => {
  it("falls through to Gemini when the pinned OpenAI key is rejected (401) and completes", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") {
        throw new Error(
          'OpenAI error: {"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}',
        );
      }
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_dead_key" },
      { prompt: "a sunny dog park", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("gemini");
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    // Exactly one debit, for the provider that actually served.
    expect(calls.debit).toHaveLength(1);
  });

  it("falls through when the pinned provider's key is missing entirely", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") {
        throw new Error("OpenAI key missing — set OPENAI_API_KEY");
      }
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_missing_key" },
      { prompt: "a sunny dog park", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("gemini");
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
  });

  it("keeps the pin terminal for a non-auth provider failure — no fallthrough", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") {
        throw new Error("OpenAI error: content policy rejection");
      }
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_policy" },
      { prompt: "a sunny dog park", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("PROVIDER_ERROR");
    expect(calls.dispatched).toEqual(["openai"]);
    expect(calls.debit).toHaveLength(0);
  });

  it("is bounded: when every configured provider rejects its credential the failure is terminal", async () => {
    const { deps, calls } = makeDeps(async (providerId) => {
      if (providerId === "openai") {
        throw new Error("OpenAI error: Incorrect API key provided");
      }
      throw new Error("Gemini error: API key not valid");
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_all_dead" },
      { prompt: "a sunny dog park", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("PROVIDER_ERROR");
    // Each configured provider tried at most once — no retry loop.
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    expect(calls.debit).toHaveLength(0);
  });
});
