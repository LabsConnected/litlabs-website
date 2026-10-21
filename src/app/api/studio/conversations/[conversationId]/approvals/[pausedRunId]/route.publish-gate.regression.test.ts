// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — the verified-revision publish gate (Repair R5-B),
 * route level, plus the resume-side false-completion guard (R5-C) and
 * the authorization pins around them (R5-A).
 *
 * The live defect (Harbor Coffee acceptance, 2026-10-20/21): build
 * verified, edit re-verified, then Publish failed with "The build did
 * not pass its quality checks; it is not complete." — the publish run's
 * own fresh quality session could never contain the earlier runs'
 * evidence, and no durable record bound a verdict to the workspace
 * revision it covered. Symmetrically, nothing stopped a publish of
 * content that had changed since verification.
 *
 * Scenarios:
 *   S1 publish with NO verified record → denied BEFORE execution:
 *      no resume, no billing reservation, settle failed
 *      PUBLISH_NOT_VERIFIED.
 *   S2 publish when the workspace CHANGED after verification → denied
 *      as stale, same no-execution / no-charge guarantees.
 *   S3 publish at exactly the verified revision → executes; the
 *      publish run's own not-ok session verdict does NOT fail it (the
 *      Defect-2 shape); the settle records publishGate.allowed and the
 *      conversation task settles verified.
 *   S4 a single run that built and paused at its own deploy gate keeps
 *      the in-run path (its own session carries the evidence).
 *   S5 an approved file edit whose resumed segment mutates nothing
 *      settles FAILED, never a completed edit (R5-C resume side).
 *   S6 an expired approval resolves nothing and executes nothing.
 *   S7 a workspace that changed since the approval was requested is
 *      refused before execution (scope binding).
 */

// ── Mocks (same harness family as route.verdict-persistence.regression.test.ts) ──

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/agent-billing", () => ({
  reserveCredits: vi.fn(() =>
    Promise.resolve({ ok: true, runId: "resume-run-1", reservedCredits: 12, reservationId: "resume-res-1" })),
  settleRun: vi.fn(() => Promise.resolve({ ok: true, creditsCharged: 0, creditsRefunded: 0 })),
  estimateCredits: vi.fn(() => 12),
  computeResumeQuoteBits: vi.fn(() => 12),
  resumeQuoteDisclosure: vi.fn(() => " Estimated resume cost: 12 LiTTBits (debited on success; failed work debits zero)."),
}));

vi.mock("@/lib/litt-intelligence/paused-run-store", () => ({
  getPausedRun: vi.fn(),
  resolvePausedRun: vi.fn(),
  markRunProcessing: vi.fn(),
  verifyRunClaim: vi.fn(() => Promise.resolve(true)),
  releaseRunClaim: vi.fn(() => Promise.resolve(true)),
  updatePausedRunActionRun: vi.fn(() => Promise.resolve(true)),
  getRunOutcomeForPausedRun: vi.fn(),
  createPausedRun: vi.fn(),
  renewRunLease: vi.fn(() => Promise.resolve(true)),
  RUN_HEARTBEAT_MS: 30_000,
  resetRunForRetry: vi.fn(() => Promise.resolve(false)),
}));

const CURRENT_FILES: Record<string, string> = {
  "index.html": "<html><body>Harbor Coffee — Grand Haven's Harbor Roast</body></html>",
  "styles.css": "body { color: #333; }",
};
const PRE_EDIT_FILES: Record<string, string> = {
  "index.html": "<html><body>Harbor Coffee</body></html>",
  "styles.css": "body { color: #333; }",
};
// The workspace AFTER a mid-segment change (S8–S11): same file set, the
// headline bytes differ, so the canonical revision differs.
const FLIPPED_FILES: Record<string, string> = {
  "index.html": "<html><body>Harbor Coffee — CHANGED MID-PUBLISH</body></html>",
  "styles.css": "body { color: #333; }",
};

/** Restore the shared transport map to the canonical CURRENT_FILES. */
function resetCurrentFiles() {
  for (const key of Object.keys(CURRENT_FILES)) delete CURRENT_FILES[key];
  Object.assign(CURRENT_FILES, {
    "index.html": "<html><body>Harbor Coffee — Grand Haven's Harbor Roast</body></html>",
    "styles.css": "body { color: #333; }",
  });
}

/** Mutate the shared transport map to FLIPPED_FILES (mid-segment move). */
function flipCurrentFiles() {
  CURRENT_FILES["index.html"] = FLIPPED_FILES["index.html"];
}

vi.mock("@/lib/litt-intelligence/workspace-transport", () => ({
  createWorkspaceTransport: vi.fn(() =>
    Promise.resolve({
      workspaceId: "ws-123",
      listFiles: vi.fn(async (path: string) => {
        if (path !== "." && path !== "") throw new Error(`unexpected listFiles path ${path}`);
        return {
          entries: Object.keys(CURRENT_FILES).map((name) => ({ name, type: "file" })),
        };
      }),
      readFile: vi.fn(async (path: string) => {
        const content = CURRENT_FILES[path];
        if (content === undefined) throw new Error(`readFile: no such file ${path}`);
        return { content, size: content.length };
      }),
      gitStatus: vi.fn(async () => {
        throw new Error("HOST_EXECUTION_DISABLED in test transport");
      }),
      startPreview: vi.fn(async () => ({ status: "ready" })),
      getPreviewStatus: vi.fn(async () => ({ status: "ready" })),
    }),
  ),
}));

vi.mock("@/lib/litt-intelligence/agent-loop-v2", () => ({
  resumeAgentLoopV2: vi.fn(),
  isFileWritingTool: (id: string) => ["files.write", "apply_patch", "edit", "code.writeFile", "code.refactor", "files.patch"].includes(id),
}));

vi.mock("@/lib/litt-intelligence/launch-flow", () => ({
  ensureProjectPreviewReady: vi.fn(async () => ({ ok: true, files: ["index.html"] })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  getCheckpoint: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getAwaitingApprovalAssistantMessage: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/lib/studio/logger", () => ({
  studioLog: vi.fn(),
}));
vi.mock("@/lib/studio/task-service", () => ({
  attachActionRunToConversationTask: vi.fn(() => Promise.resolve()),
  settleConversationTask: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/action-runtime", () => ({
  getActionRun: vi.fn(),
  createActionRun: vi.fn(() => Promise.resolve({ id: "run-retry-1" })),
  appendActionEvent: vi.fn(() => Promise.resolve({})),
  recordActionEventActivity: vi.fn(() => Promise.resolve({})),
  transitionActionRun: vi.fn(() => Promise.resolve({})),
  transitionActionRunEventActivity: vi.fn(() => Promise.resolve({})),
  listActionRuns: vi.fn(() => Promise.resolve([])),
  listActionEvents: vi.fn(() => Promise.resolve([])),
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import {
  getActionRun,
  listActionEvents,
  listActionRuns,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";
import { settleConversationTask } from "@/lib/studio/task-service";
import { reserveCredits } from "@/lib/agent-billing";
import { getActiveExecution } from "@/lib/studio/execution-registry";
import { computeWorkspaceRevision } from "@/lib/litt-intelligence/workspace-change-producer";

// ── Helpers ──

const CONV_ID = "conv-123";

function makeRequest(pausedRunId: string, decision: "approved" | "rejected"): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${pausedRunId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    },
  );
}

function paramsFor(pausedRunId: string) {
  return { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId }) };
}

function settleCallAfter(status: string, afterIndex: number) {
  const mocked = vi.mocked(transitionActionRunEventActivity);
  const idx = mocked.mock.calls.findIndex(
    (c, i) => i >= afterIndex && (c[0] as { status?: string }).status === status,
  );
  return idx < 0 ? null : (mocked.mock.calls[idx][0] as Record<string, any>);
}

/** File-services probe over an in-memory file map. */
function fileProbe(files: Record<string, string>) {
  return {
    gitStatus: async () => {
      throw new Error("no git in probe");
    },
    listFiles: async (path: string) => {
      if (path !== "." && path !== "") throw new Error(`unexpected listFiles path ${path}`);
      return { entries: Object.keys(files).map((name) => ({ name, type: "file" as const })) };
    },
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`readFile: no such file ${path}`);
      return { content, size: content.length };
    },
  };
}

function gateRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "project.deploy",
    toolCallId: `tc-${id}`,
    inputs: {},
    reason: "Deploy requires approval",
    pausedMessages: [{ role: "user", content: "publish it" }],
    executionMode: "act",
    systemPrompt: "system",
    checkpointId: null,
    actionRunId: "run-parent-1",
    status: "pending",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    resolvedAt: null,
    runStatus: null,
    runResult: null,
    runError: null,
    runStartedAt: null,
    runCompletedAt: null,
    qualityLoopState: undefined,
    ...overrides,
  };
}

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to deploy.",
  status: "awaiting_approval",
};

function stageGate(record: ReturnType<typeof gateRecord>, resolvedStatus = "approved") {
  vi.mocked(getPausedRun).mockResolvedValue(record as any);
  vi.mocked(resolvePausedRun).mockResolvedValue({ ...record, status: resolvedStatus } as any);
}

/** Stage a prior settled run as the project's canonical run list. */
function stagePriorRun(opts: { verdictOk: boolean; verifiedRevision: string | null }) {
  vi.mocked(listActionRuns).mockResolvedValue([
    { id: "run-build-1", status: "completed" },
  ] as any);
  vi.mocked(listActionEvents).mockResolvedValue([
    {
      type: "run.completed",
      payload: {
        result: {
          qualityLoop: { verdict: { ok: opts.verdictOk } },
          ...(opts.verifiedRevision ? { verifiedRevision: opts.verifiedRevision } : {}),
        },
      },
    },
  ] as any);
}

/** A loop double that performs the deploy and completes the segment. */
function scriptDeployingLoop(currentRevision: string) {
  vi.mocked(resumeAgentLoopV2).mockResolvedValue({
    finalText: "Published.",
    stepsUsed: 2,
    toolCalls: [
      { toolId: "project.deploy", success: true, summary: "deployed", mutating: true },
    ],
    cancelled: false,
    // The Defect-2 shape: the publish run's OWN quality session cannot
    // be ok (it holds no build/test evidence) — verdict not ok.
    qualityLoop: {
      verdict: { ok: false, gates: [], summary: "missing build evidence" },
      stages: {},
      designPasses: [],
    },
    qualityLoopState: undefined,
    workspaceRevision: currentRevision,
  } as any);
}

async function approveAndSettle(id: string, settleStatus: string) {
  const settleCountBefore = vi.mocked(transitionActionRunEventActivity).mock.calls.length;
  const res = await POST(makeRequest(id, "approved"), paramsFor(id));
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(settleCallAfter(settleStatus, settleCountBefore)).not.toBeNull());
  await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());
  return settleCallAfter(settleStatus, settleCountBefore)!;
}

describe("POST /approvals/[pausedRunId] — verified-revision publish gate (R5-B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true as any);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    vi.mocked(listActionRuns).mockResolvedValue([] as any);
    vi.mocked(listActionEvents).mockResolvedValue([] as any);
  });

  it("S1: publish with NO verified record is denied before execution — no resume, no charge", async () => {
    stageGate(gateRecord("paused-1"));
    // A prior run exists but its verification FAILED — proves nothing.
    stagePriorRun({ verdictOk: false, verifiedRevision: null });

    const res = await POST(makeRequest("paused-1", "approved"), paramsFor("paused-1"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; denial?: string };
    expect(body.code).toBe("PUBLISH_NOT_VERIFIED");
    expect(body.denial).toBe("no_verified_revision");

    // No deployment was attempted and no reservation was taken.
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();

    const settle = settleCallAfter("failed", 0);
    expect(settle).not.toBeNull();
    expect(settle!.patch.failureCode).toBe("PUBLISH_NOT_VERIFIED");
    expect(settle!.payload.result.publishGate).toMatchObject({
      allowed: false,
      code: "no_verified_revision",
    });
  });

  it("S2: publish after an UNREVERIFIED edit is denied as stale — no resume, no charge", async () => {
    stageGate(gateRecord("paused-1"));
    // The record covers the PRE-EDIT content; the workspace now serves
    // the edited content. The edit was never re-verified.
    const staleRevision = await computeWorkspaceRevision(fileProbe(PRE_EDIT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: staleRevision });

    const res = await POST(makeRequest("paused-1", "approved"), paramsFor("paused-1"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; denial?: string };
    expect(body.code).toBe("PUBLISH_NOT_VERIFIED");
    expect(body.denial).toBe("stale_revision");
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();

    const settle = settleCallAfter("failed", 0);
    expect(settle!.payload.result.publishGate).toMatchObject({
      allowed: false,
      code: "stale_revision",
      verifiedRevision: staleRevision,
    });
    expect(settle!.payload.result.publishGate.currentRevision).toMatch(/^manifest:/);
    expect(settle!.payload.result.publishGate.currentRevision).not.toBe(staleRevision);
  });

  it("S3: publish at exactly the verified revision executes and settles verified — the publish run's own not-ok session does not fail it", async () => {
    stageGate(gateRecord("paused-1"));
    const currentRevision = await computeWorkspaceRevision(fileProbe(CURRENT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: currentRevision });
    scriptDeployingLoop(currentRevision!);

    const settle = await approveAndSettle("paused-1", "completed");

    expect(resumeAgentLoopV2).toHaveBeenCalled();
    expect(reserveCredits).toHaveBeenCalled();
    expect(settle.eventType).toBe("run.completed");
    // Pre-fix this settle was FAILED with "The build did not pass its
    // quality checks; it is not complete." (the live Defect-2 message).
    expect(settle.patch.failureCode ?? null).toBeNull();
    expect(settle.payload.result.publishGate).toMatchObject({
      allowed: true,
      code: "verified_revision",
      verifiedRevision: currentRevision,
      verifiedByRunId: "run-build-1",
    });
    // The conversation task settles VERIFIED via the gate audit.
    expect(settleConversationTask).toHaveBeenCalledWith(
      "user_123",
      CONV_ID,
      "completed",
      true,
      "run-parent-1",
    );
  });

  it("S4: a run that built and paused at its OWN deploy gate keeps the in-run path", async () => {
    stageGate(
      gateRecord("paused-1", {
        // The paused run's own session carries its build evidence.
        qualityLoopState: { mutationSeen: true, state: { stages: {} } },
      }),
    );
    // No prior record at all — the in-run path must not need one.
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Built and published.",
      stepsUsed: 6,
      toolCalls: [
        { toolId: "project.deploy", success: true, summary: "deployed", mutating: true },
      ],
      cancelled: false,
      qualityLoop: {
        verdict: { ok: true, gates: [], summary: "ok" },
        stages: {},
        designPasses: [],
      },
      qualityLoopState: undefined,
      workspaceRevision: "manifest:whatever-the-build-left",
    } as any);

    const settle = await approveAndSettle("paused-1", "completed");

    expect(settle.eventType).toBe("run.completed");
    expect(settle.payload.result.publishGate).toMatchObject({
      allowed: true,
      code: "in_run_verification",
    });
    // The ok verdict binds the revision the build left behind.
    expect(settle.payload.result.verifiedRevision).toBe("manifest:whatever-the-build-left");
  });

  it("S5: an approved edit whose resumed segment mutates nothing settles FAILED, not completed (R5-C)", async () => {
    stageGate(gateRecord("paused-1", { toolId: "files.write" }));
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done — the headline has been updated!",
      stepsUsed: 2,
      // The agent talked; it never executed a mutation.
      toolCalls: [],
      cancelled: false,
    } as any);

    const settle = await approveAndSettle("paused-1", "failed");

    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("did not change any files");
  });

  it("S6: an expired approval resolves nothing, executes nothing, charges nothing", async () => {
    vi.mocked(getPausedRun).mockResolvedValue(gateRecord("paused-1") as any);
    vi.mocked(resolvePausedRun).mockResolvedValue(null as any);

    const res = await POST(makeRequest("paused-1", "approved"), paramsFor("paused-1"));
    expect(res.status).toBe(409);
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  it("S7: a workspace that changed since approval is refused before execution", async () => {
    stageGate(gateRecord("paused-1"));
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-OTHER" } as any);

    const res = await POST(makeRequest("paused-1", "approved"), paramsFor("paused-1"));
    expect(res.status).toBe(409);
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
    const settle = settleCallAfter("failed", 0);
    expect(settle!.patch.failureCode).toBe("WORKSPACE_CHANGED");
  });

  // ── Settle-time revalidation (verification pass, gap G1) ──
  // The gate compares the workspace at approval time; the deploy then
  // executes inside the resumed segment. These scenarios move the
  // workspace BETWEEN the gate read and the settle read (the loop mock
  // flips the shared file map before returning) and pin what the settle
  // may truthfully record.

  function scriptFlippingLoop(opts: {
    verdictOk: boolean | null;
    workspaceRevision: string;
  }) {
    vi.mocked(resumeAgentLoopV2).mockImplementation(async () => {
      flipCurrentFiles();
      return {
        finalText: "Published.",
        stepsUsed: 2,
        toolCalls: [
          { toolId: "project.deploy", success: true, summary: "deployed", mutating: true },
        ],
        cancelled: false,
        ...(opts.verdictOk === null
          ? {}
          : {
              qualityLoop: {
                verdict: { ok: opts.verdictOk, gates: [], summary: "segment session" },
                stages: {},
                designPasses: [],
              },
            }),
        qualityLoopState: undefined,
        workspaceRevision: opts.workspaceRevision,
      } as any;
    });
  }

  it("S8: workspace moves mid-segment and the segment verdict is not ok — settle FAILS as stale", async () => {
    resetCurrentFiles();
    stageGate(gateRecord("paused-1"));
    const gateRevision = await computeWorkspaceRevision(fileProbe(CURRENT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: gateRevision });
    scriptFlippingLoop({ verdictOk: false, workspaceRevision: gateRevision! });

    const settle = await approveAndSettle("paused-1", "failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("changed while publishing");
    expect(settle.payload.result.publishGate).toMatchObject({
      allowed: false,
      code: "stale_revision",
      verifiedRevision: gateRevision,
    });
    expect(settle.payload.result.publishGate.currentRevision).not.toBe(gateRevision);
  });

  it("S9: workspace moves mid-segment — an ok segment verdict does NOT rescue the settle when its own revision is the stale one", async () => {
    resetCurrentFiles();
    stageGate(gateRecord("paused-1"));
    const gateRevision = await computeWorkspaceRevision(fileProbe(CURRENT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: gateRevision });
    // The segment's finalize computed the GATE revision and its verdict
    // is ok — but the workspace at settle is a different revision, so
    // what shipped is not proven to be the verified content.
    scriptFlippingLoop({ verdictOk: true, workspaceRevision: gateRevision! });

    const settle = await approveAndSettle("paused-1", "failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("changed while publishing");
    expect(settle.payload.result.publishGate).toMatchObject({
      allowed: false,
      verifiedRevision: gateRevision,
    });
    expect(settle.payload.result.publishGate.currentRevision).not.toBe(gateRevision);
  });

  it("S10: the segment self-verifies the CURRENT content — its own ok verdict covers the revision the workspace is at settle", async () => {
    resetCurrentFiles();
    stageGate(gateRecord("paused-1"));
    const gateRevision = await computeWorkspaceRevision(fileProbe(CURRENT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: gateRevision });
    const flippedRevision = await computeWorkspaceRevision(fileProbe(FLIPPED_FILES) as any);
    // The segment's finalize ran AFTER the move: its ok verdict covers
    // the flipped revision, which is still the workspace at settle.
    scriptFlippingLoop({ verdictOk: true, workspaceRevision: flippedRevision! });

    const settle = await approveAndSettle("paused-1", "completed");
    expect(settle.eventType).toBe("run.completed");
    expect(settle.payload.result.publishGate).toMatchObject({
      allowed: true,
      code: "in_run_verification",
      verifiedRevision: flippedRevision,
      currentRevision: flippedRevision,
    });
  });

  it("S11: workspace moves mid-segment and the segment produced NO quality verdict — the stale audit still fails the settle", async () => {
    resetCurrentFiles();
    stageGate(gateRecord("paused-1"));
    const gateRevision = await computeWorkspaceRevision(fileProbe(CURRENT_FILES) as any);
    stagePriorRun({ verdictOk: true, verifiedRevision: gateRevision });
    scriptFlippingLoop({ verdictOk: null, workspaceRevision: gateRevision! });

    const settle = await approveAndSettle("paused-1", "failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("changed while publishing");
    expect(settle.payload.result.publishGate).toMatchObject({ allowed: false });
  });

  it("S12: a deploy.production gate (not only project.deploy) is held to the verified-revision gate", async () => {
    resetCurrentFiles();
    stageGate(gateRecord("paused-1", { toolId: "deploy.production" }));
    // No prior run at all (beforeEach stages an empty run list).

    const res = await POST(makeRequest("paused-1", "approved"), paramsFor("paused-1"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; denial?: string };
    expect(body.code).toBe("PUBLISH_NOT_VERIFIED");
    expect(body.denial).toBe("no_verified_revision");
    expect(resumeAgentLoopV2).not.toHaveBeenCalled();
    expect(reserveCredits).not.toHaveBeenCalled();
  });

  // ── Approved-edit landing proof (verification pass, gap R5-C) ──
  // The resume guard must prove the APPROVED edit landed — the approved
  // tool itself succeeded AND the workspace verdict shows the approved
  // target changed — not merely that some mutation happened somewhere
  // in the segment.

  function stageEditLoop(result: Record<string, unknown>) {
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "Done — the headline has been updated!",
      stepsUsed: 2,
      cancelled: false,
      ...result,
    } as any);
  }

  it("S5b: the approved write SUCCEEDS but lands on the WRONG file — settle FAILED, not completed", async () => {
    stageGate(
      gateRecord("paused-1", {
        toolId: "files.write",
        inputs: { path: "index.html", content: "<html><body>edited headline</body></html>" },
      }),
    );
    stageEditLoop({
      toolCalls: [
        { toolId: "files.write", success: true, summary: "wrote styles.css", mutating: true },
      ],
      // The workspace DID change — but the approved target did not.
      workspaceChange: { status: "changed", files: ["styles.css"] },
    });

    const settle = await approveAndSettle("paused-1", "failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("did not change any files");
  });

  it("S5c: the approved write reports success but changes NOTHING (no-op) — settle FAILED, not completed", async () => {
    stageGate(
      gateRecord("paused-1", {
        toolId: "files.write",
        inputs: { path: "index.html", content: "<html><body>same as before</body></html>" },
      }),
    );
    stageEditLoop({
      toolCalls: [
        { toolId: "files.write", success: true, summary: "wrote index.html", mutating: true },
      ],
      // Identical content written back: the workspace verdict proves
      // no change landed.
      workspaceChange: { status: "unchanged", files: [] },
    });

    const settle = await approveAndSettle("paused-1", "failed");
    expect(settle.eventType).toBe("run.failed");
    expect(settle.patch.failureMessage).toContain("did not change any files");
  });

  it("S5d: the approved write lands on the approved target — settle COMPLETES (the realistic resume shape)", async () => {
    stageGate(
      gateRecord("paused-1", {
        toolId: "files.write",
        inputs: { path: "index.html", content: "<html><body>edited headline</body></html>" },
      }),
    );
    stageEditLoop({
      // The real resume loop always logs the approved call first.
      toolCalls: [
        { toolId: "files.write", success: true, summary: "wrote index.html", mutating: true },
      ],
      workspaceChange: { status: "changed", files: ["index.html"] },
    });

    const settle = await approveAndSettle("paused-1", "completed");
    expect(settle.eventType).toBe("run.completed");
  });
});
