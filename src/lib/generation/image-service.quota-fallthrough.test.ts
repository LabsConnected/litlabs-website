// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Regression tests for the 2026-11-11 production battery (build
 * f9ad12cd), TEST 1: the chat-routed Image Studio flow pinned
 * "OpenAI GPT Image", production's OpenAI key had no quota, and
 * generation died with "openai quota exceeded" — NO fallthrough —
 * even though other configured providers were healthy. PR #900 made
 * CONFIG-class failures (401 / missing key) of a pinned provider fall
 * through the chain; QUOTA-class failures (429 / quota / rate limit)
 * were excluded from that classifier and stayed terminal.
 *
 * A quota-exhausted provider cannot serve the request right now, but
 * the chain can — quota failures must fall through exactly like
 * config failures: bounded (each configured provider tried at most
 * once), one debit on success (for the provider that served), no
 * debit on failure, and when every provider fails the surfaced error
 * must name what was tried.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media", () => ({
  getProvider: (id: string) => {
    const known: Record<string, unknown> = {
      openai: { id: "openai", label: "OpenAI", supportedFormats: ["image"], cost: () => 50, free: false },
      gemini: { id: "gemini", label: "Gemini", supportedFormats: ["image"], cost: () => 50, free: false },
      cloudflare: { id: "cloudflare", label: "Cloudflare", supportedFormats: ["image"], cost: () => 0, free: true },
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
  // BEFORE importing the service. OpenAI + Gemini + Cloudflare
  // configured (as in production); FAL/Recraft/Alibaba absent, so:
  //   auto-quality chain = [openai, gemini]
  //   auto-free chain    = [openai, cloudflare]
  vi.stubEnv("OPENAI_API_KEY", "sk-test-no-quota");
  vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "cf-acct");
  vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "cf-token");
  vi.stubEnv("FAL_API_KEY", "");
  vi.stubEnv("RECRAFT_API_KEY", "");
  vi.stubEnv("ALIBABA_DASHSCOPE_API_KEY", "");
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
    prompt: "a small coffee shop logo",
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

const OPENAI_QUOTA = new Error(
  'OpenAI error: {"error":{"message":"You exceeded your current quota, please check your plan and billing details","code":"insufficient_quota"}}',
);

describe("generateImage — pinned provider out of quota (production battery 2026-11-11)", () => {
  it("falls through to the next configured provider when the pinned provider is out of quota", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") throw OPENAI_QUOTA;
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_quota_fallthrough" },
      { prompt: "a small coffee shop logo", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("gemini");
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    // Exactly one debit, for the provider that actually served.
    expect(calls.debit).toHaveLength(1);
  });

  it("falls through on an HTTP 429 from the pinned provider", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") {
        throw new Error("OpenAI error: 429 Too Many Requests");
      }
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_429_fallthrough" },
      { prompt: "a small coffee shop logo", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("gemini");
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    expect(calls.debit).toHaveLength(1);
  });

  it("falls through on a rate-limit message from the pinned provider", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") {
        throw new Error("OpenAI error: Rate limit reached for gpt-image-1");
      }
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_ratelimit_fallthrough" },
      { prompt: "a small coffee shop logo", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("gemini");
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
  });

  it("when every configured provider is out of quota, the error names what was tried", async () => {
    const { deps, calls } = makeDeps(async (providerId) => {
      if (providerId === "openai") throw OPENAI_QUOTA;
      throw new Error("Gemini quota exceeded: RESOURCE_EXHAUSTED (429)");
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_all_quota" },
      { prompt: "a small coffee shop logo", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("QUOTA_EXCEEDED");
      // Truthful failure: the user can see every provider that was tried.
      expect(result.error).toContain("openai");
      expect(result.error).toContain("gemini");
    }
    // Bounded: each configured provider tried at most once.
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    expect(calls.debit).toHaveLength(0);
  });

  it("when fallthrough ends in a non-quota failure, the error still names what was tried", async () => {
    const { deps, calls } = makeDeps(async (providerId) => {
      if (providerId === "openai") throw OPENAI_QUOTA;
      throw new Error("Gemini completed without returning image data");
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_mixed_fail" },
      { prompt: "a small coffee shop logo", providerId: "openai" },
      deps,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("PROVIDER_ERROR");
      expect(result.error).toContain("openai");
      expect(result.error).toContain("gemini");
    }
    expect(calls.dispatched).toEqual(["openai", "gemini"]);
    expect(calls.debit).toHaveLength(0);
  });

  it("auto mode: a quota failure falls through and the result names the serving provider", async () => {
    const { deps, calls } = makeDeps(async (providerId, _input, prompt) => {
      if (providerId === "openai") throw OPENAI_QUOTA;
      return okResult(prompt);
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_auto_identity" },
      { prompt: "a small coffee shop logo", generationMode: "auto-free" },
      deps,
    );

    expect(result.success).toBe(true);
    // The success result carries the ACTUAL serving provider end-to-end,
    // not the mode that was requested.
    if (result.success) expect(result.providerId).toBe("cloudflare");
    expect(calls.dispatched).toEqual(["openai", "cloudflare"]);
  });
});
