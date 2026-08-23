/**
 * Tool Progress — regression coverage for the structured per-tool view.
 *
 * Canonical tool lifecycle path under test:
 *   agent-loop emitter (agent_tool_call / agent_tool_result)
 *     → SessionEventBridge maps to LifecycleEvents (tool.started /
 *       tool.completed / tool.failed / tool.stdout)
 *     → EventBridge updateToolProgress() → ToolProgressStore mutations
 *     → CockpitStore hook mirrors snapshot → ToolProgress renderer
 *
 * The invariants are enforced at the ToolProgressStore level (the pure
 * canonical state) so they are testable in the CLI's `node` test env
 * without a React renderer — same pattern as ChatTranscriptStore.
 *
 * Invariants enforced:
 *   1. startTool is idempotent per toolCallId (no duplicate entries).
 *   2. completeTool/failTool only update running entries (no-op on terminal).
 *   3. appendChunk only updates running entries (no-op on completed).
 *   4. The store is bounded to the last MAX_TOOLS entries.
 *   5. startMission resets tool entries.
 *   6. completeMission/failMission set terminal state, preserve entries.
 *   7. clear() resets everything.
 *   8. Friendly labels are applied from tool-labels.ts.
 *   9. Concise summaries are derived from tool result messages.
 *  10. The full "Scan for errors" lifecycle (inspect → check → test →
 *      build) produces the expected structured view.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ToolProgressStore, MAX_TOOLS } from "../ink/tool-progress-store.js";
import { toolLabel, toolSummary } from "../lib/tool-labels.js";

// ─── Helpers ──────────────────────────────────────────────────────

/** Simulate a full tool lifecycle (start → complete) on the store. */
function runTool(
  store: ToolProgressStore,
  toolCallId: string,
  toolId: string,
  toolName: string,
  result: { success: boolean; message: string; durationMs?: number },
): void {
  store.startTool(toolCallId, toolId, toolName);
  store.completeTool(toolCallId, result.success, result.message, result.durationMs);
}

// ─── ToolProgressStore invariants ─────────────────────────────────

describe("ToolProgressStore", () => {
  let store: ToolProgressStore;

  beforeEach(() => {
    store = new ToolProgressStore();
  });

  describe("startTool", () => {
    it("creates a running entry with a friendly label", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      const snap = store.snapshot();
      expect(snap.entries).toHaveLength(1);
      expect(snap.entries[0].status).toBe("running");
      expect(snap.entries[0].label).toBe("Type checking");
      expect(snap.hasRunning).toBe(true);
    });

    it("is idempotent per toolCallId — no duplicate entries", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.startTool("tc_1", "project.check", "check");
      store.startTool("tc_1", "project.check", "check");
      expect(store.snapshot().entries).toHaveLength(1);
    });

    it("ignores empty toolCallId", () => {
      store.startMission();
      store.startTool("", "project.check", "check");
      expect(store.snapshot().entries).toHaveLength(0);
    });
  });

  describe("completeTool", () => {
    it("marks a running tool completed with a concise summary", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.completeTool("tc_1", true, "926 passing, 4 skipped, 0 failed", 5000);
      const snap = store.snapshot();
      expect(snap.entries[0].status).toBe("completed");
      expect(snap.entries[0].summary).toBe("926 passed · 4 skipped");
      expect(snap.entries[0].durationMs).toBe(5000);
      expect(snap.hasRunning).toBe(false);
    });

    it("marks a failed tool with the error summary", () => {
      store.startMission();
      store.startTool("tc_1", "project.build", "build");
      store.completeTool("tc_1", false, "Build failed: syntax error in src/index.ts\n  at line 42", 3000);
      const snap = store.snapshot();
      expect(snap.entries[0].status).toBe("failed");
      expect(snap.entries[0].summary).toContain("Build failed: syntax error");
    });

    it("is a no-op on an unknown toolCallId", () => {
      store.startMission();
      store.completeTool("tc_unknown", true, "success", 100);
      expect(store.snapshot().entries).toHaveLength(0);
    });

    it("is a no-op on an already-terminal entry", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.completeTool("tc_1", true, "0 errors", 100);
      store.completeTool("tc_1", false, "error", 200);
      const snap = store.snapshot();
      expect(snap.entries[0].status).toBe("completed");
      expect(snap.entries[0].summary).toBe("0 errors");
    });
  });

  describe("failTool", () => {
    it("is an alias for completeTool with success=false", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.failTool("tc_1", "TypeScript: 3 errors found", 2000);
      const snap = store.snapshot();
      expect(snap.entries[0].status).toBe("failed");
      expect(snap.entries[0].summary).toContain("3 errors found");
    });
  });

  describe("terminalTool (cancelled/timeout)", () => {
    it("marks a tool cancelled", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.terminalTool("tc_1", "cancelled", "User cancelled");
      expect(store.snapshot().entries[0].status).toBe("cancelled");
      expect(store.snapshot().entries[0].summary).toBe("Cancelled");
    });

    it("marks a tool timed out", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.terminalTool("tc_1", "timeout", "Exceeded 30s", 30000);
      expect(store.snapshot().entries[0].status).toBe("timeout");
      expect(store.snapshot().entries[0].summary).toBe("Timed out");
    });
  });

  describe("appendChunk", () => {
    it("updates lastChunk on a running tool", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.appendChunk("tc_1", "Running test suite...\n");
      expect(store.snapshot().entries[0].lastChunk).toBe("Running test suite...");
    });

    it("is a no-op on a completed tool", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.completeTool("tc_1", true, "926 passed", 1000);
      store.appendChunk("tc_1", "late chunk");
      expect(store.snapshot().entries[0].lastChunk).toBeNull();
    });

    it("ignores empty/whitespace chunks", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      store.appendChunk("tc_1", "   \n  ");
      expect(store.snapshot().entries[0].lastChunk).toBeNull();
    });

    it("truncates long chunks to 80 chars", () => {
      store.startMission();
      store.startTool("tc_1", "project.test", "test");
      const long = "x".repeat(200);
      store.appendChunk("tc_1", long);
      expect(store.snapshot().entries[0].lastChunk?.length).toBe(80);
    });
  });

  describe("mission lifecycle", () => {
    it("startMission resets entries and sets missionActive", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      expect(store.snapshot().entries).toHaveLength(1);
      store.startMission();
      const snap = store.snapshot();
      expect(snap.entries).toHaveLength(0);
      expect(snap.missionActive).toBe(true);
      expect(snap.missionStatus).toBeNull();
    });

    it("completeMission sets terminal state, preserves entries", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.completeTool("tc_1", true, "0 errors", 100);
      store.completeMission();
      const snap = store.snapshot();
      expect(snap.missionActive).toBe(false);
      expect(snap.missionStatus).toBe("completed");
      expect(snap.entries).toHaveLength(1); // preserved
    });

    it("failMission sets terminal state, preserves entries", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.failTool("tc_1", "3 errors", 100);
      store.failMission();
      const snap = store.snapshot();
      expect(snap.missionActive).toBe(false);
      expect(snap.missionStatus).toBe("failed");
      expect(snap.entries).toHaveLength(1);
    });
  });

  describe("bounding", () => {
    it("bounds to the last MAX_TOOLS entries", () => {
      store.startMission();
      for (let i = 0; i < MAX_TOOLS + 5; i++) {
        store.startTool(`tc_${i}`, "project.check", "check");
        store.completeTool(`tc_${i}`, true, "ok", 10);
      }
      expect(store.snapshot().entries.length).toBeLessThanOrEqual(MAX_TOOLS);
    });
  });

  describe("clear", () => {
    it("resets everything", () => {
      store.startMission();
      store.startTool("tc_1", "project.check", "check");
      store.completeTool("tc_1", true, "0 errors", 100);
      store.completeMission();
      store.clear();
      const snap = store.snapshot();
      expect(snap.entries).toHaveLength(0);
      expect(snap.missionActive).toBe(false);
      expect(snap.missionStatus).toBeNull();
    });
  });

  describe("isEmpty", () => {
    it("is true when no entries and no active mission", () => {
      expect(store.isEmpty()).toBe(true);
    });
    it("is false when a mission is active", () => {
      store.startMission();
      expect(store.isEmpty()).toBe(false);
    });
    it("is false when there are entries", () => {
      store.startTool("tc_1", "project.check", "check");
      expect(store.isEmpty()).toBe(false);
    });
  });
});

// ─── Full "Scan for errors" lifecycle ─────────────────────────────

describe("Scan for errors lifecycle (inspect → check → test → build)", () => {
  it("produces the expected structured view", () => {
    const store = new ToolProgressStore();
    store.startMission();

    // inspect_package
    store.startTool("tc_1", "inspect_package", "inspect_package");
    store.completeTool("tc_1", true, "package.json valid, 57 routes detected", 120);

    // check (typecheck)
    store.startTool("tc_2", "project.check", "check");
    store.completeTool("tc_2", true, "0 errors", 4500);

    // test
    store.startTool("tc_3", "project.test", "test");
    store.appendChunk("tc_3", "926 passing");
    store.completeTool("tc_3", true, "926 passing, 4 skipped", 12000);

    // build
    store.startTool("tc_4", "project.build", "build");
    store.completeTool("tc_4", true, "Build successful", 30000);

    store.completeMission();

    const snap = store.snapshot();
    expect(snap.entries).toHaveLength(4);
    expect(snap.missionStatus).toBe("completed");

    // Labels are friendly
    expect(snap.entries[0].label).toBe("Inspecting workspace");
    expect(snap.entries[1].label).toBe("Type checking");
    expect(snap.entries[2].label).toBe("Running tests");
    expect(snap.entries[3].label).toBe("Production build");

    // All completed
    for (const entry of snap.entries) {
      expect(entry.status).toBe("completed");
    }

    // Summaries are concise
    expect(snap.entries[1].summary).toBe("0 errors");
    expect(snap.entries[2].summary).toBe("926 passed · 4 skipped");
    expect(snap.entries[3].summary).toBe("Build successful");
  });

  it("shows a running tool mid-scan with a live chunk", () => {
    const store = new ToolProgressStore();
    store.startMission();

    store.startTool("tc_1", "inspect_package", "inspect_package");
    store.completeTool("tc_1", true, "package.json valid", 120);

    store.startTool("tc_2", "project.check", "check");
    store.completeTool("tc_2", true, "0 errors", 4500);

    store.startTool("tc_3", "project.test", "test");
    store.appendChunk("tc_3", "734 / 926...");

    const snap = store.snapshot();
    expect(snap.hasRunning).toBe(true);
    const running = snap.entries[2];
    expect(running.status).toBe("running");
    expect(running.lastChunk).toBe("734 / 926...");
    expect(running.summary).toBeNull();
  });

  it("shows a failed tool in the scan", () => {
    const store = new ToolProgressStore();
    store.startMission();

    store.startTool("tc_1", "inspect_package", "inspect_package");
    store.completeTool("tc_1", true, "ok", 100);

    store.startTool("tc_2", "project.check", "check");
    store.completeTool("tc_2", true, "0 errors", 4000);

    store.startTool("tc_3", "project.test", "test");
    store.failTool("tc_3", "3 tests failed: utils.test.ts", 8000);

    store.failMission();

    const snap = store.snapshot();
    expect(snap.missionStatus).toBe("failed");
    expect(snap.entries[2].status).toBe("failed");
    expect(snap.entries[2].summary).toContain("3 tests failed");
  });
});

// ─── tool-labels mapping ──────────────────────────────────────────

describe("toolLabel", () => {
  it("maps canonical tool ids to friendly labels", () => {
    expect(toolLabel("project.check")).toBe("Type checking");
    expect(toolLabel("project.test")).toBe("Running tests");
    expect(toolLabel("project.build")).toBe("Production build");
    expect(toolLabel("inspect_package")).toBe("Inspecting workspace");
  });

  it("falls back to tool name when toolId is unknown", () => {
    expect(toolLabel("custom.tool", "check")).toBe("Type checking");
  });

  it("uses keyword matching for unknown tools", () => {
    expect(toolLabel("my.custom.typecheck.tool")).toBe("Type checking");
    expect(toolLabel("my.custom.build.step")).toBe("Production build");
  });

  it("title-cases the raw name as last resort, never 'unknown'", () => {
    expect(toolLabel("totally_unknown_tool", "unknown")).toBe("Working");
    expect(toolLabel("totally_unknown_tool", "myTool")).toBe("MyTool");
  });
});

describe("toolSummary", () => {
  it("extracts test pass/skip counts", () => {
    expect(toolSummary("project.test", true, "926 passing, 4 skipped")).toBe("926 passed · 4 skipped");
  });

  it("extracts typecheck error count", () => {
    expect(toolSummary("project.check", true, "typecheck: 0 errors")).toBe("0 errors");
    expect(toolSummary("project.check", true, "typecheck: 3 errors found")).toBe("3 errors");
  });

  it("returns 'Build successful' for build messages", () => {
    expect(toolSummary("project.build", true, "compiled successfully")).toBe("Build successful");
  });

  it("truncates long failure messages", () => {
    const long = "x".repeat(100);
    const summary = toolSummary("project.test", false, long);
    expect(summary.length).toBeLessThanOrEqual(72);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("returns first line for generic success", () => {
    expect(toolSummary("project.run", true, "done\nextra output")).toBe("done");
  });
});
