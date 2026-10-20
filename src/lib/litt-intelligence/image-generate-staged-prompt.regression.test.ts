// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LiTTToolDefinition } from "./types";

/**
 * Regression tests for the Phase 1 Defect 3 diagnosis (2026-10-20,
 * staging run 00808832 on dc7b9d91; ART-20261020-027):
 *
 * The model selected image_generate 5 times; every call returned inline
 * within ~2ms — never approval-gated, and the image service was never
 * invoked (zero [image-service] log lines, zero NO_PROVIDER strings in
 * the full window), even though the agent path deterministically fails
 * NO_PROVIDER through generateImage on staging's configuration.
 *
 * Root cause (code-proven): TWO image.generate contracts coexist.
 *  - The station bridge registers image.setPrompt / image.setAspectRatio
 *    as live agent tools; they stage params in creator-state, and the
 *    station image.generate consumes the staged prompt with args {}.
 *  - But on the id collision the bridge keeps the ORIGINAL registry
 *    tool (advertise.ts: "the existing tool keeps its advertisement"),
 *    whose handler (handleImageGenerate) takes the prompt as a direct
 *    argument and whose registry schema declares required: ["prompt"].
 * The staged prompt is therefore staged for a generate that can never
 * read it. When the model follows the staged pattern and calls
 * image.generate with {}, the agent loop's validateInputs check —
 * which runs BEFORE the permission gate in both the initial loop
 * (agent-loop-v2) and the resume loop — rejects the call inline with
 * "Missing required field: prompt". No pause, no execution, no service
 * call; the model re-stages and retries. Run 0c5b5074 differed only in
 * that the model passed the prompt directly, so validation passed, the
 * ACT gate paused, and the service was reached (NO_PROVIDER).
 *
 * The fix: the registry schema no longer requires `prompt` (it is one
 * of two ways to supply it), and handleImageGenerate falls back to the
 * staged creator-state prompt for the run's project when no usable
 * direct prompt is present. ACT gating is unchanged: image.generate
 * stays a mutation, so once validation passes the permission gate
 * pauses for approval exactly like its sibling setters.
 *
 * These tests drive the REAL dispatch seam the loop uses:
 * toolRegistry.execute for the setter (staging) and for generate,
 * with the real image service behind a deps-injecting spy (the
 * ImageServiceDeps seam, as in image-service-no-provider.regression).
 */

vi.mock("server-only", () => ({}));

/* The real image service loads hermetically with these two mocked,
 * exactly as in image-service-no-provider.regression.test.ts. */
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

/* The registry's execute path records action-runtime events when an
 * actionContext is present (as the loop always passes one). Those
 * recorders are durable-DB writers in production; here they are no-ops
 * so the dispatch logic under test stays hermetic. */
vi.mock("@/lib/action-runtime/tool-runtime", () => ({
  recordActionToolStarted: vi.fn(async () => undefined),
  recordActionToolCompleted: vi.fn(async () => undefined),
  recordActionToolFailed: vi.fn(async () => undefined),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
  actionToolResultFailed: () => null,
}));

/**
 * Wrap the REAL generateImage with a spy that injects fake deps, so
 * the dispatch assertions observe the genuine service (including its
 * NO_PROVIDER return and its [image-service] FAIL log line) without
 * touching a database or a provider.
 */
const hoisted = vi.hoisted(() => {
  const makeDeps = () => ({
    resolveInternalUserId: async () => "internal_d3",
    getJobByRequestId: async () => null,
    createJob: vi.fn(async () => {
      throw new Error("createJob must not be reached when no provider is configured");
    }),
    setJobStatus: vi.fn(async () => undefined),
    updateJobMetadata: vi.fn(async () => undefined),
    getBalances: vi.fn(async () => ({ total: 1500 })),
    debit: vi.fn(async () => ({ balance: 1500 })),
    isBillingExempt: async () => false,
    persistImage: vi.fn(async (_u: string, url: string) => url),
    dispatch: vi.fn(async () => {
      throw new Error("dispatch must not be reached when no provider is configured");
    }),
  });
  return { makeDeps, spy: null as unknown as ReturnType<typeof vi.fn> };
});

vi.mock("@/lib/generation/image-service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const realGenerateImage = actual.generateImage as (
    ctx: unknown,
    input: unknown,
    deps: unknown,
  ) => Promise<unknown>;
  const spy = vi.fn((ctx: unknown, input: unknown) =>
    realGenerateImage(ctx, input, hoisted.makeDeps()),
  );
  hoisted.spy = spy;
  return { ...actual, generateImage: spy };
});

const PROVIDER_ENV_KEYS = [
  "OPENAI_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "ALIBABA_DASHSCOPE_API_KEY",
  "ALIBABA_MODELSTUDIO_WORKSPACE_ID",
];

const PROJECT_ID = "proj_d3";
const STAGED_PROMPT = "A warm inviting coffee shop interior with wooden countertops";
const TRANSPORT = { userId: "user_d3", projectId: PROJECT_ID, operationId: "op_d3" };
const EXEC_OPTS = {
  transport: TRANSPORT,
  hasApproval: true,
  availableCapabilities: ["image_generation"],
  actionContext: { userId: "user_d3", projectId: PROJECT_ID, actionRunId: "run_d3" },
};

/**
 * Fresh module generation per test: image-service captures provider
 * env keys at module scope, and the registry / station sync is module
 * state — both must be rebuilt after stubbing the environment. The
 * registration sequence mirrors agent-loop-v2 module load (station
 * actions registered, then advertised into the tool registry).
 */
async function loadDispatch() {
  vi.resetModules();
  const { toolRegistry } = await import("./tool-registry");
  await import("@/lib/station-control/stations/image");
  const { syncStationActionsToToolRegistry } = await import(
    "@/lib/station-control/advertise"
  );
  syncStationActionsToToolRegistry();
  const { PermissionEngine } = await import("./permission-engine");
  return { toolRegistry, PermissionEngine };
}

function toPermissionInfoMirror(tool: LiTTToolDefinition) {
  return {
    toolId: tool.id,
    permissionLevel: tool.permissionLevel,
    isReadOnly: tool.readOnly,
    isMutation: !tool.readOnly,
    enabled: tool.enabled,
    requiredCapabilities: tool.requiredCapabilities,
  };
}

describe("agent-path image.generate with a staged prompt (run 00808832 shape)", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const k of PROVIDER_ENV_KEYS) vi.stubEnv(k, "");
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    infoSpy.mockRestore();
    vi.clearAllMocks();
  });

  it("station-style generate ({}) reaches the image service and fails truthfully with NO_PROVIDER + FAIL log", async () => {
    const { toolRegistry } = await loadDispatch();

    // Stage the prompt exactly as the run did: through the gated
    // station setter, via the real registry execute path.
    const staged = await toolRegistry.execute(
      "image.setPrompt",
      { prompt: STAGED_PROMPT },
      EXEC_OPTS,
    );
    expect(staged.ok).toBe(true);

    // The defect: this call used to die in validateInputs, before the
    // permission gate and before any handler ran.
    const out = await toolRegistry.execute("image.generate", {}, EXEC_OPTS);

    expect(hoisted.spy).toHaveBeenCalledTimes(1);
    const [, input] = hoisted.spy.mock.calls[0] as [
      unknown,
      { prompt: string; generationMode: string },
    ];
    expect(input.prompt).toBe(STAGED_PROMPT);
    expect(input.generationMode).toBe("auto-free");

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result).toMatchObject({
        success: false,
        code: "NO_PROVIDER",
        retryable: false,
      });
    }
    const logged = infoSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
    expect(logged).toMatch(/\[image-service\] FAIL code=NO_PROVIDER/);
  });

  it("validation no longer dead-ends the staged call, and the ACT gate still requires approval like its siblings", async () => {
    const { toolRegistry, PermissionEngine } = await loadDispatch();

    // The loop runs validateInputs BEFORE the permission gate; a
    // station-style call must survive it so the gate can do its job.
    expect(toolRegistry.validateInputs("image.generate", {})).toBeNull();

    const engine = new PermissionEngine();
    for (const id of ["image.generate", "image.setPrompt", "image.setAspectRatio"]) {
      const def = toolRegistry.get(id);
      expect(def, id).toBeDefined();
      const res = engine.check(
        toPermissionInfoMirror(def!),
        {},
        "act",
        ["image_generation"],
      );
      expect(res, id).toMatchObject({ allowed: true, requiresApproval: true });
    }
  });

  it("guard: a direct prompt argument still reaches the service unchanged (the run 0c5b5074 path)", async () => {
    const { toolRegistry } = await loadDispatch();

    const out = await toolRegistry.execute(
      "image.generate",
      { prompt: "a direct prompt passed inline" },
      EXEC_OPTS,
    );

    expect(hoisted.spy).toHaveBeenCalledTimes(1);
    const [, input] = hoisted.spy.mock.calls[0] as [unknown, { prompt: string }];
    expect(input.prompt).toBe("a direct prompt passed inline");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result).toMatchObject({ success: false, code: "NO_PROVIDER" });
    }
  });

  it("guard: with nothing staged and no direct prompt, the handler fails honestly and the service is untouched", async () => {
    const { toolRegistry } = await loadDispatch();

    const out = await toolRegistry.execute("image.generate", {}, EXEC_OPTS);

    expect(hoisted.spy).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result).toMatchObject({
        success: false,
        error: "Prompt must be at least 3 characters",
      });
    }
  });
});
