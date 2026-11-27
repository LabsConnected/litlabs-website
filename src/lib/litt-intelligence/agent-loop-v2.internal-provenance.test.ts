// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

/**
 * Coordination fix (c) — internal-message provenance.
 *
 * Loop-injected continuation/system messages used to enter
 * llmMessages as plain role:"user", indistinguishable from the
 * customer's own instructions — including inside pausedMessages
 * snapshots — so downstream machinery (the R7 leakage check) had
 * no way to tell customer text from execution text. The marker
 * mechanism (NOT PR #1139's nudge, which stays on hold): every
 * loop injection site marks its message origin:"internal"; the
 * marker rides the pause/resume serialization; R7 treats marked
 * content as internal (never customer content, no quoted-content
 * exemption — covered in instruction-leakage.test.ts (c2)/(c3)).
 *
 * This test pins the round trip: a run that receives a loop
 * continuation nudge and then pauses for approval persists the
 * marker in its paused snapshot; the snapshot survives the JSON
 * round trip the paused-run store performs; a resume built from
 * the revived snapshot completes with the marker still attached
 * to the internal message and still absent from the customer's.
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
import { callLLMWithTools, type LLMMessage } from "./llm-tool-calling";

const PAGE =
  "<!DOCTYPE html><html><head><title>Sunny Crust Bakery</title></head>" +
  "<body><h1>Sunny Crust Bakery</h1><p>Fresh from the oven.</p></body></html>";
const REQUEST = "Build a one-page website for a bakery called Sunny Crust Bakery";

function makeTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async (label: string) => ({
      checkpointId: "cp-1",
      label,
      gitSha: "a".repeat(40),
    })),
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
    gitDiff: vi.fn(async () => ({ diff: "" })),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
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

describe("internal-message provenance — pause/resume round trip (coordination fix c)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("marks loop-injected messages, never the customer's, and the marker survives pause → JSON → resume", async () => {
    const { transport, files } = makeTransport();
    // Step 1: the model announces work in prose with no tool call —
    // the loop injects its continuation nudge as role "user".
    // Step 2: the model emits the gated write — the run pauses.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "Now I'll create the bakery page.",
        toolCalls: [],
        finishReason: "stop",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { toolCallId: "tc-1", toolId: "files.write", inputs: { projectId: "p-test", path: "index.html", content: PAGE } },
        ],
        finishReason: "tool_calls",
        model: "test-model",
      });

    const initial = await runAgentLoopV2(REQUEST, transport, { ...actConfig });
    const pending = initial.pendingApproval;
    expect(pending?.toolId).toBe("files.write");
    if (!pending?.pausedMessages) throw new Error("expected a paused message snapshot");

    const snapshot = pending.pausedMessages;
    const customer = snapshot.find((m) => m.role === "user" && m.content === REQUEST);
    expect(customer).toBeDefined();
    expect(customer?.origin).toBeUndefined();
    const internal = snapshot.filter((m) => m.origin === "internal");
    expect(internal).toHaveLength(1);
    expect(internal[0].role).toBe("user");
    expect(internal[0].content).toContain("announced further work");

    // The paused-run store persists the snapshot as JSON — the
    // marker must survive exactly that round trip.
    const revived = JSON.parse(JSON.stringify(snapshot)) as LLMMessage[];
    expect(revived.find((m) => m.content === REQUEST)?.origin).toBeUndefined();
    expect(revived.filter((m) => m.origin === "internal")).toHaveLength(1);

    // Resume from the revived snapshot: the approved write lands,
    // the run completes, and the final message list still carries
    // the marker on the internal message only.
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Your bakery site is ready.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });
    const resume: ResumeInput = {
      pausedMessages: revived,
      toolId: pending.toolId,
      toolCallId: pending.toolCallId,
      inputs: pending.inputs as Record<string, unknown>,
      decision: "approved",
      config: { ...actConfig },
      stepsUsedBeforePause: pending.stepsUsedAtPause ?? 1,
      hadInterveningMutation: pending.hadInterveningMutationAtPause ?? false,
      deferredToolCalls: pending.deferredToolCalls,
    };
    const result = await resumeAgentLoopV2(resume, transport);

    expect(result.pendingApproval).toBeUndefined();
    expect(files.get("index.html")).toBe(PAGE);
    const finalMessages = result.finalMessages ?? [];
    expect(finalMessages.find((m) => m.content === REQUEST)?.origin).toBeUndefined();
    expect(finalMessages.filter((m) => m.origin === "internal")).toHaveLength(1);
  }, 30_000);
});
