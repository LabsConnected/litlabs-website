// @vitest-environment node
/**
 * P0 approval/resume billing regression suite.
 * Verifies: approved resume reserves+settles, rejection never reserves,
 * insufficient balance fails closed, failed/interrupted resume releases,
 * nested pause releases, settle failure stays unbilled-but-recorded,
 * and exactly-once settlement per resume.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const reserveCreditsMock = vi.fn();
const settleRunMock = vi.fn();

vi.mock("@/lib/agent-billing", () => ({
  reserveCredits: (...a: unknown[]) => reserveCreditsMock(...a),
  settleRun: (...a: unknown[]) => settleRunMock(...a),
  estimateCredits: () => 5,
  computeResumeQuoteBits: () => 5,
  resumeQuoteDisclosure: () => "quote disclosure",
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  getPausedRun: vi.fn(),
  resolvePausedRun: vi.fn(),
  markRunProcessing: vi.fn(),
  verifyRunClaim: vi.fn(() => Promise.resolve(true)),
  releaseRunClaim: vi.fn(() => Promise.resolve(true)),
  updatePausedRunActionRun: vi.fn(() => Promise.resolve(true)),
  getRunOutcomeForPausedRun: vi.fn(),
  createPausedRun: vi.fn(() => Promise.resolve({ id: "nested-1" })),
  renewRunLease: vi.fn(() => Promise.resolve(true)),
  RUN_HEARTBEAT_MS: 30_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      listFiles: vi.fn(async () => ({ entries: [{ name: "index.html", type: "file" }] })),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
    }),
  ),
}));
vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  resumeAgentLoopV2: vi.fn(),
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit"].includes(id),
}));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/lib/missions/mission-repository", () => ({ getCheckpoint: vi.fn() }));
vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(() => Promise.resolve(true)),
}));
vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));
vi.mock("@/lib/studio/task-service", () => ({
  attachActionRunToConversationTask: vi.fn(() => Promise.resolve()),
  settleConversationTask: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
}));

import { auth } from "@/lib/auth";
const { POST } = await import(
  "../../src/app/api/studio/conversations/[conversationId]/approvals/[pausedRunId]/route"
);
import {
  getPausedRun, resolvePausedRun, markRunProcessing, getRunOutcomeForPausedRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getActionRun } from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";

const CONV = "conv-1", PAUSED = "paused-1";
const params = { params: Promise.resolve({ conversationId: CONV, pausedRunId: PAUSED }) };
const req = (d: string) => new NextRequest(
  `http://localhost/api/studio/conversations/${CONV}/approvals/${PAUSED}`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: d }) },
);
const pendingRun = {
  id: PAUSED, userId: "user_123", conversationId: CONV, projectId: "proj-1",
  workspaceId: "ws-1", toolId: "files.write", toolCallId: "tc-1",
  inputs: {}, reason: "r", pausedMessages: [{ role: "user", content: "build me a site" }],
  executionMode: "act", systemPrompt: "s", checkpointId: null,
  actionRunId: "run-parent-1", status: "pending",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

const settleCalls = () => settleRunMock.mock.calls.map((c) => c[1].status);

describe("approval/resume billing lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as never);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun as never);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as never);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as never);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-1" } as never);
    vi.mocked(markRunProcessing).mockResolvedValue(true as never);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue({ id: "m1", role: "assistant", status: "awaiting_approval" } as never);
    vi.mocked(getRunOutcomeForPausedRun).mockResolvedValue({ runStatus: null } as never);
    reserveCreditsMock.mockResolvedValue({ ok: true, runId: "run-resume-1", reservationId: "res-resume-1", reservedCredits: 5 });
    settleRunMock.mockResolvedValue({ ok: true, creditsCharged: 5, creditsRefunded: 0 });
  });

  it("approved resume reserves then settles exactly once on completion", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done", stepsUsed: 2,
      toolCalls: [{ toolId: "files.write", success: true, mutating: true }],
      cancelled: false, pendingApproval: undefined,
    } as never);
    const res = await POST(req("approved"), params);
    expect(res.status).toBe(202);
    expect(reserveCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: expect.stringContaining(`resume:${PAUSED}`) }),
      5, // exactly the disclosed quote (computeResumeQuoteBits)
    );
    await vi.waitFor(() => expect(settleCalls()).toEqual(["completed"]));
  });

  it("rejected approval never reserves or settles", async () => {
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "rejected" } as never);
    const res = await POST(req("rejected"), params);
    expect(res.status).toBe(200);
    expect(reserveCreditsMock).not.toHaveBeenCalled();
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });

  it("duplicate/expired approval is fenced before billing (409 on non-pending)", async () => {
    vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, status: "expired" } as never);
    const res = await POST(req("approved"), params);
    expect(res.status).toBe(409);
    expect(reserveCreditsMock).not.toHaveBeenCalled();
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });

  it("insufficient balance fails closed — no resume, failed status", async () => {
    reserveCreditsMock.mockResolvedValue({ ok: false, runId: null, reservationId: null, status: 402, error: "Insufficient LiTTBits balance", reservedCredits: 0 });
    const res = await POST(req("approved"), params);
    expect(res.status).toBe(402);
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(settleRunMock).not.toHaveBeenCalled();
  });

  it("resume billing RPC failure → 503, no execution", async () => {
    reserveCreditsMock.mockResolvedValue({ ok: false, runId: null, reservationId: null, status: 503, error: "Credit reservation failed", reservedCredits: 0 });
    const res = await POST(req("approved"), params);
    expect(res.status).toBe(503);
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
  });

  it("failed resume releases the reservation (settle failed)", async () => {
    vi.mocked(resumeAgentLoopV2).mockRejectedValue(new Error("boom"));
    await POST(req("approved"), params);
    await vi.waitFor(() => expect(settleCalls()).toEqual(["failed"]));
  });

  it("nested re-pause releases this attempt's reservation (cancelled → release)", async () => {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "", stepsUsed: 1, toolCalls: [], cancelled: false,
      pendingApproval: { toolId: "files.write", toolCallId: "tc-2", inputs: {}, reason: "r", pausedMessages: [] },
    } as never);
    await POST(req("approved"), params);
    await vi.waitFor(() => expect(settleCalls()).toEqual(["cancelled"]));
  });

  it("settle transport failure does not fabricate a charge", async () => {
    settleRunMock.mockResolvedValue({ ok: false, creditsCharged: 0, billingState: "reconciliation_pending" });
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done", stepsUsed: 1,
      toolCalls: [{ toolId: "files.write", success: true, mutating: true }],
      cancelled: false, pendingApproval: undefined,
    } as never);
    await POST(req("approved"), params);
    await vi.waitFor(() => expect(settleCalls().length).toBe(1));
    // settle attempted exactly once; result ok:false — no fake charge.
  });

  it("competing approvals: exactly one claims the run — loser gets 409, one reserve, one settle", async () => {
    // A compare-and-swap double of the paused-run store, replacing the
    // always-succeed claim mocks for this test. Both racing requests
    // read the run while it is still pending (the first two getPausedRun
    // calls return the pre-commit snapshot — the actual race window),
    // but resolvePausedRun commits exactly once and markRunProcessing
    // claims exactly once, which are the two fences the route relies
    // on. If the route ever let both requests through, this test would
    // see two reserves and two settles and fail.
    const store = {
      record: { ...pendingRun },
      claimed: false,
      entryReads: 0,
    };
    vi.mocked(getPausedRun).mockImplementation(async () => {
      store.entryReads += 1;
      if (store.entryReads <= 2) return { ...pendingRun } as never;
      return { ...store.record } as never;
    });
    vi.mocked(resolvePausedRun).mockImplementation(async () => {
      if (store.record.status !== "pending") return null as never;
      store.record = { ...store.record, status: "approved" };
      return { ...store.record } as never;
    });
    vi.mocked(markRunProcessing).mockImplementation(async () => {
      if (store.claimed) return false as never;
      store.claimed = true;
      return true as never;
    });
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done", stepsUsed: 1,
      toolCalls: [{ toolId: "files.write", success: true, mutating: true }],
      cancelled: false, pendingApproval: undefined,
    } as never);

    const [r1, r2] = await Promise.all([POST(req("approved"), params), POST(req("approved"), params)]);

    // One approval committed (202); the competitor was fenced at
    // resolvePausedRun and told the truth (409) before any billing.
    expect([r1.status, r2.status].sort()).toEqual([202, 409]);
    // Exactly one execution was launched, reserved once, settled once.
    expect(vi.mocked(resumeAgentLoopV2).mock.calls).toHaveLength(1);
    expect(reserveCreditsMock).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(settleCalls()).toEqual(["completed"]));
    expect(settleRunMock).toHaveBeenCalledTimes(1);
  });

  it("claim-loser: approval that loses the markRunProcessing claim gets a truthful 202 processing — no resume, no reserve, no settle", async () => {
    // Fence 2 (markRunProcessing) in isolation — the branch the B2
    // race test never reaches, because its loser is fenced earlier at
    // resolvePausedRun. Here the request PASSES resolution (fence 1
    // commits its approval) but the atomic processing claim reports
    // the run already claimed — the model for a second/retried
    // approval racing a winner whose execution is already in flight.
    // The route must answer with the truthful 202 "processing" status
    // and launch NOTHING: no resume, no reservation, no settlement.
    let reads = 0;
    vi.mocked(getPausedRun).mockImplementation(async () => {
      reads += 1;
      // Entry read: the run is still pending, so this request proceeds
      // through resolution. Post-claim re-read: the store now shows
      // the winner's run already processing.
      if (reads === 1) return { ...pendingRun } as never;
      return { ...pendingRun, status: "approved", runStatus: "processing" } as never;
    });
    // The claim is lost: another executor already owns this run.
    vi.mocked(markRunProcessing).mockResolvedValue(false as never);

    const res = await POST(req("approved"), params);

    // The request really did pass resolution and reach the claim fence
    // (otherwise the assertions below would be vacuous).
    expect(vi.mocked(resolvePausedRun)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(markRunProcessing)).toHaveBeenCalledTimes(1);
    // Truthful 202: the approval stands and the run is processing —
    // not an error, and not a second acceptance into execution.
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({
      resolved: true,
      decision: "approved",
      status: "processing",
      runStatus: "processing",
      pausedRunId: PAUSED,
    });
    // No duplicate execution of any kind from the losing request.
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCreditsMock).not.toHaveBeenCalled();
    expect(settleRunMock).not.toHaveBeenCalled();
    // And nothing deferred fires later either.
    await new Promise((r) => setTimeout(r, 10));
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCreditsMock).not.toHaveBeenCalled();
    expect(settleRunMock).not.toHaveBeenCalled();
  });
});
