// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

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

/**
 * ACC-07 Item 3 — one approval covers the entire scoped build
 * (Larry's ruling, Acceptance Run 1 on c15099b4: one small bakery
 * build paused three times — files.write, image.stock, files.write).
 *
 * The contract these tests pin:
 *  - the FIRST gated build-scope call of a run asks for the scope,
 *    with the scope text on the card (grantsBuildScope);
 *  - after that approval, in-scope calls (more writes, image/media
 *    generation) proceed without re-prompting;
 *  - publishing and destructive actions still gate on their own,
 *    scope or not;
 *  - a run that never received the scope keeps the old per-step
 *    behavior (it asks again — and that ask is the scope ask).
 */

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

function memoryTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
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
        .filter((k) => (dir === "." ? !k.includes("/") : k.startsWith(`${dir}/`)))
        .map((k) => ({ name: k.split("/").pop() as string, type: "file" })),
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

/** A faithful pause: the run gated on files.write for index.html. */
function makeResume(overrides?: Partial<ResumeInput>): ResumeInput {
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
    ...overrides,
  };
}

describe("ACC-07 build scope — the approval architecture", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("the first build-scope gate asks for the scope, with the scope text on the card", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
    );

    const result = await runAgentLoopV2(
      "Build a one-page website for a bakery called Sunny Crust Bakery",
      transport,
      actConfig,
    );

    expect(result.pendingApproval).toBeTruthy();
    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.pendingApproval?.grantsBuildScope).toBe(true);
    expect(result.pendingApproval?.buildScopeApproved).toBe(false);
    expect(result.pendingApproval?.reason).toContain("covers the whole build");
    expect(result.pendingApproval?.reason).toContain("does NOT cover publishing or deploying");
  });

  it("after the scope approval, further in-scope writes proceed without re-prompting", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "about.html", content: PAGE }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume({ buildScopeApproved: true }), transport);

    expect(result.pendingApproval).toBeUndefined();
    expect(files.get("index.html")).toContain("Sunny Crust Bakery");
    expect(files.get("about.html")).toContain("Sunny Crust Bakery");
    expect(result.failedHonestly).toBeUndefined();
  });

  it("a destructive action still prompts on its own, scope or not", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-2", "files.delete", { projectId: "p-test", path: "index.html" }),
    );

    const result = await resumeAgentLoopV2(makeResume({ buildScopeApproved: true }), transport);

    expect(result.pendingApproval).toBeTruthy();
    expect(result.pendingApproval?.toolId).toBe("files.delete");
    expect(result.pendingApproval?.grantsBuildScope).toBeFalsy();
    // The scope the run already holds rides the pause so it survives.
    expect(result.pendingApproval?.buildScopeApproved).toBe(true);
  });

  it("publishing still prompts on its own, scope or not", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-2", "project.deploy", {}),
    );

    const result = await resumeAgentLoopV2(makeResume({ buildScopeApproved: true }), transport);

    expect(result.pendingApproval).toBeTruthy();
    expect(result.pendingApproval?.toolId).toBe("project.deploy");
    expect(result.pendingApproval?.grantsBuildScope).toBeFalsy();
  });

  it("without a granted scope, the next in-scope call gates again — as a scope ask", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(
      toolCallReply("tc-2", "files.write", { projectId: "p-test", path: "about.html", content: PAGE }),
    );

    const result = await resumeAgentLoopV2(makeResume(), transport);

    expect(result.pendingApproval).toBeTruthy();
    expect(result.pendingApproval?.toolId).toBe("files.write");
    expect(result.pendingApproval?.grantsBuildScope).toBe(true);
  });
});
