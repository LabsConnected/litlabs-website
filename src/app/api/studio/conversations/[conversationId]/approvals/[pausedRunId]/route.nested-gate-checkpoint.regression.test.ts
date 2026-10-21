// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — checkpoint continuity across NESTED approval gates
 * (Repair R2, Diagnosis E4-S2).
 *
 * The defect: the FIRST pause persists the real pre-mutation checkpointId
 * (messages route), and the approvals route recovers it into
 * ResumeInput.existingCheckpoint on resume — but when the resumed run
 * pauses AGAIN, the nested gate was persisted with a hardcoded
 * `checkpointId: null`. Every resume from gate ≥2 therefore started with
 * NO baseline: the final segment's workspace-change verdict could only
 * answer "unknown" (or diff a fresh mid-build baseline), so a build with
 * two or more approvals could NEVER produce a truthful end-to-end verdict.
 *
 * These tests drive the ACTUAL approvals route (same mocked harness as
 * route.test.ts / route.cross-pause-manifest.regression.test.ts) through
 * a chain of gates, feeding each persisted record forward exactly as the
 * store would. The mocked loop is faithful to the real loop's contract:
 * its pause result carries the checkpoint it was threaded
 * (existingCheckpoint) — the identity the route must persist.
 *
 *   (a) gate 1 → gate 2: the nested record carries the ORIGINAL
 *       checkpointId (fails before: null).
 *   (b) gate 2 → gate 3: the chain is unlimited — the third gate's record
 *       still carries the ORIGINAL checkpointId (fails before: null).
 *   (c) gate 3 resume completes: the threaded existingCheckpoint is the
 *       original manifest baseline, and the finalize-tail seam
 *       (computeWorkspaceChange, the same call the loop tail makes)
 *       diffs against it — a file changed in segment 1 appears in the
 *       verdict (fails before: "unknown", no baseline survived).
 */

// ── Mocks (same harness as route.cross-pause-manifest.regression.test.ts) ──

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
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";
import { getActiveExecution } from "@/lib/studio/execution-registry";
import { computeWorkspaceChange } from "@/lib/litt-intelligence/workspace-change-producer";
import {
  encodeManifestCheckpointDescription,
  sha256Hex,
} from "@/lib/missions/workspace-manifest";

// ── Helpers ──

const CONV_ID = "conv-123";

function makeRequest(pausedRunId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio/conversations/${CONV_ID}/approvals/${pausedRunId}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
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
  return idx < 0 ? null : mocked.mock.calls[idx][0];
}

const OLD_HTML = "<html><body>Welcome to LiTT</body></html>";
const NEW_HTML = "<html><body>Harbor Coffee — fresh roast</body></html>";
const CSS = "body { color: #333; }";

/** The ORIGINAL pre-build baseline (created before segment 1's first mutation). */
const BASELINE_MANIFEST = {
  "index.html": sha256Hex(OLD_HTML),
  "styles.css": sha256Hex(CSS),
};
const ORIGINAL_CHECKPOINT_ID = "chk-orig";

function gateRecord(id: string, checkpointId: string | null) {
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
    checkpointId,
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
}

const awaitingMessage = {
  id: "msg-assistant-1",
  role: "assistant",
  content: "I need approval to write files.",
  status: "awaiting_approval",
};

/** Stage a gate record as both the readable row and the atomic resolve result. */
function stageGate(record: ReturnType<typeof gateRecord>) {
  vi.mocked(getPausedRun).mockResolvedValue(record as any);
  vi.mocked(resolvePausedRun).mockResolvedValue({ ...record, status: "approved" } as any);
}

/**
 * Faithful loop double: a pause result carries the checkpoint the loop was
 * threaded (existingCheckpoint) — the identity the route must persist on
 * the nested record. `script` decides per call whether the segment pauses
 * again or completes.
 */
function scriptLoop(script: Array<"pause" | "complete">) {
  vi.mocked(resumeAgentLoopV2).mockImplementation(async (input: any) => {
    const mode = script.shift() ?? "complete";
    const checkpoint = input.existingCheckpoint
      ? {
          checkpointId: input.existingCheckpoint.checkpointId,
          label: input.existingCheckpoint.label,
          gitSha: input.existingCheckpoint.gitSha,
        }
      : undefined;
    if (mode === "pause") {
      return {
        finalText: "I need approval for the next write too.",
        stepsUsed: 3,
        toolCalls: [],
        cancelled: false,
        checkpoint,
        pendingApproval: {
          toolId: "files.write",
          toolCallId: "tc-next",
          inputs: { path: "styles.css" },
          reason: "Mutation requires approval in ACT mode",
          pausedMessages: [{ role: "user", content: "x" }],
        },
      } as any;
    }
    return {
      finalText: "done",
      stepsUsed: 5,
      // Production-faithful (R5-C): a resumed files.write gate EXECUTES
      // the approved write, and the call is in the segment's tool log.
      // An empty log on a completed edit resume is the false-completion
      // shape the resume guard now fails honestly.
      toolCalls: [
        { toolId: "files.write", success: true, summary: "wrote styles.css", mutating: true },
      ],
      cancelled: false,
      checkpoint,
    } as any;
  });
}

/** POST one approval and wait for the detached executor to fully settle. */
async function approveGate(id: string, settleStatus: string) {
  const settleCountBefore = vi.mocked(transitionActionRunEventActivity).mock.calls.length;
  const res = await POST(makeRequest(id), paramsFor(id));
  expect(res.status).toBe(202);
  await vi.waitFor(() => expect(settleCallAfter(settleStatus, settleCountBefore)).not.toBeNull());
  // The R1a per-conversation executor registration must clear before the
  // next gate's POST, exactly as in production sequencing.
  await vi.waitFor(() => expect(getActiveExecution(CONV_ID)).toBeNull());
}

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

// ── Tests ──

describe("POST /approvals/[pausedRunId] — checkpoint continuity across nested gates (R2/E4-S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true as any);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    // The original baseline row: a manifest checkpoint (git unavailable at
    // creation), baseline riding the row description — Gate 1 canonical form.
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
    let created = 1;
    vi.mocked(createPausedRun).mockImplementation(async () => ({ id: `paused-${++created}` }) as any);
  });

  it("(a) a nested gate persists the ORIGINAL checkpointId, not null", async () => {
    scriptLoop(["pause"]);
    stageGate(gateRecord("paused-1", ORIGINAL_CHECKPOINT_ID));

    await approveGate("paused-1", "waiting_for_user");

    expect(createPausedRun).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createPausedRun).mock.calls[0][0]).toMatchObject({
      toolId: "files.write",
      checkpointId: ORIGINAL_CHECKPOINT_ID,
    });
  });

  it("(b) a third gate still carries the ORIGINAL checkpointId (unlimited chain)", async () => {
    scriptLoop(["pause", "pause"]);

    stageGate(gateRecord("paused-1", ORIGINAL_CHECKPOINT_ID));
    await approveGate("paused-1", "waiting_for_user");
    const gate2CheckpointId = vi.mocked(createPausedRun).mock.calls[0][0].checkpointId as string | null;

    // Feed the persisted gate-2 record forward exactly as the store stored it.
    stageGate(gateRecord("paused-2", gate2CheckpointId));
    await approveGate("paused-2", "waiting_for_user");

    expect(createPausedRun).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createPausedRun).mock.calls[1][0]).toMatchObject({
      checkpointId: ORIGINAL_CHECKPOINT_ID,
    });
  });

  it("(c) a resume from gate ≥2 completes against the ORIGINAL baseline — segment-1 change is in the verdict", async () => {
    scriptLoop(["pause", "pause", "complete"]);

    stageGate(gateRecord("paused-1", ORIGINAL_CHECKPOINT_ID));
    await approveGate("paused-1", "waiting_for_user");
    const gate2CheckpointId = vi.mocked(createPausedRun).mock.calls[0][0].checkpointId as string | null;

    stageGate(gateRecord("paused-2", gate2CheckpointId));
    await approveGate("paused-2", "waiting_for_user");
    const gate3CheckpointId = vi.mocked(createPausedRun).mock.calls[1][0].checkpointId as string | null;

    stageGate(gateRecord("paused-3", gate3CheckpointId));
    await approveGate("paused-3", "completed");

    // The final resume was threaded the ORIGINAL manifest baseline…
    const finalInput = vi.mocked(resumeAgentLoopV2).mock.calls[2][0] as any;
    expect(finalInput.existingCheckpoint).toEqual({
      checkpointId: ORIGINAL_CHECKPOINT_ID,
      label: "pre-approval",
      gitSha: "",
      kind: "manifest",
      manifest: BASELINE_MANIFEST,
    });

    // …and the finalize-tail seam diffs against it: index.html was changed
    // by segment 1's approved write (OLD → NEW), styles.css untouched.
    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, finalInput.existingCheckpoint ?? null);
    expect(change.status).toBe("changed");
    expect(change.files).toEqual(["index.html"]);
  });
});
