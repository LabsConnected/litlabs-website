import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  foldCanonicalRunIntoExecutionStore,
  fetchCanonicalRunSnapshot,
  type CanonicalRunSnapshot,
} from "./reconcile-run";
import { useExecutionStore } from "../stores/useExecutionStore";

/**
 * Regression tests — mount-time reconciliation + stale-response
 * protection (Repair R4, Diagnosis E3-S3/S4/S5 + E1-F5; stale-poll
 * scenarios per Larry 2026-10-20 16:34 EDT).
 *
 * The defects:
 *  - On conversation load NOTHING folded the canonical action-run state
 *    into the execution store: the operator bar and mission panel read
 *    only the (empty after reload) in-memory store and claimed "Idle"
 *    while the server run was live, terminal, or waiting — and a gate
 *    whose message attachment missed loadMessages' narrow rehydration
 *    conditions stayed invisible and unactionable.
 *  - Convergence had no monotonicity: a stale/older polling or watcher
 *    response arriving AFTER a newer terminal state was applied could
 *    regress the store. The four scenarios below pin the guarantee for
 *    a run that has (a) CANCELLED, (b) COMPLETED, (c) been REJECTED at
 *    a gate, (d) RE-PAUSED at a nested gate: stale responses must not
 *    overwrite the newer state, and in (d) the new gate stays live.
 */

const CONV = "conv-1";

function snapshot(overrides: Partial<CanonicalRunSnapshot>): CanonicalRunSnapshot {
  return {
    runId: "run-1",
    runStatus: "working",
    displayState: "running",
    currentActivity: null,
    pendingApprovals: [],
    ...overrides,
  };
}

function mountGate(pausedRunId: string, opts?: { rehydrated?: boolean }) {
  useExecutionStore.getState().setPendingApproval({
    toolId: "files.write",
    reason: "Mutation requires approval in ACT mode",
    pausedRunId,
    conversationId: CONV,
    ...(opts?.rehydrated ? { rehydrated: true } : {}),
  });
}

beforeEach(() => {
  useExecutionStore.getState().reset();
});

describe("mount-time reconciliation fold (R4/E3-S5)", () => {
  it("(c1) rehydrates a live gate from the projection when the message attachment missed it (E1-F5)", () => {
    // loadMessages' narrow rehydration missed (no attachment on the last
    // assistant message) — the store holds nothing. The canonical
    // projection still lists the pending gate; the fold must mount it.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "waiting_for_user",
      displayState: "awaiting_approval",
      pendingApprovals: [{ id: "gate-2", toolId: "files.write", reason: "Mutation requires approval in ACT mode" }],
    }));

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("gate-2");
    expect(s.pendingApproval?.conversationId).toBe(CONV);
    expect(s.phase).toBe("awaiting_approval");
  });

  it("(c2) a terminal run clears a snapshot-derived gate residue and sets the phase truthfully", () => {
    // Reload state: the gate was rehydrated from an earlier snapshot,
    // then the run was cancelled elsewhere. A fresh load's fold sees the
    // terminal projection — the residue must clear, not announce
    // "Approval needed" over a finished run forever.
    mountGate("gate-1", { rehydrated: true });
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "cancelled",
      displayState: "stopped",
    }));

    const s = useExecutionStore.getState();
    expect(s.pendingApproval).toBeNull();
    expect(s.phase).toBe("cancelled");
    expect(s.isRunning).toBe(false);
  });

  it("(c5) an active server run folds into an idle store — the operator state is not 'Idle' over a live run", () => {
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({ displayState: "running" }));

    const s = useExecutionStore.getState();
    expect(s.isRunning).toBe(true);
    expect(s.phase).toBe("running");
  });

  it("(c4) never folds over a live local decision flow (submitting/executing owns the state)", () => {
    mountGate("gate-1");
    const exec = useExecutionStore.getState();
    exec.beginApprovalSubmit();
    exec.approvalAccepted();
    expect(useExecutionStore.getState().approvalPhase).toBe("executing");

    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "failed",
      displayState: "failed",
    }));

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("gate-1");
    expect(s.approvalPhase).toBe("executing");
    expect(s.phase).toBe("awaiting_approval");
  });

  it("fetchCanonicalRunSnapshot parses the action-run projection body", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        projection: {
          run: { id: "run-9", status: "waiting_for_user" },
          displayState: "awaiting_approval",
          currentActivity: "Approval required for files.write",
          pendingApprovals: [{ id: "gate-9", toolId: "files.write", reason: "Mutation requires approval" }],
        },
      }),
    })) as unknown as typeof fetch;

    const snap = await fetchCanonicalRunSnapshot(CONV, fetchImpl);
    expect(snap?.runId).toBe("run-9");
    expect(snap?.displayState).toBe("awaiting_approval");
    expect(snap?.pendingApprovals[0]?.id).toBe("gate-9");

    const nullFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ projection: null }),
    })) as unknown as typeof fetch;
    expect(await fetchCanonicalRunSnapshot(CONV, nullFetch)).toBeNull();
  });
});

describe("stale-response protection (Larry 2026-10-20 16:34 — four scenarios)", () => {
  it("(a) CANCELLED: stale responses after a cancelled outcome was applied do not regress the store", () => {
    // The watcher applied the cancelled outcome: gate cleared, phase
    // cancelled, gate id recorded as resolved.
    mountGate("gate-1");
    useExecutionStore.getState().resolveApproval("cancelled", { pausedRunId: "gate-1" });
    let s = useExecutionStore.getState();
    expect(s.phase).toBe("cancelled");
    expect(s.pendingApproval).toBeNull();

    // Stale #1: an older non-terminal projection (requested before the
    // settle, resolved after) claiming the run is live with a gate.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "waiting_for_user",
      displayState: "awaiting_approval",
      pendingApprovals: [{ id: "gate-2", toolId: "files.write", reason: "stale" }],
    }));
    // Stale #2: an older terminal projection for a different outcome.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "failed",
      displayState: "failed",
    }));
    // Stale #3: a late poll failure for the same gate.
    useExecutionStore.getState().failApproval("late failure", true, {
      decisionRecorded: true,
      pausedRunId: "gate-1",
    });

    s = useExecutionStore.getState();
    expect(s.phase).toBe("cancelled");
    expect(s.pendingApproval).toBeNull();
    expect(s.isRunning).toBe(false);
    expect(s.approvalPhase).toBe("idle");
    expect(s.approvalError).toBeNull();
  });

  it("(b) COMPLETED: stale responses after a completed outcome was applied do not regress the store", () => {
    mountGate("gate-1");
    useExecutionStore.getState().resolveApproval("approved", { pausedRunId: "gate-1" });
    const phaseAfter = useExecutionStore.getState().phase;

    // Stale #1: older "still running" projection.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({ displayState: "running" }));
    // Stale #2: older failed outcome for the same gate (the other poll
    // loop's folded view of the run).
    useExecutionStore.getState().failApproval("stale failure", true, {
      decisionRecorded: true,
      pausedRunId: "gate-1",
    });
    // Stale #3: older terminal-failed projection.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "failed",
      displayState: "failed",
    }));

    const s = useExecutionStore.getState();
    expect(s.phase).toBe(phaseAfter);
    expect(s.pendingApproval).toBeNull();
    expect(s.isRunning).toBe(false);
    expect(s.approvalError).toBeNull();
    expect(s.resolvedPausedRunIds).toContain("gate-1");
  });

  it("(c) REJECTED: a stale snapshot naming the decided gate must not resurrect it", () => {
    mountGate("gate-1");
    useExecutionStore.getState().resolveApproval("rejected", { pausedRunId: "gate-1" });
    expect(useExecutionStore.getState().pendingApproval).toBeNull();

    // Stale #1: an older projection snapshot (taken while the gate was
    // still pending) still lists gate-1 as awaiting approval. A decided
    // gate never re-arms — the store's resolved-id record is the guard.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "waiting_for_user",
      displayState: "awaiting_approval",
      pendingApprovals: [{ id: "gate-1", toolId: "files.write", reason: "stale" }],
    }));
    // Stale #2: an older "still running" projection.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({ displayState: "running" }));

    const s = useExecutionStore.getState();
    expect(s.pendingApproval).toBeNull();
    expect(s.isRunning).toBe(false);
    expect(s.resolvedPausedRunIds).toContain("gate-1");
  });

  it("(d) RE-PAUSED: stale gate-1 responses must not displace the live nested gate-2", () => {
    // Gate 1 approved; its segment re-paused — gate 2 is the live gate
    // (mounted locally by the handoff, not snapshot-derived).
    mountGate("gate-1");
    useExecutionStore.getState().resolveApproval("approved", { pausedRunId: "gate-1" });
    mountGate("gate-2");
    expect(useExecutionStore.getState().pendingApproval?.pausedRunId).toBe("gate-2");

    // Stale #1: gate 1's watcher settling late (its outcome is tagged
    // gate-1 — R1b matching drops it; a failure variant must also drop).
    useExecutionStore.getState().failApproval("gate-1 late failure", true, {
      decisionRecorded: true,
      pausedRunId: "gate-1",
    });
    // Stale #2: an older terminal projection (gate 1's attempt record,
    // fetched before the handoff landed).
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({
      runStatus: "completed",
      displayState: "completed",
    }));
    // Stale #3: an older non-terminal projection from before the handoff.
    foldCanonicalRunIntoExecutionStore(CONV, snapshot({ displayState: "running" }));

    const s = useExecutionStore.getState();
    expect(s.pendingApproval?.pausedRunId).toBe("gate-2");
    expect(s.phase).toBe("awaiting_approval");
    expect(s.approvalError).toBeNull();
  });
});
