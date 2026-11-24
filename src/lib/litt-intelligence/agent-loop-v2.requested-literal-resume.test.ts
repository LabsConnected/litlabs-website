import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools, buildAssistantToolCallMessage } from "./llm-tool-calling";

/**
 * ACC-01 F9 on the approval-resumed path (Greptile, PR #1106,
 * finding 4). The live F9 edit was an approval-resumed run: the
 * approved files.write executes BEFORE the resumed loop starts, so
 * it never passes a mutation batch inside the loop — and the
 * mid-loop requested-literal repair feedback is gated on a batch.
 * When the model then simply replies "done", the run used to reach
 * the tail check and settle failed WITHOUT the one repair attempt
 * the design promises. The resumed run must offer that attempt up
 * front, before its first model step.
 */
describe("resumeAgentLoopV2 — requested-literal verification (ACC-01 F9, resumed)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = {
    text: 'The tagline has been updated to "Fresh from the oven every morning."',
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  };

  const ORIGINAL = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title></head>",
    "<body>",
    "<h1>Sunny Crust Bakery</h1>",
    '<p class="tagline">Freshly baked, with love and sunshine.</p>',
    "<p>Welcome to Sunny Crust.</p>",
    "</body>",
    "</html>",
  ].join("\n");

  const CORRUPTED = ORIGINAL.replace(
    "Freshly baked, with love and sunshine.",
    "Fresh from1 the oven every morning.",
  );
  const CORRECTED = ORIGINAL.replace(
    "Freshly baked, with love and sunshine.",
    "Fresh from the oven every morning.",
  );

  function memoryTransport() {
    const files = new Map<string, string>([["index.html", ORIGINAL]]);
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

  const INSTRUCTION =
    "Change the tagline under the bakery name to Fresh from the oven every morning";

  function makeResume(content: string): ResumeInput {
    const inputs = { projectId: "p-test", path: "index.html", content };
    return {
      pausedMessages: [
        { role: "user", content: INSTRUCTION },
        buildAssistantToolCallMessage(
          [{ toolId: "files.write", toolCallId: "tc-1", inputs }],
          "",
          undefined,
        ),
      ],
      toolId: "files.write",
      toolCallId: "tc-1",
      inputs,
      decision: "approved",
      config: {
        model: "test-model",
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };
  }

  function firstCallMessages() {
    return vi.mocked(callLLMWithTools).mock.calls[0][1] as Array<{
      role: string;
      content: string;
    }>;
  }

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("offers the repair attempt BEFORE the first resumed step when the approved edit missed the literal", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(CORRUPTED), transport);

    // The approved (corrupted) edit really landed.
    expect(files.get("index.html")).toContain("Fresh from1 the oven");
    // The repair attempt was offered: the FIRST resumed model call
    // already carries the verification feedback — the model had its
    // one chance to fix the file before any failure was settled.
    expect(
      firstCallMessages().some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("Verification failed") &&
          m.content.includes("Fresh from the oven every morning"),
      ),
    ).toBe(true);
    // The model replied "done" without repairing: the tail check
    // settles the run honestly failed, never a false success.
    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("Fresh from the oven every morning");
    expect(result.finalText).toBe(result.failedHonestly);
  });

  it("succeeds when the model uses the offered repair attempt to fix the approved edit", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", {
          projectId: "p-test",
          path: "index.html",
          content: CORRECTED,
        }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(CORRUPTED), transport);

    expect(
      firstCallMessages().some(
        (m) => typeof m.content === "string" && m.content.includes("Verification failed"),
      ),
    ).toBe(true);
    expect(files.get("index.html")).toContain("Fresh from the oven every morning.");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain("has been updated");
  });

  it("offers no feedback when the approved edit landed the literal the first time", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(CORRECTED), transport);

    expect(
      firstCallMessages().some(
        (m) => typeof m.content === "string" && m.content.includes("Verification failed"),
      ),
    ).toBe(false);
    expect(result.failedHonestly).toBeUndefined();
  });
});
