import { beforeEach, describe, expect, it } from "vitest";
import {
  approvalForConversation,
  useExecutionStore,
  type PendingApproval,
} from "./useExecutionStore";

/**
 * ACC-06a item 4 — approvals are scoped to the project + conversation
 * that requested them.
 *
 * Acceptance Run 1 on 8cd7728c: an approval card belonging to the
 * bakery project briefly appeared inside a different project's
 * Studio session. The execution store holds ONE global
 * pendingApproval; every surface (chat card, operator bar, Live
 * activity, Jobs notice) rendered it unconditionally, and the
 * resolve handler deliberately posts to the gate's OWN conversation
 * — so the card was not just visible in the wrong project, it was
 * fully actionable there. The project-isolation reset that clears
 * the store runs in an effect, AFTER the new project's first paint,
 * which is why the card flashed.
 *
 * The fix is render/action scoping by the gate's binding:
 * approvalForConversation is the single derivation every surface
 * uses, synchronously during render — no effect timing involved.
 */
const gateA: PendingApproval = {
  toolId: "files.write",
  reason: "Write index.html",
  pausedRunId: "run-a",
  conversationId: "conv-a",
};

describe("approvalForConversation — the scope derivation (ACC-06a item 4)", () => {
  it("shows a gate in its own conversation", () => {
    expect(approvalForConversation(gateA, "conv-a")).toBe(gateA);
  });

  it("hides project A's gate in project B's conversation", () => {
    expect(approvalForConversation(gateA, "conv-b")).toBeNull();
  });

  it("hides a bound gate when no conversation is selected", () => {
    expect(approvalForConversation(gateA, null)).toBeNull();
    expect(approvalForConversation(gateA, undefined)).toBeNull();
  });

  it("keeps legacy unbound gates visible (pre-binding behavior)", () => {
    const unbound: PendingApproval = { toolId: "files.write", reason: "Mutation requires approval", pausedRunId: "run-x" };
    expect(approvalForConversation(unbound, "conv-b")).toBe(unbound);
  });

  it("passes through an empty gate", () => {
    expect(approvalForConversation(null, "conv-a")).toBeNull();
  });
});

describe("approval scoping across a reconnect (ACC-06a item 4)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("a gate from project A cannot render or be actioned in project B after reconnect — and survives for its own conversation", () => {
    const exec = useExecutionStore.getState();
    // Project A's run pauses at a gate.
    exec.setPendingApproval(gateA);
    // The client disconnects and reconnects while the user is
    // looking at project B. Rehydration for B's conversation is
    // blocked by the store's own guard (a gate is already mounted),
    // so the store still holds A's gate — scoping is what keeps it
    // out of B's session.
    const held = useExecutionStore.getState().pendingApproval;
    expect(held?.pausedRunId).toBe("run-a");
    expect(approvalForConversation(held, "conv-b")).toBeNull();
    // Returning to A's conversation, the same gate is actionable.
    expect(approvalForConversation(held, "conv-a")?.pausedRunId).toBe("run-a");
  });

  it("mirrors the gate's phase onto its OWNING worktab, not only the active one", () => {
    const exec = useExecutionStore.getState();
    exec.setTaskConversationIndex([
      { id: "tab-a", conversationId: "conv-a" },
      { id: "tab-b", conversationId: "conv-b" },
    ]);
    exec.setActiveTaskId("tab-b");
    exec.setPendingApproval(gateA);
    // The owning tab must show the gate (needs-approval badge
    // source) even though the gate was set while tab B was active.
    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("awaiting_approval");
  });
});
