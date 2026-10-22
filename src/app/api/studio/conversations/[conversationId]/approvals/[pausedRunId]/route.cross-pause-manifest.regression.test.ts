// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression tests — manifest checkpoint recovery across an approval pause
 * (Gate 1 cross-pause, follow-up to ART-20261020-015 blocker 4).
 *
 * The defect: the approvals route recovered only checkpointId/gitSha from
 * the checkpoint row. A manifest checkpoint (created before the pause when
 * git was unavailable — git_sha is empty and the path → sha256 baseline
 * rides the row's description) therefore reached the resumed run as an
 * empty-SHA checkpoint, and computeWorkspaceChange could only ever answer
 * "unknown" in the finale, even though the baseline existed in the DB.
 *
 * These tests drive the ACTUAL route recovery path (POST the approvals
 * route with the same mocked harness as route.test.ts), then feed the
 * threaded existingCheckpoint into the real computeWorkspaceChange with a
 * probe standing for the post-resume workspace — the same seam the resumed
 * loop's finale uses (agent-loop-v2: resume.existingCheckpoint →
 * computeWorkspaceChange(transport, checkpoint)).
 *
 * Fail-closed requirements pinned here:
 *   - missing manifest payload  → workspace-change "unknown"
 *   - invalid manifest payload  → workspace-change "unknown"
 *   - checkpoint-row lookup/DB failure → NO fabricated baseline; the
 *     outcome stays "unknown", exactly as the git path behaves today
 *   - git checkpoints recover via gitSha and compare via git, unchanged
 */

// ── Mocks (same harness as route.test.ts) ──

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
} from "@/lib/litt-intelligence/paused-run-store";
import { resumeAgentLoopV2 } from "@/lib/litt-intelligence/agent-loop-v2";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { getCheckpoint } from "@/lib/missions/mission-repository";
import {
  getActionRun,
  transitionActionRunEventActivity,
} from "@/lib/action-runtime";
import { getAwaitingApprovalAssistantMessage } from "@/lib/studio/conversation-service";
import { computeWorkspaceChange } from "@/lib/litt-intelligence/workspace-change-producer";
import {
  encodeManifestCheckpointDescription,
  sha256Hex,
  MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX,
} from "@/lib/missions/workspace-manifest";

// ── Helpers ──

const CONV_ID = "conv-123";
const PAUSED_ID = "paused-1";

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
  checkpointId: null as string | null,
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

function checkpointRow(overrides: Record<string, unknown>) {
  return {
    id: "chk-x",
    projectId: "proj-123",
    userId: "user_123",
    gitSha: "",
    label: "pre-approval",
    description: null,
    missionRunId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function approveAndCaptureCheckpoint(checkpointId: string) {
  vi.mocked(getPausedRun).mockResolvedValue({ ...pendingRun, checkpointId } as any);
  vi.mocked(resolvePausedRun).mockResolvedValue({
    ...pendingRun,
    checkpointId,
    status: "approved",
  } as any);
  const res = await POST(makeRequest(), routeParams);
  expect(res.status).toBe(202);
  const resumeInput = vi.mocked(resumeAgentLoopV2).mock.calls[0][0] as any;
  return resumeInput.existingCheckpoint;
}

/** A probe standing for the workspace file services + git, flat files. */
function fileProbe(files: Record<string, string>) {
  const gitStatus = vi.fn(async () => {
    throw new Error("HOST_EXECUTION_DISABLED: git must not be consulted for a manifest checkpoint");
  });
  return {
    gitStatus,
    listFiles: async (path: string) => {
      if (path !== "." && path !== "") throw new Error(`unexpected listFiles path ${path}`);
      return {
        entries: Object.keys(files).map((name) => ({ name, type: "file" })),
      };
    },
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`readFile: no such file ${path}`);
      return { content, size: content.length };
    },
  };
}

const OLD_HTML = "<html><body>Welcome to LiTT</body></html>";
const NEW_HTML = "<html><body>Harbor Coffee — fresh roast</body></html>";
const CSS = "body { color: #333; }";

// ── Tests ──

describe("POST /approvals/[pausedRunId] — manifest checkpoint recovery across the pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ userId: "user_123", clerkId: "clerk_123" } as any);
    vi.mocked(getActionRun).mockResolvedValue({ id: "run-parent-1", status: "waiting_for_user" } as any);
    vi.mocked(verifyProjectWorkspace).mockResolvedValue({ workspaceId: "ws-123" } as any);
    vi.mocked(markRunProcessing).mockResolvedValue(true as any);
    vi.mocked(getAwaitingApprovalAssistantMessage).mockResolvedValue(awaitingMessage as any);
    vi.mocked(resumeAgentLoopV2).mockResolvedValue({
      finalText: "done",
      stepsUsed: 1,
      toolCalls: [],
      cancelled: false,
      pendingApproval: undefined,
    } as any);
    // transitionActionRunEventActivity is consumed via its module mock.
    void transitionActionRunEventActivity;
  });

  it("threads the pre-pause manifest baseline into the resume, and the finale compares against it", async () => {
    const baseline = {
      "index.html": sha256Hex(OLD_HTML),
      "styles.css": sha256Hex(CSS),
    };
    vi.mocked(getCheckpoint).mockResolvedValue(
      checkpointRow({
        id: "chk-m1",
        gitSha: "",
        description: encodeManifestCheckpointDescription(baseline),
      }) as any,
    );

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-m1");

    expect(existingCheckpoint).toEqual({
      checkpointId: "chk-m1",
      label: "pre-approval",
      gitSha: "",
      kind: "manifest",
      manifest: baseline,
    });

    // The approved write lands after resume; the finale must compare
    // against the ORIGINAL pre-pause manifest, by re-enumeration only.
    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("changed");
    expect(change.files).toEqual(["index.html"]);
    expect(change.rollbackAvailable).toBe(false);
    expect(probe.gitStatus).not.toHaveBeenCalled();
  });

  it("fails closed when the manifest payload is missing (prefix only)", async () => {
    vi.mocked(getCheckpoint).mockResolvedValue(
      checkpointRow({
        id: "chk-m2",
        gitSha: "",
        description: MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX,
      }) as any,
    );

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-m2");

    // The recovery must identify this as a manifest checkpoint whose
    // evidence is absent — never silently downgrade it to a git baseline.
    expect(existingCheckpoint.kind).toBe("manifest");
    expect(existingCheckpoint.gitSha).toBe("");
    expect(existingCheckpoint.manifest).toBeUndefined();

    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("unknown");
  });

  it("fails closed when the manifest payload is malformed JSON", async () => {
    vi.mocked(getCheckpoint).mockResolvedValue(
      checkpointRow({
        id: "chk-m3",
        gitSha: "",
        description: `${MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX}{not valid json`,
      }) as any,
    );

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-m3");

    expect(existingCheckpoint.kind).toBe("manifest");
    expect(existingCheckpoint.manifest).toBeUndefined();

    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("unknown");
  });

  it("fails closed when the manifest payload has non-string hashes", async () => {
    vi.mocked(getCheckpoint).mockResolvedValue(
      checkpointRow({
        id: "chk-m4",
        gitSha: "",
        description: `${MANIFEST_CHECKPOINT_DESCRIPTION_PREFIX}${JSON.stringify({ "index.html": 42 })}`,
      }) as any,
    );

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-m4");

    expect(existingCheckpoint.kind).toBe("manifest");
    expect(existingCheckpoint.manifest).toBeUndefined();

    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("unknown");
  });

  it("does not fabricate a baseline when the checkpoint-row lookup fails (DB failure surfaces as unknown)", async () => {
    vi.mocked(getCheckpoint).mockRejectedValue(new Error("database unavailable"));

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-gone-db");

    // Exactly the git path's behavior today: no kind, no manifest, empty
    // SHA — and the finale answers "unknown", never a fabricated verdict.
    expect(existingCheckpoint).toEqual({
      checkpointId: "chk-gone-db",
      label: "pre-approval",
      gitSha: "",
    });

    const probe = fileProbe({ "index.html": NEW_HTML, "styles.css": CSS });
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("unknown");
  });

  it("control: a git checkpoint still recovers via gitSha and compares via git, unchanged", async () => {
    const sha = "a".repeat(40);
    vi.mocked(getCheckpoint).mockResolvedValue(
      checkpointRow({
        id: "chk-g1",
        gitSha: sha,
        description: "Agent checkpoint: pre-approval",
      }) as any,
    );

    const existingCheckpoint = await approveAndCaptureCheckpoint("chk-g1");

    expect(existingCheckpoint).toEqual({
      checkpointId: "chk-g1",
      label: "pre-approval",
      gitSha: sha,
    });

    const probe = {
      gitStatus: vi.fn(async () => ({
        clean: false,
        staged: [],
        modified: [{ path: "index.html" }],
        untracked: [] as string[],
      })),
    };
    const change = await computeWorkspaceChange(probe as any, existingCheckpoint);
    expect(change.status).toBe("changed");
    expect(change.files).toEqual(["index.html"]);
    expect(change.checkpointSha).toBe(sha);
    expect(probe.gitStatus).toHaveBeenCalled();
  });
});
