// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 R1 (execution integrity) — checkpoint creation failures are
 * RECORDED, never swallowed.
 *
 * The defect (audit D2): the loop created the pre-mutation checkpoint
 * with `createCheckpointBeforeMutation(...) ?? undefined` and dropped
 * a failed creation on the floor. The paused run then persisted a null
 * checkpointId, indistinguishable from "no checkpoint needed", and the
 * resume continued on an unverified baseline.
 *
 * The contract these tests pin:
 *   - a creation attempt that fails (transport records an error) is
 *     carried on the loop result as `checkpointFailure` — including on
 *     the PAUSE result, whose record the resume validates;
 *   - a null result with NO recorded error is a static (gitless)
 *     workspace's "not applicable" — never reported as a failure;
 *   - a later successful creation heals the record (the run holds a
 *     baseline, so there is nothing to refuse);
 *   - the same recording holds inside a resumed segment: a nested
 *     pause after a failed creation carries the failure too.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
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

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, callLLMWithTools, type LLMMessage } from "./llm-tool-calling";

const PAGE = [
  "<!DOCTYPE html>",
  "<html><head><title>Sunny Crust Bakery</title>",
  "<style>body { background: #ffffff; color: #1c1917; }</style>",
  "</head><body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>",
].join("\n");

function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    toolCalls: [{ toolCallId, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}
const doneReply = {
  text: "Your bakery site is ready.",
  toolCalls: [],
  finishReason: "stop",
  model: "test-model",
};

/**
 * In-memory transport whose checkpoint behavior the test controls:
 * `checkpointPlan` decides per attempt — an Error means creation fails
 * (and the transport records it on lastCheckpointError, exactly like
 * the real transport); a string means success with that checkpoint id;
 * null means the static-workspace "not applicable" (no error recorded).
 */
function makeTransport(checkpointPlan: Array<Error | string | null>) {
  const files = new Map<string, string>();
  let attempt = 0;
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    lastCheckpointError: null as string | null,
    createCheckpointBeforeMutation: vi.fn(async (label: string) => {
      const planned = checkpointPlan[Math.min(attempt, checkpointPlan.length - 1)];
      attempt += 1;
      if (planned instanceof Error) {
        transport.lastCheckpointError = planned.message;
        return null;
      }
      if (planned === null) {
        transport.lastCheckpointError = null;
        return null;
      }
      transport.lastCheckpointError = null;
      return { checkpointId: planned, label, gitSha: "a".repeat(40) };
    }),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    listFiles: vi.fn(async (dir: string) => ({
      entries: [...files.keys()]
        .filter((k) => (dir === "." || dir === "" ? !k.includes("/") : k.startsWith(`${dir}/`)))
        .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
    })),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
  } as unknown as WorkspaceTransport & { lastCheckpointError: string | null };
  return { transport, files };
}

const actConfig = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "act" as const,
  enableBuildFix: false,
  isStaticWorkspace: false,
};

describe("P0 R1 — checkpoint creation failure is recorded, not swallowed", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("carries the failure on the PAUSE result when creation fails before the gate", async () => {
    const { transport } = makeTransport([new Error("checkpoint store unavailable")]);
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
    );

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      actConfig,
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.checkpoint).toBeUndefined();
    expect(result.baselineCheckpoint).toBeUndefined();
    // The failure is on the result — this is what the paused-run
    // record persists and the resume validates.
    expect(result.checkpointFailure).toBe("checkpoint store unavailable");
    // …and it was said live, not just stored.
    expect(
      result.events.some(
        (e) => e.type === "status" && e.summary.includes("checkpoint could not be created"),
      ),
    ).toBe(true);
  });

  it("treats a null checkpoint with no recorded error as not-applicable (static), not a failure", async () => {
    const { transport } = makeTransport([null]);
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
    );

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      { ...actConfig, isStaticWorkspace: true },
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.checkpointFailure).toBeUndefined();
  });

  it("heals when a later creation succeeds — the run holds a baseline", async () => {
    const { transport } = makeTransport([new Error("transient git failure"), "cp-2"]);
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      )
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "about.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await runAgentLoopV2(
      "Build a two-page website for a bakery called Sunny Crust Bakery",
      transport,
      { ...actConfig, executionMode: "auto" as const },
    );

    expect(result.cancelled).toBe(false);
    expect(result.baselineCheckpoint?.checkpointId).toBe("cp-2");
    expect(result.checkpointFailure).toBeUndefined();
  });

  it("records the failure on a nested pause inside a resumed segment", async () => {
    const { transport } = makeTransport([new Error("checkpoint store unavailable")]);
    const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
      [{ toolId: "files.write", toolCallId: "tc-1", inputs: { projectId: "p-test", path: "index.html", content: PAGE } }],
      "Building the bakery site.",
      undefined,
    );
    const resume: ResumeInput = {
      pausedMessages: [
        { role: "user", content: "Build a one-page website for a bakery called Sunny Crust Bakery" },
        assistantMsg,
      ],
      toolId: "files.write",
      toolCallId: "tc-1",
      inputs: { projectId: "p-test", path: "index.html", content: PAGE },
      decision: "approved",
      config: { ...actConfig },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };
    // The approved write lands; the continuation asks for another
    // gated write, whose pre-mutation checkpoint creation fails.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "about.html", content: PAGE }),
    );

    const result = await resumeAgentLoopV2(resume, transport);

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.checkpointFailure).toBe("checkpoint store unavailable");
  });
});
