import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools, buildAssistantToolCallMessage } from "./llm-tool-calling";
import { ProgressEmitter, type ProgressEvent } from "./progress-events";

/**
 * Reply-content guard, end to end through both finalize paths.
 *
 * Production, 2026-11-25: Larry's Studio build reply pasted the
 * ENTIRE index.html into chat. The files.write tool returns only a
 * ~60-char receipt, so the dump is the model re-emitting the content
 * it authored in its own files.write call — the loop's finalText is
 * the model's closing text verbatim, with no strip step. The guard
 * compares the closing text against the contents this run wrote and
 * replaces any dump with a one-line reference.
 *
 * Delivery routes covered here:
 * - normal completion (runAgentLoopV2 finalize)
 * - approval-resume (resumeAgentLoopV2 finalize)
 * - streaming (the D4 text channel): the final step's raw text must
 *   never reach progress "text" events; the guarded text is emitted
 *   as the closing segment instead. The persisted message and the
 *   reconnect path both read result.finalText (routes persist exactly
 *   that), so a guarded finalText is the persistence guarantee.
 */

const PAGE = [
  "<!DOCTYPE html>",
  "<html>",
  "<head><title>Sunny Crust Bakery</title>",
  "<style>",
  "  body { background: #03050a; }",
  "  h1 { color: #f5f5f4; }",
  "  .tagline { color: #e7e5e4; }",
  "  p { color: #e7e5e4; }",
  "</style>",
  "</head>",
  "<body>",
  "  <h1>Sunny Crust Bakery</h1>",
  '  <p class="tagline">Fresh from the oven every morning.</p>',
  "  <p>Blueberry muffins — $4</p>",
  "</body>",
  "</html>",
].join("\n");

const REFERENCE = "index.html — written in this run; open it in Code to view.";
const TAGLINE = "Fresh from the oven every morning.";

const DUMP_REPLY = {
  text: [
    "Your bakery site is built. Here's the content of the index.html file:",
    "",
    "```html",
    PAGE,
    "```",
    "",
    "Let me know if you want changes.",
  ].join("\n"),
  toolCalls: [],
  finishReason: "stop",
  model: "test-model",
};

function toolCallReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    toolCalls: [{ toolCallId, toolId, inputs }],
    finishReason: "tool_calls",
    model: "test-model",
  };
}

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

/**
 * Script the mocked LLM like the real one: each response's text is
 * handed to options.onText (the D4 channel) before the response
 * returns, exactly as llm-tool-calling does.
 */
function scriptLLM(replies: Array<Record<string, unknown>>) {
  const queue = [...replies];
  vi.mocked(callLLMWithTools).mockImplementation(async (...args: unknown[]) => {
    const opts = args[3] as { onText?: (text: string) => void } | undefined;
    const reply = queue.shift() ?? {
      text: "Done.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    };
    if (opts?.onText && typeof reply.text === "string" && reply.text) {
      opts.onText(reply.text);
    }
    return reply as never;
  });
}

function collectEvents() {
  const events: ProgressEvent[] = [];
  const emitter = new ProgressEmitter((evt) => events.push(evt));
  const textEvents = () =>
    events
      .filter((e) => e.type === "text")
      .map((e) => (e as { text: string }).text);
  return { emitter, textEvents };
}

const CONFIG = {
  model: "test-model",
  systemPrompt: "You are LiTT.",
  executionMode: "auto" as const,
  enableBuildFix: false,
};

const INSTRUCTION = "Build a one-page website for a bakery called Sunny Crust Bakery";

beforeEach(() => {
  vi.mocked(callLLMWithTools).mockReset();
});

describe("runAgentLoopV2 — reply-content guard (normal completion)", () => {
  it("strips a verbatim dump of the just-written file from the final text", async () => {
    const { transport, files } = memoryTransport();
    scriptLLM([
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      DUMP_REPLY,
    ]);

    const result = await runAgentLoopV2(INSTRUCTION, transport, CONFIG);

    expect(files.get("index.html")).toBe(PAGE);
    expect(result.failedHonestly).toBeUndefined();
    expect(result.finalText).toContain(REFERENCE);
    expect(result.finalText).toContain("Your bakery site is built.");
    expect(result.finalText).toContain("Let me know if you want changes.");
    expect(result.finalText).not.toContain(TAGLINE);
    expect(result.finalText).not.toContain("Blueberry muffins");
    expect(result.finalText).not.toContain("Here's the content");
  });

  it("never streams the dump: progress text events carry the guarded closing text", async () => {
    const { transport } = memoryTransport();
    const { emitter, textEvents } = collectEvents();
    scriptLLM([
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      DUMP_REPLY,
    ]);

    const result = await runAgentLoopV2(INSTRUCTION, transport, CONFIG, emitter);

    const streamed = textEvents().join("\n");
    expect(streamed).not.toContain(TAGLINE);
    expect(streamed).not.toContain("Blueberry muffins");
    expect(streamed).toContain(REFERENCE);
    expect(result.finalText).toContain(REFERENCE);
  });

  it("preserves the dump when the user explicitly asked to see the file contents", async () => {
    const { transport } = memoryTransport();
    scriptLLM([
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      DUMP_REPLY,
    ]);

    const result = await runAgentLoopV2(
      "Build the bakery page, then show me the full content of the file in chat.",
      transport,
      CONFIG,
    );

    expect(result.finalText).toContain(TAGLINE);
    expect(result.finalText).toContain("Blueberry muffins");
    expect(result.finalText).not.toContain(REFERENCE);
  });

  it("preserves a legitimate short snippet in a build reply", async () => {
    const { transport } = memoryTransport();
    const snippetReply = {
      text: [
        "Done — the hero now uses the dark background:",
        "",
        "```css",
        "  body { background: #03050a; }",
        "  h1 { color: #f5f5f4; }",
        "```",
        "",
        "Everything else is unchanged.",
      ].join("\n"),
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    };
    scriptLLM([
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      snippetReply,
    ]);

    const result = await runAgentLoopV2(INSTRUCTION, transport, CONFIG);

    expect(result.finalText).toContain("body { background: #03050a; }");
    expect(result.finalText).toContain("Everything else is unchanged.");
    expect(result.finalText).not.toContain(REFERENCE);
  });

  it("leaves the silent-outcome fallback untouched when the model gives no closing text", async () => {
    const { transport } = memoryTransport();
    scriptLLM([
      toolCallReply("tc-1", "files.write", { projectId: "p-test", path: "index.html", content: PAGE }),
      { text: "", toolCalls: [], finishReason: "stop", model: "test-model" },
    ]);

    const result = await runAgentLoopV2(INSTRUCTION, transport, CONFIG);

    expect(result.finalText).toContain("produced no closing summary");
    expect(result.finalText).not.toContain(REFERENCE);
  });
});

describe("resumeAgentLoopV2 — reply-content guard (approval-resume)", () => {
  function makeResume(): ResumeInput {
    const inputs = { projectId: "p-test", path: "index.html", content: PAGE };
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
      config: { ...CONFIG },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };
  }

  it("strips a verbatim dump from the resumed run's final text", async () => {
    const { transport, files } = memoryTransport();
    scriptLLM([DUMP_REPLY]);

    const result = await resumeAgentLoopV2(makeResume(), transport);

    expect(files.get("index.html")).toBe(PAGE);
    expect(result.finalText).toContain(REFERENCE);
    expect(result.finalText).toContain("Let me know if you want changes.");
    expect(result.finalText).not.toContain(TAGLINE);
    expect(result.finalText).not.toContain("Blueberry muffins");
  });

  it("never streams the dump on the resumed path either", async () => {
    const { transport } = memoryTransport();
    const { emitter, textEvents } = collectEvents();
    scriptLLM([DUMP_REPLY]);

    const result = await resumeAgentLoopV2(makeResume(), transport, emitter);

    const streamed = textEvents().join("\n");
    expect(streamed).not.toContain(TAGLINE);
    expect(streamed).toContain(REFERENCE);
    expect(result.finalText).toContain(REFERENCE);
  });
});
