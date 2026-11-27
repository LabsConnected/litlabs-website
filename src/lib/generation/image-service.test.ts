// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    if (id === "openai") {
      return {
        id: "openai",
        label: "OpenAI",
        supportedFormats: ["image"],
        cost: () => 5,
        free: false,
      };
    }
    if (id === "cloudflare") {
      return {
        id: "cloudflare",
        label: "Cloudflare",
        supportedFormats: ["image"],
        cost: () => 0,
        free: true,
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
  handlePollinationsImage,
  imageModelFor,
  openAIImageResultFromPayload,
  selectOpenAIImageModel,
  type ImageServiceDeps,
  type ImageGenerationInput,
} from "./image-service";
import type { GenerationJob } from "./types";

describe("GPT Image routing", () => {
  it("selects Flare for generation and Sunburst for edit/reference work", () => {
    expect(selectOpenAIImageModel({ operation: "generate" })).toBe("gpt-image-2.5-flare");
    expect(selectOpenAIImageModel({ operation: "edit" })).toBe("gpt-image-2.5-sunburst");
    expect(selectOpenAIImageModel({ referenceUrl: "data:image/png;base64,abc" })).toBe(
      "gpt-image-2.5-sunburst",
    );
  });

  it("uses the selected GPT Image model for billing metadata", () => {
    expect(imageModelFor("openai", { prompt: "new image", operation: "generate" })).toBe(
      "gpt-image-2.5-flare",
    );
    expect(imageModelFor("openai", { prompt: "edit", operation: "edit" })).toBe(
      "gpt-image-2.5-sunburst",
    );
  });

  it("persists OpenAI base64 output as an inline image URL", () => {
    const result = openAIImageResultFromPayload(
      { data: [{ b64_json: "aGVsbG8=" }] },
      "a generated image",
    );
    expect(result.downloadUrl).toBe("data:image/png;base64,aGVsbG8=");
  });
});

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
    getJob: async (jobId) => {
      for (const job of jobs.values()) {
        if (job.id === jobId) return job;
      }
      return null;
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

  it("round 14: a completion that does not read back is flagged, not reported as a persisted asset", async () => {
    // Simulates the lion-proof failure at the service boundary: the
    // completion writes were issued, but the row still reads
    // "processing" with no durable URL (the flip silently failed in
    // the jobs layer). The generation itself succeeded — the service
    // must still return the image — but it must NOT claim a
    // persisted asset: assetPersistenceFailed is set and no job id
    // is reported as the asset.
    const { deps } = makeDeps({
      getJob: async (jobId) => makeJob({ id: jobId, status: "processing", metadata: {} }),
    });
    const result = await generateImage(
      { userId: "user_abc", projectId: "proj_1", requestId: "op_1" },
      paidInput,
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.assetPersistenceFailed).toBe(true);
      expect(result.generationJobId).toBeNull();
      expect(result.assetId).toBeNull();
      expect(result.downloadUrl).toBe("https://provider/x.png");
    }
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

  it("does NOT replay a completed job for a DIFFERENT prompt under the same requestId (2026-11-20 live defect)", async () => {
    const { deps, calls, jobs } = makeDeps();
    // An earlier, different generation completed under the same
    // operation-derived requestId (the agent path keyed solely on the
    // approved run's identity).
    jobs.set(
      "op_1",
      makeJob({
        status: "completed",
        prompt: "a portrait of a woman on a city street",
        metadata: { durableUrl: "https://r2/woman.png", chargedBits: 50 },
      }),
    );

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_1" },
      { prompt: "a bike", providerId: "gemini" },
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      // Fresh generation for THIS prompt — not the old portrait.
      expect(result.replayed).toBeUndefined();
      expect(result.downloadUrl).toBe("https://provider/x.png");
      expect(result.requestId.startsWith("op_1~")).toBe(true);
    }
    expect(calls.dispatch).toBe(1);
  });

  it("a retry of the re-scoped prompt replays its OWN job — still no double generation or debit", async () => {
    const { deps, calls, jobs } = makeDeps();
    jobs.set(
      "op_1",
      makeJob({
        status: "completed",
        prompt: "a portrait of a woman on a city street",
        metadata: { durableUrl: "https://r2/woman.png", chargedBits: 50 },
      }),
    );
    const bikeInput = { prompt: "a bike", providerId: "gemini" as const };

    const first = await generateImage({ userId: "user_abc", requestId: "op_1" }, bikeInput, deps);
    expect(first.success).toBe(true);
    expect(calls.dispatch).toBe(1);
    const debitsAfterFirst = calls.debit.length;

    const second = await generateImage({ userId: "user_abc", requestId: "op_1" }, bikeInput, deps);
    expect(second.success).toBe(true);
    if (second.success) expect(second.replayed).toBe(true);
    expect(calls.dispatch).toBe(1);
    expect(calls.debit).toHaveLength(debitsAfterFirst);
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

  it("persists a pollinations lazy URL to durable storage before completing the job", async () => {
    // Regression for the live 2026-11-19 failure: handlePollinationsImage
    // fell back to its lazy generation-endpoint URL, the job completed
    // against that URL (so Media showed the image), and the registry's
    // project save then died re-downloading the pay-gated endpoint
    // (HTTP 402). Pollinations results must pass through persistImage
    // like the other providers so the job row and the save leg both
    // point at own storage, never at image.pollinations.ai.
    const LAZY_URL =
      "https://image.pollinations.ai/prompt/a%20sunny%20dog%20park?width=1024&height=1024&seed=7&nologo=true&enhance=false&model=flux";
    const STORAGE_URL =
      "https://storage.example/internal_1/pollinations-a-sunny-dog-park.png";
    const persistCalls: Array<{ url: string; providerId: string }> = [];
    const { deps, jobs } = makeDeps({
      dispatch: async () => ({
        id: "res_lazy",
        status: 200,
        title: "a sunny dog park",
        format: "image" as const,
        downloadUrl: LAZY_URL,
      }),
      persistImage: async (_uid, url, providerId) => {
        persistCalls.push({ url, providerId });
        return STORAGE_URL;
      },
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_5" },
      freeInput,
      deps,
    );

    expect(result.success).toBe(true);
    expect(persistCalls).toEqual([{ url: LAZY_URL, providerId: "pollinations" }]);
    if (result.success) {
      expect(result.downloadUrl).toBe(STORAGE_URL);
      expect(result.downloadUrl).not.toContain("image.pollinations.ai");
    }
    const job = jobs.get("op_5");
    expect(job?.status).toBe("completed");
    expect(job?.metadata?.durableUrl).toBe(STORAGE_URL);
  });

  it("reports deliveryVerified=false when only an unverified provider URL is held", async () => {
    // persistImage returns the source URL unchanged on any failure —
    // that is the honest "we hold a link, not the bytes" state. The
    // result must say so instead of implying verified delivery.
    const LAZY_URL =
      "https://image.pollinations.ai/prompt/a%20bike?width=1024&height=1024&seed=7&nologo=true&enhance=false&model=flux";
    const { deps } = makeDeps({
      dispatch: async () => ({
        id: "res_unverified",
        status: 200,
        title: "a bike",
        format: "image" as const,
        downloadUrl: LAZY_URL,
      }),
      persistImage: async (_uid, url) => url, // failure path: unchanged
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_unverified" },
      freeInput,
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.downloadUrl).toBe(LAZY_URL);
      expect(result.deliveryVerified).toBe(false);
    }
  });

  it("reports deliveryVerified=true for inline data: URL bytes even when persist fails", async () => {
    const DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const { deps } = makeDeps({
      dispatch: async () => ({
        id: "res_data",
        status: 200,
        title: "inline",
        format: "image" as const,
        downloadUrl: DATA_URL,
      }),
      persistImage: async (_uid, url) => url, // failure path: unchanged
    });

    const result = await generateImage(
      { userId: "user_abc", requestId: "op_data" },
      freeInput,
      deps,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deliveryVerified).toBe(true);
    }
  });
});

describe("generateImage — provider fallthrough to the no-key last resort", () => {
  // Regression for the 2026-11-15 production proof (build 4bd24248):
  // the approved Studio image.generate died with the raw error
  // "OpenAI error: ... Incorrect API key provided ..." even though a
  // wired no-key provider existed. In production the auto-free chain
  // was exactly ["openai"] (Cloudflare/Alibaba keys unset) and the
  // present-but-dead OpenAI key passed isProviderConfigured, so the
  // sole chain member's auth failure was terminal. Pollinations is
  // now the terminal entry of AUTO_FREE_ORDER and of the manual-pin
  // fallthrough, so a dead key can never be the terminal answer while
  // any provider can still serve.
  //
  // Provider "configured" state is read from module-level env consts,
  // so each test re-imports the service with a stubbed env (the same
  // pattern the handleCloudflareImage suite below uses).
  const PROVIDER_ENV_KEYS = [
    "OPENAI_API_KEY",
    "FAL_KEY",
    "RECRAFT_API_KEY",
    "GEMINI_API_KEY",
    "TOGETHER_API_KEY",
    "HUGGING_FACE_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_AI_API_TOKEN",
    "ALIBABA_DASHSCOPE_API_KEY",
    "ALIBABA_MODELSTUDIO_WORKSPACE_ID",
  ];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importGenerateImage(env: Record<string, string>) {
    vi.resetModules();
    for (const key of PROVIDER_ENV_KEYS) vi.stubEnv(key, env[key] ?? "");
    const mod = await import("./image-service");
    return mod.generateImage;
  }

  function recordingDispatch(failures: Record<string, Error>) {
    const order: string[] = [];
    const dispatch = async (providerId: string, _input: unknown, prompt: string) => {
      order.push(providerId);
      const failure = failures[providerId];
      if (failure) throw failure;
      return {
        id: `res_${providerId}`,
        status: 200,
        title: prompt.slice(0, 60),
        format: "image" as const,
        downloadUrl: `https://provider/${providerId}.png`,
      };
    };
    return { dispatch, order };
  }

  const deadOpenAiKey = new Error(
    'OpenAI error: { "error": { "message": "Incorrect API key provided: sk-proj-***" } }',
  );

  it("auto-free: a dead OpenAI key falls through to Pollinations and the operation succeeds", async () => {
    const generateImageFresh = await importGenerateImage({ OPENAI_API_KEY: "sk-test-dead" });
    const { dispatch, order } = recordingDispatch({ openai: deadOpenAiKey });
    const { deps, calls } = makeDeps({ dispatch: dispatch as ImageServiceDeps["dispatch"] });

    const result = await generateImageFresh(
      { userId: "user_abc", requestId: "op_fallthrough_auto" },
      { prompt: "a lion", generationMode: "auto-free" },
      deps,
    );

    expect(order).toEqual(["openai", "pollinations"]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerId).toBe("pollinations");
      expect(result.free).toBe(true);
      expect(result.cost).toBe(0);
    }
    // The serving provider is free — the dead provider's price is never charged.
    expect(calls.debit).toHaveLength(0);
  });

  it("manual pin: a dead pinned OpenAI key falls through the chain to Pollinations", async () => {
    const generateImageFresh = await importGenerateImage({ OPENAI_API_KEY: "sk-test-dead" });
    const { dispatch, order } = recordingDispatch({ openai: deadOpenAiKey });
    const { deps, calls } = makeDeps({ dispatch: dispatch as ImageServiceDeps["dispatch"] });

    const result = await generateImageFresh(
      { userId: "user_abc", requestId: "op_fallthrough_pin" },
      { prompt: "a lion", providerId: "openai" },
      deps,
    );

    expect(order).toEqual(["openai", "pollinations"]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("pollinations");
    expect(calls.debit).toHaveLength(0);
  });

  it("auto-free with no keys configured at all still serves via Pollinations", async () => {
    const generateImageFresh = await importGenerateImage({});
    const { dispatch, order } = recordingDispatch({});
    const { deps } = makeDeps({ dispatch: dispatch as ImageServiceDeps["dispatch"] });

    const result = await generateImageFresh(
      { userId: "user_abc", requestId: "op_fallthrough_nokeys" },
      { prompt: "a lion", generationMode: "auto-free" },
      deps,
    );

    expect(order).toEqual(["pollinations"]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.providerId).toBe("pollinations");
  });

  it("when every provider including the last resort fails, the error names all of them", async () => {
    const generateImageFresh = await importGenerateImage({ OPENAI_API_KEY: "sk-test-dead" });
    const { dispatch, order } = recordingDispatch({
      openai: deadOpenAiKey,
      pollinations: new Error("Pollinations upstream rate limit (429)"),
    });
    const { deps, calls } = makeDeps({ dispatch: dispatch as ImageServiceDeps["dispatch"] });

    const result = await generateImageFresh(
      { userId: "user_abc", requestId: "op_fallthrough_allfail" },
      { prompt: "a lion", generationMode: "auto-free" },
      deps,
    );

    expect(order).toEqual(["openai", "pollinations"]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("All configured image providers failed");
      expect(result.error).toContain("Tried: openai, pollinations");
    }
    expect(calls.debit).toHaveLength(0);
  });
});

describe("handlePollinationsImage", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockPollinationsResponse(opts: {
    status?: number;
    contentType?: string;
    body?: string;
    bytes?: Buffer;
  }) {
    const body = opts.body ?? "";
    const bytes = opts.bytes ?? Buffer.from(body, "utf8");
    globalThis.fetch = vi.fn(async () => ({
      ok: (opts.status ?? 200) < 300,
      status: opts.status ?? 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? (opts.contentType ?? null) : null,
      },
      text: async () => body,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    })) as unknown as typeof fetch;
  }

  it("returns an inline data:image/* downloadUrl for a real image response", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockPollinationsResponse({ contentType: "image/png", bytes: png });
    const result = await handlePollinationsImage("a red apple", "", 1, 512, 512);
    expect(result.status).toBe("complete");
    expect(result.downloadUrl).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(result.downloadUrl.split(",")[1], "base64")).toEqual(png);
  });

  it("a 200 JSON error envelope throws — never becomes a fake image", async () => {
    mockPollinationsResponse({
      contentType: "application/json",
      body: '{"error":"Internal Server Error","message":"429: rate limit"}',
    });
    await expect(
      handlePollinationsImage("a red apple", "", 1, 512, 512),
    ).rejects.toThrow(/rate limit/i);
  });

  it("a 200 non-image response without a rate-limit marker still throws", async () => {
    mockPollinationsResponse({
      contentType: "text/html",
      body: "<html>oops</html>",
    });
    await expect(
      handlePollinationsImage("a red apple", "", 1, 512, 512),
    ).rejects.toThrow(/non-image/i);
  });

  it("a network failure falls back to the lazy pollinations URL", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("socket hangup");
    }) as unknown as typeof fetch;
    const result = await handlePollinationsImage("a red apple", "", 1, 512, 512);
    expect(result.downloadUrl).toMatch(/^https:\/\/image\.pollinations\.ai\//);
  });
});

describe("handleCloudflareImage", () => {
  // Regression for the 2026-11-08 staging acceptance failure: the request
  // body sent width/height/seed/num_steps, which the flux-1-schnell schema
  // rejects with HTTP 400 code 5006 — every approved image.generate died
  // in ~650ms and the resumed run settled "approved workspace operation
  // failed" with zero files written. The schema accepts ONLY `prompt`.
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function importHandler() {
    vi.resetModules();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_test_123");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "tok_test_456");
    const mod = await import("./image-service");
    return mod.handleCloudflareImage;
  }

  function mockCfJson(status: number, payload: unknown) {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json" : null,
      },
      text: async () => JSON.stringify(payload),
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("sends only the prompt field — no width/height/seed/num_steps", async () => {
    const handleCloudflareImage = await importHandler();
    const fetchMock = mockCfJson(200, {
      success: true,
      result: { image: "aGVsbG8=" },
    });

    const result = await handleCloudflareImage({
      prompt: "  a red apple  ",
      width: 1024,
      height: 768,
      seed: 7,
    });

    expect(result.status).toBe("complete");
    expect(result.downloadUrl).toBe("data:image/png;base64,aGVsbG8=");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("acct_test_123");
    expect(url).toContain("ai/run/");
    // The exact regression: extra properties are a hard 400 from Workers AI.
    expect(JSON.parse(init.body)).toEqual({ prompt: "a red apple" });
  });

  it("labels JPEG payloads image/jpeg — flux-1-schnell does not return PNG", async () => {
    // Regression for the 2026-11-08 staging approval loop: the JSON path
    // hardcoded data:image/png, but Workers AI returns JPEG bytes. The
    // mislabeled URL failed insertAssetFromUrl's PNG structural check as
    // "truncated or corrupt", so every approved image.generate saved
    // nothing and the model re-asked under a fresh approval each time.
    const handleCloudflareImage = await importHandler();
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
      0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    mockCfJson(200, {
      success: true,
      result: { image: jpeg.toString("base64") },
    });

    const result = await handleCloudflareImage({
      prompt: "a red apple",
      width: 1024,
      height: 768,
    });

    expect(result.downloadUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(
      Buffer.from(result.downloadUrl.split(",")[1], "base64"),
    ).toEqual(jpeg);
  });

  it("keeps the fallback label for payloads matching no known image format", async () => {
    const handleCloudflareImage = await importHandler();
    mockCfJson(200, {
      success: true,
      result: { image: "aGVsbG8=" }, // "hello" — not an image
    });

    const result = await handleCloudflareImage({
      prompt: "a red apple",
      width: 1024,
      height: 768,
    });

    expect(result.downloadUrl).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("propagates the Workers AI schema rejection as an honest error", async () => {
    const handleCloudflareImage = await importHandler();
    mockCfJson(400, {
      success: false,
      errors: [
        {
          code: 5006,
          message:
            "AiError: Bad input: Additional or unevaluated properties '/width' at '/' not allowed",
        },
      ],
    });

    await expect(
      handleCloudflareImage({ prompt: "a cat", width: 512, height: 512 }),
    ).rejects.toThrow(/Bad input/);
  });

  it("fails closed when Cloudflare env is not configured", async () => {
    vi.resetModules();
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "");
    const mod = await import("./image-service");
    await expect(
      mod.handleCloudflareImage({ prompt: "a cat", width: 512, height: 512 }),
    ).rejects.toThrow(/not configured/);
  });
});
