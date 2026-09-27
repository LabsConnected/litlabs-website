import { beforeEach, describe, expect, it } from "vitest";
import {
  deriveWorktabBadge,
  feedSSEEventToExecutionStore,
  useExecutionStore,
  type WorktabBadgeSnapshot,
} from "./useExecutionStore";
function seedTabs() {
  // The shell feeds this index from the durable server task list
  // (GET /api/studio/tasks); the store never owns tab state itself.
  useExecutionStore.getState().setTaskConversationIndex([
    { id: "tab-a", conversationId: "conv-a" },
    { id: "tab-b", conversationId: "conv-b" },
  ]);
}

describe("per-task event scoping (F1 slice C)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("tags SSE-ingested events with the active worktab id", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    feedSSEEventToExecutionStore({ type: "status", summary: "hello" });

    const events = useExecutionStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].taskId).toBe("worktab-a");
  });

  it("does not leak events across tasks", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    feedSSEEventToExecutionStore({ type: "status", summary: "for a" });
    s.setActiveTaskId("worktab-b");
    feedSSEEventToExecutionStore({ type: "status", summary: "for b" });

    const st = useExecutionStore.getState();
    expect(st.eventsForTask("worktab-a").map((e) => e.summary)).toEqual(["for a"]);
    expect(st.eventsForTask("worktab-b").map((e) => e.summary)).toEqual(["for b"]);
  });

  it("eventsForTask() with no taskId keeps the global behavior (all events)", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    feedSSEEventToExecutionStore({ type: "status", summary: "for a" });
    s.setActiveTaskId(null);
    feedSSEEventToExecutionStore({ type: "status", summary: "untagged" });

    const st = useExecutionStore.getState();
    expect(st.eventsForTask()).toHaveLength(2);
    expect(st.eventsForTask("worktab-a")).toHaveLength(1);
  });

  it("phaseForTask tracks per-task phases without cross-talk", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    s.startRun();

    expect(useExecutionStore.getState().phaseForTask("worktab-a")).toBe("planning");
    // Backwards-compat: no taskId → the global phase.
    expect(useExecutionStore.getState().phaseForTask()).toBe("planning");

    s.setActiveTaskId("worktab-b");
    // Task B has no recorded work → honest "idle", not task A's phase.
    expect(useExecutionStore.getState().phaseForTask("worktab-b")).toBe("idle");

    s.setPhase("verifying");
    expect(useExecutionStore.getState().phaseForTask("worktab-b")).toBe("verifying");
    // Task A's phase is untouched by task B's transitions.
    expect(useExecutionStore.getState().phaseForTask("worktab-a")).toBe("planning");
    // Unknown task → idle.
    expect(useExecutionStore.getState().phaseForTask("nope")).toBe("idle");
  });

  it("approval gates mirror into the active task's phase", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    s.setPendingApproval({
      toolId: "deploy",
      reason: "needs approval",
      pausedRunId: "pr-1",
    });

    expect(useExecutionStore.getState().phaseForTask("worktab-a")).toBe(
      "awaiting_approval",
    );
  });

  it("endRun records the terminal phase per task", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    s.startRun();
    feedSSEEventToExecutionStore({ type: "finished", success: true, totalSteps: 3 });
    s.endRun();

    // The finished SSE drove the global phase to done; the mirror kept
    // task A's view in sync.
    expect(useExecutionStore.getState().phaseForTask("worktab-a")).toBe("done");
  });

  it("reset clears task scoping state", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("worktab-a");
    s.setTaskConversationIndex([{ id: "worktab-a", conversationId: "conv-a" }]);
    s.startRun();
    s.reset();

    const st = useExecutionStore.getState();
    expect(st.activeTaskId).toBeNull();
    expect(st.taskConversationIndex).toEqual({});
    expect(st.phaseForTask("worktab-a")).toBe("idle");
    expect(st.eventsForTask("worktab-a")).toHaveLength(0);
  });

  it("setTaskConversationIndex no-ops when the mapping is unchanged", () => {
    const s = useExecutionStore.getState();
    const entries = [{ id: "tab-a", conversationId: "conv-a" }];
    s.setTaskConversationIndex(entries);
    const before = useExecutionStore.getState().taskConversationIndex;
    s.setTaskConversationIndex([{ id: "tab-a", conversationId: "conv-a" }]);
    // Same mapping → same object identity, no spurious subscriber updates.
    expect(useExecutionStore.getState().taskConversationIndex).toBe(before);
    // A real change replaces the index.
    s.setTaskConversationIndex([{ id: "tab-a", conversationId: "conv-a" }, { id: "tab-b", conversationId: "conv-b" }]);
    expect(useExecutionStore.getState().taskConversationIndex).toEqual({
      "conv-a": "tab-a",
      "conv-b": "tab-b",
    });
  });

  it("attributes SSE events to the tab OWNING the conversation, not the active tab", () => {
    seedTabs();
    const s = useExecutionStore.getState();
    // User switched to tab B, but the run belongs to tab A's conversation.
    s.setActiveTaskId("tab-b");
    feedSSEEventToExecutionStore(
      { type: "status", summary: "still working" },
      "conv-a",
    );

    const st = useExecutionStore.getState();
    expect(st.eventsForTask("tab-a").map((e) => e.summary)).toEqual([
      "still working",
    ]);
    expect(st.eventsForTask("tab-b")).toHaveLength(0);
  });

  it("phase events move the owning tab's phase across switches", () => {
    seedTabs();
    const s = useExecutionStore.getState();
    s.setActiveTaskId("tab-b");
    feedSSEEventToExecutionStore(
      { type: "phase", phase: "editing", step: 2 },
      "conv-a",
    );

    const st = useExecutionStore.getState();
    expect(st.phaseForTask("tab-a")).toBe("editing");
    // Tab B never ran — honest idle, not polluted by tab A's stream.
    expect(st.phaseForTask("tab-b")).toBe("idle");
  });

  it("falls back to the active task when the conversation is not bound to a tab", () => {
    seedTabs();
    const s = useExecutionStore.getState();
    s.setActiveTaskId("tab-b");
    feedSSEEventToExecutionStore(
      { type: "status", summary: "unbound" },
      "conv-unknown",
    );

    expect(
      useExecutionStore.getState().eventsForTask("tab-b").map((e) => e.summary),
    ).toEqual(["unbound"]);
  });
});

describe("deriveWorktabBadge (F1 slice C)", () => {
  const snap = (s: WorktabBadgeSnapshot) => ({ "task-1": s });

  it("reports working while the task's execution phase is live", () => {
    for (const phase of [
      "planning",
      "inspecting",
      "editing",
      "testing",
      "verifying",
    ] as const) {
      expect(deriveWorktabBadge("task-1", snap({ executionPhase: phase }))).toBe(
        "working",
      );
    }
  });

  it("reports working from an active action-run displayState", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "idle", actionRunDisplayState: "running" }),
      ),
    ).toBe("working");
  });

  it("reports needs-approval when the execution phase is awaiting_approval", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "awaiting_approval", actionRunDisplayState: "completed" }),
      ),
    ).toBe("needs-approval");
  });

  it("reports needs-approval from the projection even when the phase moved on", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "idle", actionRunDisplayState: "awaiting_approval" }),
      ),
    ).toBe("needs-approval");
  });

  it("reports ready only on completed-with-evidence", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "done", actionRunDisplayState: "completed" }),
      ),
    ).toBe("ready");
  });

  it("never reports ready on phase done alone (no optimistic states)", () => {
    expect(deriveWorktabBadge("task-1", snap({ executionPhase: "done" }))).toBe(
      "idle",
    );
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "done", actionRunDisplayState: null }),
      ),
    ).toBe("idle");
  });

  it("does not report ready when the projection disagrees", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "done", actionRunDisplayState: "failed" }),
      ),
    ).toBe("idle");
  });

  it("reports idle for failed/cancelled runs and unknown tasks", () => {
    expect(
      deriveWorktabBadge(
        "task-1",
        snap({ executionPhase: "failed", actionRunDisplayState: "failed" }),
      ),
    ).toBe("idle");
    expect(
      deriveWorktabBadge("task-1", snap({ executionPhase: "cancelled" })),
    ).toBe("idle");
    expect(deriveWorktabBadge("task-1", {})).toBe("idle");
    expect(deriveWorktabBadge("unknown-task", snap({ executionPhase: "done", actionRunDisplayState: "completed" }))).toBe("idle");
  });
});
