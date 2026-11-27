// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * P0 R5 (execution integrity) — ONE stable logical run identity
 * (audit D7).
 *
 * The defect: a run's identity fragmented across billing run, action
 * run, paused run, and metering run — separate ids with no persisted
 * correlation. The resumed segment minted a fresh metering id and
 * started a NEW observability record ("<id>:resume") because the
 * original identity was never persisted across the approval pause.
 *
 * The contract these tests pin:
 *   - the initial segment's result carries logicalRunId (its
 *     metering run id), and its observability record is keyed by it;
 *   - a resume threaded with that identity (from the paused-run
 *     record) keeps the SAME logicalRunId — across the segment and
 *     across a provider switch inside it — and continues the SAME
 *     observability record (no ":resume" offshoot);
 *   - a nested pause inside the resumed segment carries the identity
 *     forward on its result, so the next segment continues it too;
 *   - a legacy resume (no threaded identity) behaves exactly as
 *     before: a segment-local metering id and the historical
 *     ":resume" observability name — with the identity stabilizing
 *     from that segment's result onward.
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
vi.mock("@/lib/site-enrich/resolver", () => ({
  resolveSlotImage: vi.fn(async () => null),
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

function makeTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    lastCheckpointError: null as string | null,
    // Static (gitless) workspace: checkpoint creation is "not
    // applicable" — null with no recorded error.
    createCheckpointBeforeMutation: vi.fn(async () => null),
    readFile: vi.fn(async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`404 not found: ${p}`);
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (p: string, content: string) => {
      files.set(p, content);
      return { saved: true };
    }),
    listFiles: vi.fn(async (dir: string) => {
      const prefix = dir === "" || dir === "." ? "" : `${dir.replace(/\/$/, "")}/`;
      const entries = new Map<string, string>();
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (!rest) continue;
        const seg = rest.split("/")[0];
        entries.set(seg, rest.includes("/") ? "directory" : "file");
      }
      return { entries: [...entries].map(([name, type]) => ({ name, type })) };
    }),
    gitStatus: vi.fn(async () => ({
      branch: "main",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

const actConfig = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "act" as const,
  enableBuildFix: false,
  isStaticWorkspace: true,
};

function resumeInputFor(logicalRunId?: string): ResumeInput {
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "files.write", toolCallId: "tc-1", inputs: { projectId: "p-test", path: "index.html", content: PAGE } }],
    "Building the bakery site.",
    undefined,
  );
  return {
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
    ...(logicalRunId ? { logicalRunId } : {}),
  };
}

describe("P0 R5 — one stable logical run identity across segments", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("the initial segment carries its logical identity on the pause result", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
    );

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      actConfig,
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(typeof result.logicalRunId).toBe("string");
    expect(result.logicalRunId!.length).toBeGreaterThan(0);
    // The observability record is keyed by the same identity.
    expect(result.runObservability?.runId).toBe(result.logicalRunId);
  });

  it("a threaded resume keeps the same identity across the segment and a provider switch", async () => {
    const { transport } = makeTransport();
    // The approved write lands; the continuation is served by a
    // DIFFERENT model/provider — the identity must not move.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Your bakery site is ready.",
      toolCalls: [],
      finishReason: "stop",
      model: "gemini-2.5-flash",
      provider: "gemini",
    });

    const result = await resumeAgentLoopV2(
      resumeInputFor("logical-run-123"),
      transport,
    );

    expect(result.logicalRunId).toBe("logical-run-123");
    // The resumed segment continues the SAME observability record —
    // no ":resume" offshoot.
    expect(result.runObservability?.runId).toBe("logical-run-123");
  });

  it("a nested pause inside the resumed segment carries the identity forward", async () => {
    const { transport } = makeTransport();
    // The continuation asks for another gated write → nested pause.
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "about.html", content: PAGE }),
    );

    const result = await resumeAgentLoopV2(
      resumeInputFor("logical-run-123"),
      transport,
    );

    expect(result.pendingApproval?.toolId).toBe("files.write");
    // The pause result carries the identity forward (this is what the
    // approvals route persists on the nested paused-run record). The
    // nested-pause result shape does not attach the observability
    // record — pre-existing — so identity-on-result is the contract
    // asserted here.
    expect(result.logicalRunId).toBe("logical-run-123");
  });

  it("a legacy resume (no threaded identity) keeps the historical shape", async () => {
    const { transport } = makeTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "Your bakery site is ready.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });

    const result = await resumeAgentLoopV2(resumeInputFor(undefined), transport);

    // Segment-local identity, carried on the result so it stabilizes
    // from here on; the observability record keeps its historical
    // ":resume" name.
    expect(typeof result.logicalRunId).toBe("string");
    expect(result.logicalRunId!.length).toBeGreaterThan(0);
    expect(result.runObservability?.runId).toBe(`${result.logicalRunId}:resume`);
  });
});
