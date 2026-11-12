import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifyHttpFailure,
  recordModelFailure,
  isModelCoolingDown,
  _resetProviderHealthForTests,
} from "./provider-registry";
import {
  isCloudflareLaneModel,
  ensurePreviewAfterVerifiedMutations,
} from "./agent-loop-v2";
import { ProgressEmitter, type ProgressEvent } from "./progress-events";
import type { WorkspaceTransport } from "./workspace-transport";

// ─── Permanent-vs-transient model failure classification ──────────────

describe("classifyHttpFailure — permanent invalid-slug detection", () => {
  it("404 is model-scope permanent — an absent resource cannot self-heal", () => {
    const f = classifyHttpFailure(404, "model not found");
    expect(f.class).toBe("model_unavailable");
    expect(f.scope).toBe("model");
    expect(f.permanent).toBe(true);
  });

  it("400 naming the model as missing/invalid is permanent", () => {
    for (const body of [
      '{"error":{"message":"The model does not exist"}}',
      "no such model: @cf/mistral/mistral-small-3.1-24b-instruct",
      '{"success":false,"errors":[{"message":"Unable to find model"}]}',
    ]) {
      const f = classifyHttpFailure(400, body);
      expect(f.class).toBe("model_unavailable");
      expect(f.scope).toBe("model");
      expect(f.permanent).toBe(true);
    }
  });

  it("400 generic bad request is model_unavailable but NOT permanent", () => {
    const f = classifyHttpFailure(400, "bad request");
    expect(f.class).toBe("model_unavailable");
    expect(f.scope).toBe("model");
    expect(f.permanent).toBeUndefined();
  });

  it("400 with a dead API key stays auth_invalid provider-scope", () => {
    const f = classifyHttpFailure(400, "API key not valid");
    expect(f.class).toBe("auth_invalid");
    expect(f.scope).toBe("provider");
    expect(f.permanent).toBeUndefined();
  });
});

describe("recordModelFailure — permanent slugs park long, providers unaffected", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetProviderHealthForTests();
  });
  afterEach(() => vi.useRealTimers());

  it("transient model failure cools for the standard window only", () => {
    recordModelFailure("cloudflare", "@cf/meta/llama-3.3-70b");
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama-3.3-70b")).toBe(true);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama-3.3-70b")).toBe(false);
  });

  it("permanent failure keeps the dead slug parked past the standard window", () => {
    recordModelFailure("cloudflare", "@cf/mistral/bad-slug", undefined, true);
    expect(isModelCoolingDown("cloudflare", "@cf/mistral/bad-slug")).toBe(true);
    vi.advanceTimersByTime(60 * 60_000);
    expect(isModelCoolingDown("cloudflare", "@cf/mistral/bad-slug")).toBe(true);
    // …but a healthy sibling model is never cooled by it.
    expect(isModelCoolingDown("cloudflare", "@cf/meta/llama-3.3-70b")).toBe(false);
  });
});

// ─── Cloudflare lane steering ─────────────────────────────────────────

describe("isCloudflareLaneModel", () => {
  it("detects @cf/ hints regardless of the specific model", () => {
    expect(isCloudflareLaneModel("@cf/meta/llama-3.3-70b-instruct-fp8-fast")).toBe(true);
    expect(isCloudflareLaneModel("@cf/mistralai/mistral-small-3.1-24b-instruct")).toBe(true);
  });
  it("non-CF models and missing hints are not the CF lane", () => {
    expect(isCloudflareLaneModel("gemini-flash-latest")).toBe(false);
    expect(isCloudflareLaneModel("openai/gpt-oss-120b")).toBe(false);
    expect(isCloudflareLaneModel(undefined)).toBe(false);
    expect(isCloudflareLaneModel("")).toBe(false);
  });
});

// ─── Auto-preview after verified mutations ────────────────────────────

function fakeTransport(over: Partial<WorkspaceTransport>): WorkspaceTransport {
  return {
    getPreviewStatus: vi.fn(async () => ({
      status: "stopped",
      port: null,
      framework: null,
      command: null,
      startedAt: null,
      lastHealthCheck: null,
      error: null,
      errorCode: null,
      logs: [],
    })),
    startPreview: vi.fn(async () => ({
      workspaceId: "w1",
      status: "ready",
      port: 3000,
      framework: "static",
      command: "n/a",
      startedAt: Date.now(),
    })),
    ...over,
  } as unknown as WorkspaceTransport;
}

function collectEvents(): { events: ProgressEvent[]; emitter: ProgressEmitter } {
  const events: ProgressEvent[] = [];
  return { events, emitter: new ProgressEmitter((e) => events.push(e)) };
}

describe("ensurePreviewAfterVerifiedMutations", () => {
  it("does nothing without a verified change", async () => {
    const t = fakeTransport({});
    const { events, emitter } = collectEvents();
    await ensurePreviewAfterVerifiedMutations(t, { status: "unchanged" }, emitter);
    await ensurePreviewAfterVerifiedMutations(t, undefined, emitter);
    expect(t.getPreviewStatus).not.toHaveBeenCalled();
    expect(t.startPreview).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it("starts the preview after a verified change and reports ready", async () => {
    const t = fakeTransport({});
    const { events, emitter } = collectEvents();
    await ensurePreviewAfterVerifiedMutations(t, { status: "changed" }, emitter);
    expect(t.startPreview).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "preview_start" });
    expect(events).toContainEqual({ type: "preview_result", success: true });
  });

  it("static workspaces report ready without a running dev server", async () => {
    const t = fakeTransport({
      startPreview: vi.fn(async () => ({
        workspaceId: "w1",
        status: "starting" as const,
        port: 0,
        framework: "static",
        command: "n/a",
        startedAt: null,
      })),
    });
    const { events, emitter } = collectEvents();
    await ensurePreviewAfterVerifiedMutations(t, { status: "changed" }, emitter);
    expect(events).toContainEqual({ type: "preview_result", success: true });
  });

  it("reports failure honestly when preview start fails — never fake-ready", async () => {
    const t = fakeTransport({
      startPreview: vi.fn(async () => ({
        workspaceId: "w1",
        status: "failed" as const,
        port: 0,
        framework: "node",
        command: "npm run dev",
        startedAt: null,
        error: "port in use",
      })),
    });
    const { events, emitter } = collectEvents();
    await ensurePreviewAfterVerifiedMutations(t, { status: "changed" }, emitter);
    const result = events.find((e) => e.type === "preview_result");
    expect(result).toBeDefined();
    expect((result as { success: boolean }).success).toBe(false);
  });

  it("reports failure honestly when the runtime is unreachable", async () => {
    const t = fakeTransport({
      getPreviewStatus: vi.fn(async () => { throw new Error("unreachable"); }),
      startPreview: vi.fn(async () => { throw new Error("unreachable"); }),
    });
    const { events, emitter } = collectEvents();
    await ensurePreviewAfterVerifiedMutations(t, { status: "changed" }, emitter);
    const result = events.find((e) => e.type === "preview_result");
    expect(result).toBeDefined();
    expect((result as { success: boolean }).success).toBe(false);
  });
});
