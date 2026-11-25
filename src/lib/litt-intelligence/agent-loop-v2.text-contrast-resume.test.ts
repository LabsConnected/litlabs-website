import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools, buildAssistantToolCallMessage } from "./llm-tool-calling";

/**
 * ACC-02 Defect A on the approval-resumed path (mirrors the F9 resume
 * wiring, Greptile PR #1106 finding 4): the approved files.write
 * executes BEFORE the resumed loop starts, so it never passes a
 * mutation batch inside the loop — and the mid-loop contrast repair
 * feedback is gated on a batch. When the model then simply replies
 * "done", the run would reach the tail check and settle failed
 * WITHOUT the one repair attempt the design promises. The resumed
 * run must offer that attempt up front, before its first model step.
 */
describe("resumeAgentLoopV2 — invisible-text verification (ACC-02 Defect A, resumed)", () => {
  function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
    return {
      text: "",
      toolCalls: [{ toolCallId, toolId, inputs }],
      finishReason: "tool_calls",
      model: "test-model",
    };
  }
  const doneReply = {
    text: "Your bakery site is live — a glassmorphic dark theme with a lime accent and near-black background.",
    toolCalls: [],
    finishReason: "stop",
    model: "test-model",
  };

  const INVISIBLE = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title>",
    "<style>",
    "  body { background: #ffffff; font-family: sans-serif; }",
    "  h1 { color: #1c1917; }",
    "  .tagline { color: #f5f5f4; }",
    "</style>",
    "</head>",
    "<body>",
    "  <h1>Sunny Crust Bakery</h1>",
    '  <p class="tagline">Fresh from the oven every morning.</p>',
    "</body>",
    "</html>",
  ].join("\n");

  const FIXED = INVISIBLE.replace("background: #ffffff", "background: #03050a")
    .replace("h1 { color: #1c1917; }", "h1 { color: #f5f5f4; }");

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

  const INSTRUCTION = "Build a one-page website for a bakery called Sunny Crust Bakery";

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

  it("offers the repair attempt BEFORE the first resumed step when the approved write shipped invisible text", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(INVISIBLE), transport);

    // The approved (invisible) page really landed.
    expect(files.get("index.html")).toContain("background: #ffffff");
    // The repair attempt was offered up front: the FIRST resumed
    // model call already carries the contrast feedback.
    expect(
      firstCallMessages().some(
        (m) =>
          m.role === "user" &&
          typeof m.content === "string" &&
          m.content.includes("Verification failed") &&
          m.content.includes("INVISIBLE"),
      ),
    ).toBe(true);
    // The model replied "done" without repairing: the tail check
    // settles the run honestly failed, never a false success.
    expect(result.failedHonestly).toBeTruthy();
    expect(result.failedHonestly).toContain("invisible");
    expect(result.finalText).toBe(result.failedHonestly);
  });

  it("succeeds when the model uses the offered repair attempt to fix the page", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(
        toolCallReply("tc-2", "files.write", {
          projectId: "p-test",
          path: "index.html",
          content: FIXED,
        }),
      )
      .mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(INVISIBLE), transport);

    expect(
      firstCallMessages().some(
        (m) => typeof m.content === "string" && m.content.includes("Verification failed"),
      ),
    ).toBe(true);
    expect(files.get("index.html")).toContain("background: #03050a");
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain("glassmorphic dark theme");
  });

  // ACC-06a item 1, resumed path: an approved write whose colors are
  // runtime-decided (Tailwind browser compiler) passes with a note —
  // never failedHonestly — and the written bytes are untouched.
  const UNVERIFIABLE = [
    "<!DOCTYPE html>",
    "<html>",
    "<head><title>Sunny Crust Bakery</title>",
    '  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
    "</head>",
    "<body>",
    '  <section class="bg-zinc-900">',
    '    <p class="text-zinc-100">Fresh from the oven every morning.</p>',
    "  </section>",
    "</body>",
    "</html>",
  ].join("\n");

  it("passes with a note — never failed — when the approved write's colors are runtime-decided", async () => {
    const { transport, files } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(UNVERIFIABLE), transport);

    expect(result.failedHonestly).toBeUndefined();
    expect(result.contrastNote).toBeTruthy();
    expect(result.contrastNote).toContain("couldn't statically verify");
    expect(result.finalText).toContain("couldn't statically verify the text contrast");
    // Byte-identical read-back: the verifier fix never alters content.
    expect(files.get("index.html")).toBe(UNVERIFIABLE);
    // No repair pressure for a page the checker cannot judge.
    expect(
      firstCallMessages().some(
        (m) => typeof m.content === "string" && m.content.includes("Verification could not judge"),
      ),
    ).toBe(false);
  });

  it("offers no feedback when the approved write was readable the first time", async () => {
    const { transport } = memoryTransport();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce(doneReply);

    const result = await resumeAgentLoopV2(makeResume(FIXED), transport);

    expect(
      firstCallMessages().some(
        (m) => typeof m.content === "string" && m.content.includes("Verification failed"),
      ),
    ).toBe(false);
    expect(result.failedHonestly).toBeUndefined();
  });
});
