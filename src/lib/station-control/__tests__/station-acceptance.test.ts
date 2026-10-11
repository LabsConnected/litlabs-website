/**
 * Station Control Bridge — acceptance tests (chunk E).
 *
 * Proves the full integration: registration → advertisement into the tool
 * registry → the agent loop's existing dispatch path → Activity event wiring.
 *
 * Hermeticity: the REAL toolRegistry runs, but real I/O is avoided —
 * toolRegistry.execute is spied (never globally stubbed) only where a
 * delegate would touch the FS; the video provider check is mocked; the
 * Supabase-backed path fails fast through the local chainable mock.
 *
 * Ordering matters: the "registration" describe runs BEFORE agent-loop-v2
 * is imported (dynamic import inside the "advertisement" describe), so the
 * before/after advertisement assertions are meaningful. agent-loop-v2 is
 * never statically imported — a static import would advertise at file load.
 */
import { describe, expect, it, vi } from "vitest";

const mockCallLLM = vi.hoisted(() => vi.fn());

vi.mock("@/lib/litt-intelligence/llm-tool-calling", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  callLLMWithTools: mockCallLLM,
}));

/* The video provider check is mocked — no network, no keys. */
vi.mock("@/lib/alibaba-video", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isAlibabaConfigured: () => false,
}));

/* Registers all station actions. Does NOT advertise them. */
import "../index";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";
import { PermissionEngine } from "@/lib/litt-intelligence/permission-engine";
import type { LiTTToolDefinition } from "@/lib/litt-intelligence/types";
import type { WorkspaceTransport } from "@/lib/litt-intelligence/workspace-transport";
import { listStationActions, getStationAction } from "../registry";
import { executeStationAction } from "../executor";
import { buildStationContext } from "../project-session";
import { stationActionToToolDefinition } from "../advertise";
import { registerAllStationActions } from "../index";
import {
  getStationEventSink,
  setStationEventSink,
  summarizeStationEvent,
} from "../loop-events";
import { creatorKey, setCreatorParams } from "../stations/creator-state";
import type { ExecutionEvent, StationExecutionContext } from "../types";

/** Station ids that already exist as real tools — the bridge must not clobber them. */
const COLLIDING_IDS = [
  "files.delete",
  "files.read",
  "git.status",
  "git.diff",
  "git.commit",
  "terminal.execute",
  "browser.navigate",
  "browser.click",
  "browser.type",
  "browser.scroll",
  "browser.screenshot",
  "image.generate",
];

/** Station-only ids (no real-tool counterpart) spot-checked through the suite. */
const STATION_ONLY_IDS = [
  "video.generate",
  "music.generate",
  "audio.tts",
  "canvas.addNode",
  "preview.screenshot",
  "code.search",
];

/** Actions deliberately omitted from the bridge — must stay absent. */
const OMITTED_IDS = [
  "git.push",
  "git.createPR",
  "terminal.cancel",
  "terminal.read",
  "browser.search",
  "image.upscale",
  "music.remix",
  "assets.delete",
];

function makeCtx(
  overrides: Partial<StationExecutionContext> = {},
): { ctx: StationExecutionContext; events: ExecutionEvent[] } {
  const events: ExecutionEvent[] = [];
  const ctx = buildStationContext({
    userId: "user-acceptance",
    conversationId: "conv-acceptance",
    projectId: "proj-acceptance",
    emitEvent: (e) => events.push(e as ExecutionEvent),
    ...overrides,
  });
  return { ctx, events };
}

/* Mirrors agent-loop-v2's private toPermissionInfo line-for-line: the exact
 * shape the loop's availableTools filter feeds into PermissionEngine.check.
 * (toPermissionInfo is module-private; this mirror is the closest honest
 * check that the advertised defs flow through the existing path unchanged.) */
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

describe("registration (index import only — no advertisement yet)", () => {
  it("registers all 14 station modules' actions (61 total)", () => {
    const actions = listStationActions();
    expect(actions.length).toBe(61);
    const byStation: Record<string, number> = {};
    for (const a of actions) byStation[a.station] = (byStation[a.station] ?? 0) + 1;
    expect(byStation).toEqual({
      code: 4,
      files: 4,
      git: 4,
      deploy: 3,
      checks: 4,
      terminal: 1,
      browser: 8,
      preview: 4,
      canvas: 6,
      image: 9,
      video: 5,
      music: 4,
      audio: 2,
      assets: 3,
    });
    for (const id of [...STATION_ONLY_IDS, "image.setPrompt"]) {
      expect(getStationAction(id), id).toBeDefined();
    }
  });

  it("deliberately omitted actions are absent", () => {
    for (const id of OMITTED_IDS) {
      expect(getStationAction(id), id).toBeUndefined();
    }
    const ids = listStationActions().map((a) => a.id);
    expect(ids.some((id) => id.startsWith("plan.") || id.startsWith("memory."))).toBe(false);
  });

  it("station-only ids are NOT in the tool registry before advertisement", () => {
    for (const id of STATION_ONLY_IDS) {
      expect(toolRegistry.get(id), id).toBeUndefined();
    }
    // Colliding ids already resolve — to the ORIGINAL tools.
    for (const id of COLLIDING_IDS) {
      expect(toolRegistry.get(id), id).toBeDefined();
    }
  });
});

describe("advertisement (agent-loop-v2 module load)", () => {
  it("importing agent-loop-v2 advertises station-only ids; collisions keep the originals", async () => {
    const originals = new Map(COLLIDING_IDS.map((id) => [id, toolRegistry.get(id)] as const));
    await import("@/lib/litt-intelligence/agent-loop-v2");

    for (const id of STATION_ONLY_IDS) {
      expect(toolRegistry.get(id), id).toBeDefined();
    }
    // Additive only: identity check proves the original def was not replaced.
    for (const id of COLLIDING_IDS) {
      expect(toolRegistry.get(id)).toBe(originals.get(id));
    }
    // Sync is idempotent — a second call changes nothing.
    registerAllStationActions();
    for (const id of COLLIDING_IDS) {
      expect(toolRegistry.get(id)).toBe(originals.get(id));
    }
  });

  it("advertised station defs flow through the existing listEnabled path", () => {
    const enabledIds = new Set(toolRegistry.listEnabled().map((t) => t.id));
    for (const id of STATION_ONLY_IDS) {
      expect(enabledIds.has(id), id).toBe(true);
    }
  });

  it("a mutating station def gets requiresApproval from the permission engine like its delegate", () => {
    // NOTE: files.delete collides, so the advertised def IS the original —
    // this compares the station def the bridge *would* advertise against
    // that original through the real PermissionEngine.
    const stationDef = stationActionToToolDefinition(getStationAction("files.delete")!);
    const delegateDef = toolRegistry.get("files.delete")!;
    expect(Object.keys(toPermissionInfoMirror(stationDef)).sort()).toEqual(
      Object.keys(toPermissionInfoMirror(delegateDef)).sort(),
    );
    const engine = new PermissionEngine();
    const stationRes = engine.check(toPermissionInfoMirror(stationDef), {}, "act", []);
    const delegateRes = engine.check(toPermissionInfoMirror(delegateDef), {}, "act", []);
    expect(stationRes.requiresApproval).toBe(true);
    expect(delegateRes.requiresApproval).toBe(true);
    expect(stationRes.requiresApproval).toBe(delegateRes.requiresApproval);
  });
});

describe("executor", () => {
  it("unknown action → unknown_action", async () => {
    const { ctx } = makeCtx();
    const res = await executeStationAction("nope.action", {}, ctx);
    expect(res).toMatchObject({ success: false, errorCode: "unknown_action" });
  });

  it("approval gate: files.delete without hasApproval → approval_required and delegate NOT called; with hasApproval → delegates", async () => {
    const spy = vi
      .spyOn(toolRegistry, "execute")
      .mockImplementation(async (id: string) => {
        if (id === "files.delete") return { ok: true, result: { success: true } };
        return { ok: false, error: `unexpected tool ${id}` };
      });
    try {
      const deniedCtx = makeCtx(); // hasApproval defaults to false
      const denied = await executeStationAction("files.delete", { path: "notes.txt" }, deniedCtx.ctx);
      expect(denied).toMatchObject({ success: false, errorCode: "approval_required" });
      expect(spy).not.toHaveBeenCalledWith(
        "files.delete",
        expect.anything(),
        expect.anything(),
      );
      expect(deniedCtx.events.some((e) => e.type === "approval_required")).toBe(true);

      const allowedCtx = makeCtx({ hasApproval: true });
      const allowed = await executeStationAction(
        "files.delete",
        { path: "notes.txt" },
        allowedCtx.ctx,
      );
      expect(allowed).toMatchObject({ success: true });
      expect(spy).toHaveBeenCalledWith(
        "files.delete",
        { path: "notes.txt" },
        expect.objectContaining({ hasApproval: true }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("honest failure: video.generate with no provider keys → not_configured", async () => {
    const { ctx } = makeCtx({ hasApproval: true });
    // Stage a first-frame image as a bare HTTPS URL — resolveAssetUrl takes
    // the direct path, so no network is touched before the provider check.
    setCreatorParams(creatorKey(ctx), { referenceAssetId: "https://example.com/frame.png" });
    const res = await executeStationAction("video.generate", {}, ctx);
    expect(res).toMatchObject({ success: false, errorCode: "not_configured" });
  });

  it("event order: action_started → action_completed via a recording emitEvent", async () => {
    const { ctx, events } = makeCtx({ hasApproval: true });
    const res = await executeStationAction("image.setPrompt", { prompt: "a red bicycle" }, ctx);
    expect(res).toMatchObject({ success: true });
    expect(events.map((e) => e.type)).toEqual(["action_started", "action_completed"]);
    expect(events[0].actionId).toBe("image.setPrompt");
    expect(events[1].actionId).toBe("image.setPrompt");
  });

  it("true end-to-end through the real registry execute path (image.setPrompt, pure creator-state)", async () => {
    const transport = {};
    const seen: string[] = [];
    setStationEventSink(transport, (e) => seen.push(`${e.type}:${e.actionId}`));
    try {
      const out = await toolRegistry.execute(
        "image.setPrompt",
        { prompt: "a red bicycle" },
        { transport, hasApproval: true },
      );
      expect(out.ok).toBe(true);
      if (out.ok) {
        expect(out.result).toMatchObject({ success: true, prompt: "a red bicycle" });
      }
      expect(seen).toEqual([
        "action_started:image.setPrompt",
        "action_completed:image.setPrompt",
      ]);
    } finally {
      setStationEventSink(transport, null);
    }
  });
});

describe("loop-events", () => {
  it("summarizeStationEvent produces human Activity summaries", () => {
    expect(
      summarizeStationEvent({ type: "action_started", actionId: "image.generate", station: "image", summary: "x" }),
    ).toBe("Creating image…");
    expect(
      summarizeStationEvent({ type: "action_completed", actionId: "files.read", station: "files", summary: "x" }),
    ).toBe("Editing files — done");
    expect(
      summarizeStationEvent({ type: "approval_required", actionId: "files.delete", station: "files", summary: "x" }),
    ).toBe("Waiting for approval");
    expect(
      summarizeStationEvent({ type: "action_failed", actionId: "browser.navigate", station: "browser", summary: "x", error: "boom" }),
    ).toBe("Browsing — failed: boom");
    expect(
      summarizeStationEvent({ type: "live_state", actionId: "live-state", station: "preview", summary: "x" }),
    ).toBe("Live update");
  });

  it("set/get/clear round-trips; non-object transports are safe no-ops", () => {
    const t = {};
    const fn = () => undefined;
    expect(getStationEventSink(t)).toBeNull();
    setStationEventSink(t, fn);
    expect(getStationEventSink(t)).toBe(fn);
    setStationEventSink(t, null);
    expect(getStationEventSink(t)).toBeNull();
    expect(getStationEventSink(undefined)).toBeNull();
    expect(() => setStationEventSink("nope", fn)).not.toThrow();
  });

  it("sinks are isolated per transport (concurrent runs cannot cross-wire)", async () => {
    const t1 = {};
    const t2 = {};
    const seen1: string[] = [];
    const seen2: string[] = [];
    setStationEventSink(t1, (e) => seen1.push(e.type));
    setStationEventSink(t2, (e) => seen2.push(e.type));
    try {
      const out = await toolRegistry.execute(
        "image.setPrompt",
        { prompt: "isolation check" },
        { transport: t1, hasApproval: true },
      );
      expect(out.ok).toBe(true);
      expect(seen1).toEqual(["action_started", "action_completed"]);
      expect(seen2).toEqual([]);
    } finally {
      setStationEventSink(t1, null);
      setStationEventSink(t2, null);
    }
  });
});

describe("agent loop integration", () => {
  it("a station tool call emits human summaries into the run's Activity stream; the sink is cleared when the run ends", async () => {
    mockCallLLM
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "tc-1", toolId: "assets.search", inputs: {} }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "Done.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      });

    const { runAgentLoopV2 } = await import("@/lib/litt-intelligence/agent-loop-v2");
    const transport = {
      workspaceId: "ws-sink",
      userId: "u-sink",
      workspaceRoot: "/tmp/sink",
      projectId: "p-sink",
      createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    } as unknown as WorkspaceTransport;

    const result = await runAgentLoopV2("search my assets", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    });

    const statusSummaries = result.events
      .filter((e) => e.type === "status")
      .map((e) => (e as { summary: string }).summary);
    // assets.search is read-only and station-only: the loop executes it, the
    // sink routes action_started/action_failed through summarizeStationEvent.
    expect(statusSummaries.some((s) => s.startsWith("Managing assets"))).toBe(true);
    // Sink released in the wrapper's finally — no leak for the next run.
    expect(getStationEventSink(transport)).toBeNull();
  });
});
