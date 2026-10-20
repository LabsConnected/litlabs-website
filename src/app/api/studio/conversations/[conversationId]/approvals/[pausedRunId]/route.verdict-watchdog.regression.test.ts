// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression test — settle-time verdict on the stall-watchdog settle
 * (Repair R3, Diagnosis E4-R4).
 *
 * The D1 watchdog settles a wedged resume FAILED from the heartbeat —
 * a settle that by construction never reached the loop's finalize tail,
 * so no verdict was ever computed for it. The run's record went terminal
 * with nothing about the workspace, even though the run held the
 * original pre-mutation checkpoint and approved writes may have landed
 * before the wedge. The watchdog must compute the verdict at settle
 * time from the threaded checkpoint + transport and record it (or
 * "unknown" when comparison is impossible) — never silence.
 *
 * Harness mirrors route.resume-stall-watchdog.regression.test.ts (fake
 * timers, never-settling loop), with a manifest checkpoint threaded.
 */

// ── Mocks ──

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
  RUN_STALL_MS: 12 * 60 * 1000,
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
import {
  encodeManifestCheckpointDescription,
  sha256Hex,
} from "@/lib/missions/workspace-manifest";

// ── Helpers ──

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";
const ORIGINAL_CHECKPOINT_ID = "chk-orig";
const STALL_MS = 12 * 60 * 1000;

const OLD_HTML = "<html><body>Welcome to LiTT</body></html>";
const CSS = "body { color: #333; }";
const BASELINE_MANIFEST = {
  "index.html": sha256Hex(OLD_HTML),
  "styles.css": sha256Hex(CSS),
};

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${PAUSED_ID}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    },
  );
}

const routeParams = { params: Promise.resolve({ conversationId: CONV_ID, pausedRunId: PAUSED_ID }) };

function settleCall(status: string) {
  const mocked = vi.mocked(transitionActionRunEventActivity);
  const idx = mocked.mock.calls.findIndex(
    (c) => (c[0] as { status?: string }).status === status,
  );
  return idx < 0 ? null : (mocked.mock.calls[idx][0] as Record<string, any>);
}

const pendingRun = {
  id: PAUSED_ID,
  userId: "user_123",
  conversationId: CONV_ID,
  projectId: "proj-123",
  workspaceId: "ws-123",
  toolId: "files.write",
  toolCallId: "tc-1",
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
};

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write files.",
  status: "awaiting_approval",
};

// ── Tests ──

describe("POST /approvals/[pausedRunId] — watchdog settle carries a settle-time verdict (R3/E4-R4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getPausedRun).mockResolvedValue(pendingRun as any);
    vi.mocked(resolvePausedRun).mockResolvedValue({ ...pendingRun, status: "approved" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true);
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the stall-watchdog FAILED settle records the verdict against the threaded baseline", async () => {
    // The wedged executor: never settles (the D1 shape).
    vi.mocked(resumeAgentLoopV2).mockImplementation(() => new Promise(() => {}) as never);

    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(202);
    expect(resumeAgentLoopV2).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(STALL_MS + 120_000);

    const failed = settleCall("failed");
    expect(failed).not.toBeNull();
    expect(failed!.patch).toMatchObject({ failureCode: "EXECUTION_STALLED" });
    // The approved write landed before the wedge (index.html OLD → NEW
    // against the ORIGINAL baseline): the settled record must say so.
    // Before the fix the watchdog settle carried no result at all.
    expect(failed!.payload.result.workspaceChange).toMatchObject({
      status: "changed",
      files: ["index.html"],
    });
    // The verdict also lands on the Activity surface in the loop's own
    // persisted shape, so an interrupted run shows it like a completed one.
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
});
