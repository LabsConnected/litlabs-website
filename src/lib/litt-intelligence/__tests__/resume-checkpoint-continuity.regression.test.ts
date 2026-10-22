// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";
import type { CheckpointInfo } from "../workspace-transport";

/**
 * Regression tests — checkpoint continuity INSIDE the resume loop
 * (Repair R2, Diagnosis E4-S2, loop-side hops).
 *
 * Threading the paused record's checkpointId through the approvals route
 * is necessary but not sufficient: the resume loop itself dropped the
 * threaded baseline in three places —
 *
 *   L1  the per-mutation re-checkpoint (resume main loop) REPLACED
 *       `checkpoint` with a fresh mid-build snapshot before a nested
 *       pause / the finalize tail, so the pause result (and later the
 *       verdict) no longer referred to the original baseline;
 *   L3  the deferred-batch re-checkpoint did the same to
 *       `state.checkpoint`, which the resume reads back after the batch;
 *   L2  the deferred-batch nested-pause return omitted `checkpoint` from
 *       the AgentLoopResult entirely.
 *
 * Per-mutation checkpoints are still CREATED (each mutation keeps its
 * rollback point and its checkpoint event) — they just must not replace
 * the baseline the segment was threaded. A fresh snapshot is adopted as
 * the baseline only when the segment started with none.
 *
 * The fake transport is faithful to production: createCheckpointBeforeMutation
 * snapshots the CURRENT workspace (a manifest of what's on disk right
 * now), so a replaced baseline observably excludes earlier changes.
 */

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { resumeAgentLoopV2, type ResumeInput } from "../agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools, type LLMMessage } from "../llm-tool-calling";
import { sha256Hex } from "@/lib/missions/workspace-manifest";

const OLD_HTML = "<html><body>Welcome to LiTT</body></html>";
const NEW_HTML = "<html><body>Harbor Coffee — fresh roast</body></html>";
const CSS = "body { color: #333; }";
const NEW_CSS = "body { color: rebeccapurple; }";

/** The original pre-build baseline, threaded into every resume below. */
const BASELINE: CheckpointInfo = {
  checkpointId: "chk-orig",
  label: "pre-approval",
  gitSha: "",
  kind: "manifest",
  manifest: {
    "index.html": sha256Hex(OLD_HTML),
    "styles.css": sha256Hex(CSS),
  },
};

function makeWorkspace() {
  const files = new Map<string, string>([
    ["index.html", OLD_HTML],
    ["styles.css", CSS],
  ]);
  let freshCount = 0;
  const transport = {
    workspaceId: "ws-r2",
    userId: "u-r2",
    projectId: "p-r2",
    workspaceRoot: "/tmp/r2",
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { saved: true };
    }),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`readFile: no such file ${path}`);
      return { content, size: content.length };
    }),
    listFiles: vi.fn(async (dir: string) => {
      if (dir !== "." && dir !== "") throw new Error(`unexpected listFiles path ${dir}`);
      return { entries: [...files.keys()].map((name) => ({ name, type: "file" })) };
    }),
    // Faithful: a checkpoint snapshots the workspace AS IT IS NOW.
    createCheckpointBeforeMutation: vi.fn(async (label: string) => {
      freshCount += 1;
      const manifest: Record<string, string> = {};
      for (const [path, content] of files) manifest[path] = sha256Hex(content);
      return {
        checkpointId: `chk-fresh-${freshCount}`,
        label,
        gitSha: "",
        kind: "manifest" as const,
        manifest,
      };
    }),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

function makeResume(overrides: Partial<ResumeInput>): ResumeInput {
  const toolId = overrides.toolId ?? "files.write";
  const toolCallId = overrides.toolCallId ?? "tc-approved";
  const inputs = overrides.inputs ?? { projectId: "p-r2", path: "index.html", content: NEW_HTML };
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId, toolCallId, inputs }],
    "Working on the site.",
    undefined,
  );
  return {
    pausedMessages: [{ role: "user", content: "Build Harbor Coffee" }, assistantMsg],
    toolId,
    toolCallId,
    inputs,
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: 1,
    hadInterveningMutation: false,
    existingCheckpoint: BASELINE,
    ...overrides,
  };
}

function llmReturns(...responses: Array<{ text: string; toolCalls: Array<{ toolId: string; toolCallId: string; inputs: Record<string, unknown> }> }>) {
  const mocked = vi.mocked(callLLMWithTools);
  mocked.mockReset();
  for (const r of responses) {
    mocked.mockResolvedValueOnce({ ...r, finishReason: "stop", model: "test-model" } as any);
  }
  // Any further turn ends the run.
  mocked.mockResolvedValue({ text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" } as any);
}

describe("resumeAgentLoopV2 — checkpoint continuity across nested gates (R2/E4-S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("L1: a nested pause result carries the ORIGINAL checkpoint, not the fresh per-mutation snapshot", async () => {
    const { transport } = makeWorkspace();
    // The approved files.write (index.html) executes first; the model then
    // asks for a second write, which gates in ACT mode → nested pause.
    llmReturns({
      text: "",
      toolCalls: [{ toolId: "files.write", toolCallId: "tc-2", inputs: { projectId: "p-r2", path: "styles.css", content: NEW_CSS } }],
    });

    const result = await resumeAgentLoopV2(makeResume({}), transport);

    expect(result.pendingApproval?.toolId).toBe("files.write");
    // The per-mutation checkpoint was still created (rollback point)…
    expect(vi.mocked(transport.createCheckpointBeforeMutation)).toHaveBeenCalled();
    // …but the pause result carries the baseline the segment was threaded.
    expect(result.checkpoint?.checkpointId).toBe("chk-orig");
  });

  it("L1 (tail): a completing AUTO resume diffs against the ORIGINAL baseline — the approved write is in the verdict", async () => {
    const { transport } = makeWorkspace();
    // AUTO: the approved write lands, the model's next write executes
    // without a gate (checkpointing first, mid-build), then the run ends.
    llmReturns(
      { text: "", toolCalls: [{ toolId: "files.write", toolCallId: "tc-2", inputs: { projectId: "p-r2", path: "styles.css", content: NEW_CSS } }] },
      { text: "All done.", toolCalls: [] },
    );

    const result = await resumeAgentLoopV2(
      makeResume({ config: { systemPrompt: "You are LiTT.", executionMode: "auto", enableBuildFix: false } }),
      transport,
    );

    expect(result.cancelled).toBe(false);
    expect(result.workspaceChange?.status).toBe("changed");
    // index.html changed BEFORE the mid-build re-checkpoint (it is the
    // approved tool's own write); against the slid baseline it vanishes.
    expect(result.workspaceChange?.files).toEqual(["index.html", "styles.css"]);
  });

  it("L2: a deferred-batch nested pause returns the ORIGINAL checkpoint on the result", async () => {
    const { transport } = makeWorkspace();
    llmReturns({ text: "Done.", toolCalls: [] });

    const result = await resumeAgentLoopV2(
      makeResume({
        toolId: "files.read",
        toolCallId: "tc-read",
        inputs: { projectId: "p-r2", path: "index.html" },
        deferredToolCalls: [
          { toolCallId: "d-1", toolId: "files.write", inputs: { projectId: "p-r2", path: "extra.html", content: "<p>extra</p>" } },
        ],
      }),
      transport,
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.checkpoint?.checkpointId).toBe("chk-orig");
  });

  it("L3: a deferred-batch mutation does not slide the baseline — the tail verdict still sees the approved write", async () => {
    const { transport } = makeWorkspace();
    llmReturns({ text: "All done.", toolCalls: [] });

    const result = await resumeAgentLoopV2(
      makeResume({
        config: { systemPrompt: "You are LiTT.", executionMode: "auto", enableBuildFix: false },
        deferredToolCalls: [
          { toolCallId: "d-1", toolId: "files.write", inputs: { projectId: "p-r2", path: "styles.css", content: NEW_CSS } },
        ],
      }),
      transport,
    );

    expect(result.cancelled).toBe(false);
    expect(result.workspaceChange?.status).toBe("changed");
    expect(result.workspaceChange?.files).toEqual(["index.html", "styles.css"]);
  });
});
