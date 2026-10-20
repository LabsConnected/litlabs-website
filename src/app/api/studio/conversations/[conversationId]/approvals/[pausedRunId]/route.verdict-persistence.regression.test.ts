// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — verdict persistence on the settled run record
 * (Repair R3, Diagnosis E4-S5/S7 + R3/R4).
 *
 * The defect: `RunResult` had NO workspaceChange field, so a verdict the
 * resumed loop computed in its finalize tail was dropped at the route —
 * the settled record (the terminal action_event's payload.result, the
 * thing every poll/GET/watcher reads) carried no verdict at all. And
 * settles that never reached a finalize tail (rejection at a gate, an
 * executor that threw) recorded nothing about the workspace either, even
 * when the run's lineage had a checkpoint and real mutations behind it.
 *
 *   (a) a completing resume — the settled runResult carries the verdict
 *       the loop computed against the ORIGINAL baseline (R2 continuity:
 *       the loop double computes it with the real producer against the
 *       threaded existingCheckpoint).
 *   (b) a run REJECTED at a gate after an earlier segment mutated — the
 *       rejection settle computes the verdict at settle time from the
 *       stored checkpoint + transport and records it (changed here),
 *       plus the persisted workspace_change activity event the panel
 *       renders. Fails before: the settle carried no result at all.
 *   (c) an executor whose loop THREW — the exception settle computes the
 *       verdict at settle time instead of leaving the record silent.
 *   (d) the approval audit lines fire: decision_recorded, resume_started,
 *       run_settled on an approved completion; nested_gate_created on a
 *       re-pause. Fails before: none of these lines exist.
 */

// ── Mocks (same harness family as route.nested-gate-checkpoint.regression.test.ts) ──

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
  "index.html": "<html><body>Harbor Coffee — fresh roast</body></html>",
  "styles.css": "body { color: #333; }",
};

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
        throw new Error("HOST_EXECUTION_DISABLED: git must not be consulted for a manifest checkpoint");
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
  getCheckpoint: vi.fn(),
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
}));

import { auth } from "@/lib/auth";
import { POST } from "./route";
import {
  getPausedRun,
  resolvePausedRun,
  markRunProcessing,
  createPausedRun,
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import {
  getActionRun,
  appendActionEvent,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";
import { studioLog } from "@/lib/studio/logger";
import { getActiveExecution } from "@/lib/studio/execution-registry";
import { computeWorkspaceChange } from "@/lib/litt-intelligence/workspace-change-producer";
import {
  encodeManifestCheckpointDescription,
  sha256Hex,
} from "@/lib/missions/workspace-manifest";

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

const OLD_HTML = "<html><body>Welcome to LiTT</body></html>";
const CSS = "body { color: #333; }";

/** The ORIGINAL pre-build baseline (created before segment 1's first mutation). */
const BASELINE_MANIFEST = {
  "index.html": sha256Hex(OLD_HTML),
  "styles.css": sha256Hex(CSS),
};
const ORIGINAL_CHECKPOINT_ID = "chk-orig";

function gateRecord(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user_123",
    conversationId: CONV_ID,
    projectId: "proj-123",
    workspaceId: "ws-123",
    toolId: "files.write",
    toolCallId: `tc-${id}`,
    inputs: { path: "index.html" },
    reason: "Mutation requires approval in ACT mode",
    pausedMessages: [],
    executionMode: "act",
    systemPrompt: "system",
    checkpointId: ORIGINAL_CHECKPOINT_ID,
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
    ...overrides,
  };
}

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write files.",
  status: "awaiting_approval",
};

function stageGate(record: ReturnType<typeof gateRecord>, resolvedStatus: string) {
  vi.mocked(getPausedRun).mockResolvedValue(record as any);
  vi.mocked(resolvePausedRun).mockResolvedValue({ ...record, status: resolvedStatus } as any);
}

/** File-services probe over an in-memory file map (manifest comparison). */
function fileProbe(files: Record<string, string>) {
  return {
    gitStatus: vi.fn(async () => {
      throw new Error("HOST_EXECUTION_DISABLED: git must not be consulted for a manifest checkpoint");
    }),
    listFiles: async (path: string) => {
      if (path !== "." && path !== "") throw new Error(`unexpected listFiles path ${path}`);
      return { entries: Object.keys(files).map((name) => ({ name, type: "file" })) };
    },
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`readFile: no such file ${path}`);
      return { content, size: content.length };
    },
  };
}

/**
 * Faithful completing loop double: like the real loop's finalize tail, it
 * computes the workspace-change verdict with the REAL producer against
 * the checkpoint it was threaded (existingCheckpoint) and returns it on
 * the result as `workspaceChange`.
 */
function scriptCompletingLoop() {
  vi.mocked(resumeAgentLoopV2).mockImplementation(async (input: any) => {
    const change = await computeWorkspaceChange(
      fileProbe(CURRENT_FILES) as any,
      input.existingCheckpoint ?? null,
    );
    return {
      finalText: "done",
      stepsUsed: 5,
      toolCalls: [
        { toolId: "files.write", success: true, summary: "wrote index.html", mutating: true },
      ],
      cancelled: false,
      workspaceChange: change,
      checkpoint: input.existingCheckpoint
        ? {
            checkpointId: input.existingCheckpoint.checkpointId,
            label: input.existingCheckpoint.label,
            gitSha: input.existingCheckpoint.gitSha,
          }
        : undefined,
    } as any;
  });
}

/** POST one approval and wait for the detached executor to fully settle. */
async function approveAndSettle(id: string, settleStatus: string) {
  const settleCountBefore = vi.mocked(transitionActionRunEventActivity).mock.calls.length;
  const res = await POST(makeRequest(id, "approved"), paramsFor(id));
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(settleCallAfter(settleStatus, settleCountBefore)).not.toBeNull());
  await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());
  return settleCallAfter(settleStatus, settleCountBefore)!;
}

function loggedMessages(): string[] {
  return vi.mocked(studioLog).mock.calls.map((c) => String(c[0]));
}

// ── Tests ──

describe("POST /approvals/[pausedRunId] — verdict persistence on the settled record (R3/E4-S5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true as any);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    vi.mocked(getCheckpoint).mockImplementation(async (id: string) =>
      (id === ORIGINAL_CHECKPOINT_ID
        ? {
            id: ORIGINAL_CHECKPOINT_ID,
            projectId: "proj-123",
            userId: "user_123",
            gitSha: "",
            label: "pre-approval",
            description: encodeManifestCheckpointDescription(BASELINE_MANIFEST),
            missionRunId: null,
            createdAt: new Date().toISOString(),
          }
        : null) as any,
    );
    vi.mocked(createPausedRun).mockImplementation(async () => ({ id: "paused-2" }) as any);
  });

  it("(a) a completing resume settles with the loop's verdict against the ORIGINAL baseline on the runResult", async () => {
    scriptCompletingLoop();
    stageGate(gateRecord("paused-1"), "approved");

    const settle = await approveAndSettle("paused-1", "completed");

    expect(settle.eventType).toBe("run.completed");
    // The verdict the loop computed vs the ORIGINAL manifest baseline:
    // index.html changed in an earlier segment (OLD → Harbor Coffee),
    // styles.css untouched. Before the fix this field did not exist on
    // RunResult and the route never copied it — the record was silent.
    expect(settle.payload.result.workspaceChange).toMatchObject({
      status: "changed",
      files: ["index.html"],
    });
  });

  it("(b) a gate REJECTED after an earlier mutation settles with a settle-time verdict, not an absence", async () => {
    stageGate(
      gateRecord("paused-1", { hadInterveningMutation: true }),
      "rejected",
    );

    const res = await POST(makeRequest("paused-1", "rejected"), paramsFor("paused-1"));
    expect(res.status).toBe(200);

    const settle = settleCallAfter("cancelled", 0);
    expect(settle).not.toBeNull();
    expect(settle!.eventType).toBe("approval.rejected");
    // The settle computed the verdict from the stored checkpoint +
    // transport: segment 1's write (OLD → NEW index.html) is real, so
    // the record must say "changed" — before the fix the rejection
    // settle carried no result whatsoever.
    expect(settle!.payload.result.workspaceChange).toMatchObject({
      status: "changed",
      files: ["index.html"],
    });
    // …and the verdict is also on the Activity surface in the same shape
    // the loop's own persistence uses, so the panel shows it for an
    // interrupted run exactly as for a completed one.
    expect(appendActionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-parent-1",
        type: "agent.status",
        payload: expect.objectContaining({
          kind: "workspace_change",
          status: "changed",
          fileCount: 1,
        }),
      }),
    );
  });

  it("(c) an executor whose loop throws settles with a settle-time verdict on the failure record", async () => {
    vi.mocked(resumeAgentLoopV2).mockRejectedValue(new Error("provider exploded"));
    stageGate(gateRecord("paused-1"), "approved");

    const settle = await approveAndSettle("paused-1", "failed");

    expect(settle.eventType).toBe("run.failed");
    expect(settle.payload.result.workspaceChange).toMatchObject({
      status: "changed",
      files: ["index.html"],
    });
  });

  it("(d) the approval audit lines fire across an approved completion", async () => {
    scriptCompletingLoop();
    stageGate(gateRecord("paused-1"), "approved");

    await approveAndSettle("paused-1", "completed");

    const messages = loggedMessages();
    expect(messages).toContain("approval:decision_recorded");
    expect(messages).toContain("approval:resume_started");
    expect(messages).toContain("approval:run_settled");
    // The decision line names the decision and the gate — ids and
    // outcomes only, no inputs.
    const decision = vi.mocked(studioLog).mock.calls.find((c) => c[0] === "approval:decision_recorded");
    expect(decision?.[1]).toMatchObject({ pausedRunId: "paused-1", decision: "approved" });
    const settled = vi.mocked(studioLog).mock.calls.find((c) => c[0] === "approval:run_settled");
    expect(settled?.[1]).toMatchObject({ pausedRunId: "paused-1", status: "completed" });
  });

  it("(d2) a re-pause logs nested_gate_created for the new gate", async () => {
    vi.mocked(resumeAgentLoopV2).mockImplementation(async (input: any) => ({
      finalText: "I need approval for the next write too.",
      stepsUsed: 3,
      toolCalls: [],
      cancelled: false,
      checkpoint: input.existingCheckpoint
        ? {
            checkpointId: input.existingCheckpoint.checkpointId,
            label: input.existingCheckpoint.label,
            gitSha: input.existingCheckpoint.gitSha,
          }
        : undefined,
      pendingApproval: {
        toolId: "files.write",
        toolCallId: "tc-next",
        inputs: { path: "styles.css" },
        reason: "Mutation requires approval in ACT mode",
        pausedMessages: [{ role: "user", content: "x" }],
      },
    }) as any);
    stageGate(gateRecord("paused-1"), "approved");

    await approveAndSettle("paused-1", "waiting_for_user");

    const messages = loggedMessages();
    expect(messages).toContain("approval:nested_gate_created");
    const nested = vi.mocked(studioLog).mock.calls.find((c) => c[0] === "approval:nested_gate_created");
    expect(nested?.[1]).toMatchObject({ pausedRunId: "paused-2" });
  });
});
