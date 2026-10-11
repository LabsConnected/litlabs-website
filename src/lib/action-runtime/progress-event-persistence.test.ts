// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

const admin = {
  rpc: mocks.rpc,
  from: mocks.from,
};

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => admin,
}));

import { listActionEvents } from "./run-store";
import {
  makePersistProgressEvent,
  mapProgressEventToActionEvent,
} from "./progress-event-persistence";
import type { ProgressEvent } from "@/lib/litt-intelligence/progress-events";

const runId = "11111111-1111-1111-1111-111111111111";
const userId = "user-one";

function appendEventRow(type: string, payload: Record<string, unknown>) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    sequence: "9007199254740993",
    run_id: runId,
    user_id: userId,
    type,
    created_at: "2026-09-28T00:00:03.000Z",
    payload,
  };
}

describe("mapProgressEventToActionEvent", () => {
  it("maps tool_start to tool.started with a human label", () => {
    const mapped = mapProgressEventToActionEvent({
      type: "tool_start",
      toolId: "files.write",
      summary: "Writing index.html",
    });
    expect(mapped?.type).toBe("tool.started");
    expect(mapped?.payload.toolId).toBe("files.write");
    expect(mapped?.payload.label).toBe("Writing index.html");
    expect(mapped?.payload.emittedAt).toEqual(expect.any(String));
  });

  it("maps tool_result success/failure to tool.completed/tool.failed", () => {
    const ok = mapProgressEventToActionEvent({
      type: "tool_result",
      toolId: "files.write",
      success: true,
      summary: "Wrote index.html",
      durationMs: 120,
    });
    expect(ok?.type).toBe("tool.completed");
    const failed = mapProgressEventToActionEvent({
      type: "tool_result",
      toolId: "files.write",
      success: false,
      summary: "Write failed",
      durationMs: 30,
    });
    expect(failed?.type).toBe("tool.failed");
  });

  it("maps checkpoint, build_result, and workspace_change to agent.status with kinds", () => {
    const checkpoint = mapProgressEventToActionEvent({
      type: "checkpoint",
      label: "Pre-launch",
      gitSha: "abc123",
    });
    expect(checkpoint?.type).toBe("agent.status");
    expect(checkpoint?.payload.kind).toBe("checkpoint");
    expect(checkpoint?.payload.label).toBe("Checkpoint: Pre-launch");

    const build = mapProgressEventToActionEvent({
      type: "build_result",
      check: "typecheck",
      passed: false,
      errorCount: 3,
    });
    expect(build?.payload.kind).toBe("build_result");
    expect(build?.payload.label).toBe("Check failed: typecheck");

    const change = mapProgressEventToActionEvent({
      type: "workspace_change",
      status: "changed",
      files: ["index.html", "styles.css"],
      additions: 120,
      deletions: 4,
    });
    expect(change?.payload.kind).toBe("workspace_change");
    expect(change?.payload.label).toContain("2 files");
    expect(change?.payload.files).toEqual(["index.html", "styles.css"]);
  });

  it("maps finished to agent.completed (or agent.failed) and cancelled to run.cancelled", () => {
    const done = mapProgressEventToActionEvent({ type: "finished", totalSteps: 12, totalDurationMs: 5000 });
    expect(done?.type).toBe("agent.completed");
    const failed = mapProgressEventToActionEvent({
      type: "finished",
      totalSteps: 3,
      totalDurationMs: 1000,
      success: false,
    });
    expect(failed?.type).toBe("agent.failed");
    const cancelled = mapProgressEventToActionEvent({ type: "cancelled", reason: "user stop" });
    expect(cancelled?.type).toBe("run.cancelled");
  });

  it("maps approval_required, preview_result, and deploy_result", () => {
    expect(
      mapProgressEventToActionEvent({ type: "approval_required", toolId: "deploy.netlify", reason: "publish" })?.type,
    ).toBe("approval.required");
    expect(
      mapProgressEventToActionEvent({ type: "preview_result", success: true, previewUrl: "https://x" })?.type,
    ).toBe("preview.ready");
    expect(
      mapProgressEventToActionEvent({ type: "deploy_result", success: false, error: "boom" })?.type,
    ).toBe("deployment.failed");
  });

  it("skips stream-noise types (phase, status, step_timing, model_routing, model_response)", () => {
    const noise: ProgressEvent[] = [
      { type: "phase", phase: "call_llm", step: 3 },
      { type: "status", summary: "Step 3: reasoning" },
      { type: "step_timing", step: 3, stepDurationMs: 100, elapsedMs: 500 },
      { type: "model_routing", model: "m", provider: "p" },
      {
        type: "model_response",
        provider: "p",
        model: "m",
        finishReason: "stop",
        contentType: "text",
        contentLength: 10,
        messageKeys: [],
        toolCalls: [],
      },
    ];
    for (const event of noise) {
      expect(mapProgressEventToActionEvent(event)).toBeNull();
    }
  });

  it("truncates oversized diffs in workspace_change payloads", () => {
    const mapped = mapProgressEventToActionEvent({
      type: "workspace_change",
      status: "changed",
      files: ["a.ts"],
      diff: "x".repeat(10_000),
    });
    expect((mapped?.payload.diff as string).length).toBeLessThan(10_000);
    expect(mapped?.payload.diffTruncated).toBe(true);
  });
});

describe("makePersistProgressEvent — persist-then-list round trip", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
  });

  it("persists a mapped loop event via appendActionEvent and skips noise events", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: appendEventRow("tool.started", { toolId: "files.write", label: "Writing index.html" }),
      error: null,
    });
    const persist = makePersistProgressEvent({ runId, userId });

    await persist({ type: "tool_start", toolId: "files.write", summary: "Writing index.html" });
    expect(mocks.rpc).toHaveBeenCalledWith("action_runtime_append_event", {
      p_run_id: runId,
      p_user_id: userId,
      p_type: "tool.started",
      p_payload: expect.objectContaining({ toolId: "files.write", label: "Writing index.html" }),
    });

    // Noise events never reach the DB.
    await persist({ type: "status", summary: "Step 3: reasoning" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("lists the persisted events back through listActionEvents", async () => {
    const row = appendEventRow("tool.started", { toolId: "files.write", label: "Writing index.html" });
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
        return resolve({ data: [row], error: null });
      },
    };
    // getOwnedRunRow check inside listActionEvents
    const ownedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: runId, user_id: userId }, error: null }),
    };
    mocks.from.mockReturnValueOnce(ownedQuery).mockReturnValueOnce(query);

    const events = await listActionEvents(runId, userId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("tool.started");
    expect(events[0].runId).toBe(runId);
    expect(events[0].sequence).toBe("9007199254740993");
    expect((events[0].payload as Record<string, unknown>).label).toBe("Writing index.html");
  });

  it("propagates persistence failures so the loop's chain can log and continue", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("db down"));
    const persist = makePersistProgressEvent({ runId, userId });
    await expect(
      persist({ type: "tool_start", toolId: "files.write", summary: "x" }),
    ).rejects.toThrow("db down");
  });
});
