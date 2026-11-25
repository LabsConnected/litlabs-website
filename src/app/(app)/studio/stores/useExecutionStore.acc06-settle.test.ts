import { beforeEach, describe, expect, it } from "vitest";
import {
  deriveWorktabBadge,
  useExecutionStore,
  type WorktabBadgeSnapshot,
} from "./useExecutionStore";

/**
 * ACC-06a item 2 — terminal settles must land on the run's OWNING
 * worktab, not whichever tab happens to be active when the settle
 * arrives.
 *
 * Production proof on 8cd7728c (2026-11-25 ~02:43 ET): the build's
 * work landed and Activity read "Complete", yet the worktab kept
 * showing "Run in progress" 25+ minutes later. The transcript
 * (message status) and the activity task settle server-side, but the
 * client-side terminal settles — applyApprovalOutcome's
 * settleResumedRun for approval-resumed runs (which never stream
 * SSE) and the canonical reconciler's endRun — mirrored the
 * terminal phase only into the ACTIVE tab's entry. The owning tab
 * kept its working phase forever, and deriveWorktabBadge kept
 * reporting "working".
 */
function seedTabs() {
  useExecutionStore.getState().setTaskConversationIndex([
    { id: "tab-a", conversationId: "conv-a" },
    { id: "tab-b", conversationId: "conv-b" },
  ]);
}

function badgeFor(taskId: string, displayState: WorktabBadgeSnapshot["actionRunDisplayState"]) {
  const snapshot: WorktabBadgeSnapshot = {
    executionPhase: useExecutionStore.getState().phaseForTask(taskId),
    actionRunDisplayState: displayState,
  };
  return deriveWorktabBadge(taskId, { [taskId]: snapshot });
}

describe("ACC-06a — terminal settles attribute to the owning worktab", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    seedTabs();
  });

  it("settleResumedRun clears the owning tab's label when another tab is active", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("tab-a");
    // The run's working phases attribute to its owning tab (the SSE
    // ingestion path resolves the stream's conversation the same way).
    s.setPhase("editing", "tab-a");
    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("editing");
    expect(badgeFor("tab-a", "running")).toBe("working");

    // The user switches to tab B before the approval-resumed run's
    // outcome lands (resumed runs never stream SSE to this client).
    s.setActiveTaskId("tab-b");
    useExecutionStore.getState().settleResumedRun("completed", "conv-a");

    // The owning tab settles: phase done, badge leaves "working".
    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("done");
    expect(badgeFor("tab-a", "completed")).toBe("ready");
    // Tab B never ran anything: its badge cannot claim "ready" —
    // readiness requires B's own action-run projection to confirm
    // completion, and B has none (the store's global phase mirrors
    // to the active tab by design, but the badge's evidence rule
    // keeps that from becoming a false ready).
    expect(badgeFor("tab-b", null)).toBe("idle");
  });

  it("endRun from the canonical reconciler settles the owning tab, not the active one", () => {
    const s = useExecutionStore.getState();
    s.setPhase("verifying", "tab-a");
    s.setActiveTaskId("tab-b");

    useExecutionStore.getState().endRun(undefined, "conv-a");

    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("done");
    expect(badgeFor("tab-a", "completed")).toBe("ready");
  });

  it("a failed settle lands as failed on the owning tab — never working, never ready", () => {
    const s = useExecutionStore.getState();
    s.setPhase("editing", "tab-a");
    s.setActiveTaskId("tab-b");

    useExecutionStore.getState().endRun("failed", "conv-a");

    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("failed");
    expect(badgeFor("tab-a", "failed")).toBe("idle");
  });

  it("cancellation settles as cancelled on the owning tab — never in progress, never complete or failed", () => {
    const s = useExecutionStore.getState();
    s.setPhase("editing", "tab-a");
    s.setActiveTaskId("tab-b");

    useExecutionStore.getState().endRun("cancelled", "conv-a");

    const phase = useExecutionStore.getState().phaseForTask("tab-a");
    expect(phase).toBe("cancelled");
    // The action-run projection has no "cancelled" display state —
    // a cancelled run projects as "stopped".
    const badge = badgeFor("tab-a", "stopped");
    expect(badge).toBe("idle");
    expect(badge).not.toBe("working");
    expect(badge).not.toBe("ready");
  });

  it("a rejected resumed run settles its owning tab as cancelled (the store's rejection phase)", () => {
    const s = useExecutionStore.getState();
    s.setPhase("awaiting_approval", "tab-a");
    s.setActiveTaskId("tab-b");

    useExecutionStore.getState().settleResumedRun("rejected", "conv-a");

    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("cancelled");
    expect(badgeFor("tab-a", "stopped")).toBe("idle");
  });

  it("callers that pass no conversation keep the legacy active-tab behavior", () => {
    const s = useExecutionStore.getState();
    s.setActiveTaskId("tab-b");
    s.setPhase("editing", "tab-b");

    useExecutionStore.getState().endRun("cancelled");

    expect(useExecutionStore.getState().phaseForTask("tab-b")).toBe("cancelled");
    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("idle");
  });
});
