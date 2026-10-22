// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for the Lane A staging diagnosis (2026-10-20,
 * run 0c5b5074 on staging head 47824457):
 *
 * On staging, NO credential existed for any provider in the image
 * service's AUTO_FREE_ORDER (openai / cloudflare / alibaba), so the
 * agent-path image.generate call returned code NO_PROVIDER — and the
 * failure was operationally silent: the NO_PROVIDER return in
 * generateImage emits no log line and creates no generation_jobs row,
 * so the exact provider error was invisible in service logs.
 *
 * Test 1 FAILS on the current code (no FAIL log line is emitted) and
 * PASSES once generateImage's shared fail() helper logs every failure
 * return (the proposed one-line observability correction).
 * Tests 2 and 3 are guards: they pass before and after, pinning (2)
 * the no-side-effects shape of the NO_PROVIDER path and (3) the $0
 * Cloudflare configuration path that is the proposed root-cause fix.
 *
 * No real provider is ever called: dispatch is an injected fake via
 * the ImageServiceDeps seam, exactly as in image-service.test.ts.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media", () => ({
  getProvider: (id: string) => {
    const defs: Record<string, unknown> = {
      openai: { id: "openai", label: "OpenAI", supportedFormats: ["image"], cost: () => 5, free: false },
      cloudflare: { id: "cloudflare", label: "Cloudflare", supportedFormats: ["image"], cost: () => 0, free: true },
      alibaba: { id: "alibaba", label: "Alibaba", supportedFormats: ["image"], cost: () => 1, free: false },
    };
    return defs[id];
  },
}));
vi.mock("@/lib/generation/cost-engine", () => ({
  calculateRetailBits: () => ({ providerCostCents: 0, retailLiTTBits: 0 }),
}));

import type { ImageServiceDeps } from "./image-service";
import type { GenerationJob } from "./types";

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "ALIBABA_DASHSCOPE_API_KEY",
  "ALIBABA_MODELSTUDIO_WORKSPACE_ID",
];

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: "job_1",
    userId: "internal_1",
    modality: "image",
    provider: "cloudflare",
    model: "@cf/black-forest-labs/flux-1-schnell",
    status: "processing",
    prompt: "a cozy coffee shop interior by a harbor",
    requestId: "approval:op_1",
    providerJobId: null,
    actualProviderCostCents: null,
    littBitsCharged: 0,
    refundStatus: "none",
    assetId: null,
    error: null,
    metadata: {},
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  } as GenerationJob;
}

function makeDeps(overrides: Partial<ImageServiceDeps> = {}) {
  const deps: ImageServiceDeps = {
    resolveInternalUserId: async () => "internal_1",
    getJobByRequestId: async () => null,
    createJob: vi.fn(async () => makeJob()),
    setJobStatus: vi.fn(async () => undefined),
    updateJobMetadata: vi.fn(async () => undefined),
    getBalances: vi.fn(async () => ({ total: 1500 })),
    debit: vi.fn(async () => ({ balance: 1500 })),
    isBillingExempt: async () => false,
    persistImage: vi.fn(async (_u: string, url: string) => url),
    dispatch: vi.fn(async () => ({
      downloadUrl: "data:image/png;base64,AAAA",
      id: "cf_1",
      status: "complete",
      title: "coffee shop",
      format: "image" as const,
    })),
    ...overrides,
  };
  return deps;
}

async function loadGenerateImage() {
  // image-service captures provider env keys in module-scope constants,
  // so the module must be re-imported after stubbing the environment.
  vi.resetModules();
  const mod = await import("./image-service");
  return mod.generateImage;
}

const CTX = { userId: "user_test", requestId: "approval:op_1" };
const INPUT = {
  prompt: "A cozy, warm-lit coffee shop interior with wooden tables",
  format: "image" as const,
  generationMode: "auto-free" as const,
};

describe("auto-free with no provider configured (staging 2026-10-20 shape)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    for (const k of PROVIDER_ENV_KEYS) vi.stubEnv(k, "");
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    infoSpy.mockRestore();
  });

  it("returns NO_PROVIDER and LOGS the failure (fails before the observability fix)", async () => {
    const generateImage = await loadGenerateImage();
    const deps = makeDeps();
    const result = await generateImage(CTX, INPUT, deps);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("NO_PROVIDER");
      expect(result.error).toBe("No free providers are configured");
      expect(result.retryable).toBe(false);
    }
    const logged = infoSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(logged).toMatch(/\[image-service\] FAIL code=NO_PROVIDER/);
  });

  it("guard: NO_PROVIDER performs no dispatch, no debit, and creates no job row", async () => {
    const generateImage = await loadGenerateImage();
    const deps = makeDeps();
    const result = await generateImage(CTX, INPUT, deps);
    expect(result.success).toBe(false);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.debit).not.toHaveBeenCalled();
    expect(deps.createJob).not.toHaveBeenCalled();
    expect(deps.getBalances).not.toHaveBeenCalled();
  });
});

describe("auto-free with only Cloudflare configured (the proposed $0 fix)", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ALIBABA_DASHSCOPE_API_KEY", "");
    vi.stubEnv("ALIBABA_MODELSTUDIO_WORKSPACE_ID", "");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_test");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "token_test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("guard: dispatches to cloudflare, succeeds, and debits zero", async () => {
    const generateImage = await loadGenerateImage();
    const deps = makeDeps();
    const result = await generateImage(CTX, INPUT, deps);
    expect(deps.dispatch).toHaveBeenCalledTimes(1);
    expect(deps.dispatch).toHaveBeenCalledWith("cloudflare", expect.anything(), INPUT.prompt);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.providerId).toBe("cloudflare");
      expect(result.cost).toBe(0);
      expect(result.free).toBe(true);
    }
    expect(deps.debit).not.toHaveBeenCalled();
  });
});
