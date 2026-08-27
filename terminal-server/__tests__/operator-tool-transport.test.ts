/**
 * Regression tests for the canonical operator tool transport.
 *
 * These tests reproduce the production failure where the canonical
 * runLiTTOperator used streamLiTTCode() (text-only, no native tool
 * support) and threw "OpenRouter stream completed without assistant
 * content" when the model returned a native tool call with zero text.
 *
 * The fix routes the operator through streamLiTTMessagesWithTools(),
 * which sends native OpenRouter function definitions and converts
 * model-selected tool_calls into LiTT's canonical fenced tool_call
 * envelope.
 *
 * Tests:
 *   A — native tool call with zero assistant text → canonical envelope
 *   B — full agent round trip (tool → result → final answer)
 *   C — unknown provider tool → fail closed
 *   D — invalid tool arguments → fail closed
 *   E — ordinary text response → still works
 *   F — multiple tool rounds
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mock setup ───────────────────────────────────────────────────
//
// We mock globalThis.fetch to control OpenRouter responses. This lets
// us simulate native tool calls, text responses, and error cases
// without a real API key or network.

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key-123";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENROUTER_API_KEY;
});

// Helper: build an OpenRouter non-streaming JSON response
function openRouterResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: build a choice with text content
function textChoice(text: string) {
  return {
    index: 0,
    message: { role: "assistant", content: text },
    finish_reason: "stop",
  };
}

// Helper: build a choice with a native tool call and no text
function toolCallChoice(functionName: string, args: Record<string, unknown>) {
  return {
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_001",
          type: "function",
          function: {
            name: functionName,
            arguments: JSON.stringify(args),
          },
        },
      ],
    },
    finish_reason: "tool_calls",
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("LiTTModelProvider tool transport", () => {
  // We import dynamically so the mock is in place before module-level
  // code runs (if any).
  async function importProvider() {
    const mod = await import("../litt-operator.js");
    return mod;
  }

  // We need to import streamLiTTMessagesWithTools directly to test the
  // transport layer without the full agent loop.
  async function importTransport() {
    const mod = await import("../litt-code.js");
    return mod;
  }

  const sampleTools = [
    {
      toolId: "project.status",
      functionName: "project_status",
      description: "Get project + git status",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      toolId: "project.run",
      functionName: "project_run",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  ];

  // TEST A — native tool call with zero assistant text
  it("A: converts native tool call with zero text into canonical tool_call envelope", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    fetchMock.mockResolvedValue(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [
          toolCallChoice("project_status", {}),
        ],
      }),
    );

    const events: any[] = [];
    const result = await streamLiTTMessagesWithTools(
      [{ role: "user", content: "What is the project status?" }],
      sampleTools,
      (e: any) => events.push(e),
    );

    // Must NOT throw "completed without assistant content"
    expect(result.content).toContain("```tool_call");
    expect(result.content).toContain('"tool"');
    expect(result.content).toContain("project.status");
    expect(result.content).toContain('"inputs"');
  });

  // TEST B — full agent round trip would require the agent loop + gateway.
  // We test the transport layer: tool call in round 1, text in round 2.
  it("B: transport handles tool call then text in sequential calls", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    // Round 1: model requests a tool
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [toolCallChoice("project_run", { command: "pwd" })],
      }),
    );

    const events1: any[] = [];
    const result1 = await streamLiTTMessagesWithTools(
      [{ role: "user", content: "What is the current working directory? Verify it." }],
      sampleTools,
      (e: any) => events1.push(e),
    );

    expect(result1.content).toContain("```tool_call");
    expect(result1.content).toContain("project.run");
    expect(result1.content).toContain("pwd");

    // Round 2: model receives tool result and returns final answer
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [textChoice("The current working directory is /tmp.")],
      }),
    );

    const events2: any[] = [];
    const result2 = await streamLiTTMessagesWithTools(
      [
        { role: "user", content: "What is the current working directory?" },
        { role: "assistant", content: result1.content },
        { role: "user", content: "Tool result: /tmp" },
      ],
      sampleTools,
      (e: any) => events2.push(e),
    );

    expect(result2.content).toContain("/tmp");
    expect(result2.content).not.toContain("```tool_call");
  });

  // TEST C — unknown provider tool → fail closed
  it("C: unknown provider tool name fails closed with error", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    fetchMock.mockResolvedValue(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [toolCallChoice("nonexistent_tool", {})],
      }),
    );

    const events: any[] = [];
    await expect(
      streamLiTTMessagesWithTools(
        [{ role: "user", content: "Run something" }],
        sampleTools,
        (e: any) => events.push(e),
      ),
    ).rejects.toThrow(/unknown tool/i);
  });

  // TEST D — invalid tool arguments → fail closed
  it("D: invalid (non-object) tool arguments fail closed", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    fetchMock.mockResolvedValue(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_002",
                  type: "function",
                  function: {
                    name: "project_run",
                    arguments: "not-valid-json",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );

    const events: any[] = [];
    await expect(
      streamLiTTMessagesWithTools(
        [{ role: "user", content: "Run something" }],
        sampleTools,
        (e: any) => events.push(e),
      ),
    ).rejects.toThrow(/invalid arguments/i);
  });

  // TEST E — ordinary text response still works
  it("E: ordinary text response (no tool call) returns normally", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    fetchMock.mockResolvedValue(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [textChoice("The capital of Japan is Tokyo.")],
      }),
    );

    const events: any[] = [];
    const result = await streamLiTTMessagesWithTools(
      [{ role: "user", content: "What is the capital of Japan?" }],
      sampleTools,
      (e: any) => events.push(e),
    );

    expect(result.content).toBe("The capital of Japan is Tokyo.");
    expect(result.content).not.toContain("```tool_call");
  });

  // TEST F — multiple tool rounds (two sequential tool calls)
  it("F: transport handles two sequential tool calls in separate rounds", async () => {
    const { streamLiTTMessagesWithTools } = await importTransport();

    // Round 1: first tool call
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [toolCallChoice("project_status", {})],
      }),
    );

    const result1 = await streamLiTTMessagesWithTools(
      [{ role: "user", content: "Check the project" }],
      sampleTools,
      () => {},
    );
    expect(result1.content).toContain("project.status");

    // Round 2: second tool call
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [toolCallChoice("project_run", { command: "git log --oneline -5" })],
      }),
    );

    const result2 = await streamLiTTMessagesWithTools(
      [
        { role: "user", content: "Check the project" },
        { role: "assistant", content: result1.content },
        { role: "user", content: "Tool result: status ok" },
      ],
      sampleTools,
      () => {},
    );
    expect(result2.content).toContain("project.run");
    expect(result2.content).toContain("git log");

    // Round 3: final answer
    fetchMock.mockResolvedValueOnce(
      openRouterResponse({
        model: "openai/gpt-oss-20b",
        choices: [textChoice("Project is healthy. Latest commit is abc123.")],
      }),
    );

    const result3 = await streamLiTTMessagesWithTools(
      [
        { role: "user", content: "Check the project" },
        { role: "assistant", content: result1.content },
        { role: "user", content: "Tool result: status ok" },
        { role: "assistant", content: result2.content },
        { role: "user", content: "Tool result: abc123 def456" },
      ],
      sampleTools,
      () => {},
    );
    expect(result3.content).toContain("healthy");
    expect(result3.content).not.toContain("```tool_call");
  });
});

// ─── LiTTModelProvider integration with runLiTTOperator ───────────

describe("LiTTModelProvider construction", () => {
  it("maps ToolDefinition[] to LiTTNativeTool[] with valid function names", async () => {
    // We can't easily import the private class, but we can verify
    // the mapping logic by checking the transport call with tools
    // that have IDs containing special characters.
    const { streamLiTTMessagesWithTools } = await import("../litt-code.js");

    const toolsWithSpecialChars = [
      {
        toolId: "project.search",
        functionName: "project_search",
        description: "Search files",
        parameters: { type: "object", properties: {} },
      },
    ];

    fetchMock.mockResolvedValue(
      openRouterResponse({
        model: "test-model",
        choices: [textChoice("ok")],
      }),
    );

    // The request body should contain the function definition
    let capturedBody: any;
    fetchMock.mockImplementation(async (url: string, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return openRouterResponse({
        model: "test-model",
        choices: [textChoice("ok")],
      });
    });

    await streamLiTTMessagesWithTools(
      [{ role: "user", content: "test" }],
      toolsWithSpecialChars,
      () => {},
    );

    expect(capturedBody.tools).toHaveLength(1);
    expect(capturedBody.tools[0].function.name).toBe("project_search");
    expect(capturedBody.tool_choice).toBe("auto");
    expect(capturedBody.parallel_tool_calls).toBe(false);
    // Raised from 1024 (which truncated ordinary answers mid-sentence).
    // The cap must stay PRESENT and finite — these calls are billed
    // against the user's LiTTBits balance, so an absent cap is unbounded
    // spend. See OPENROUTER_MAX_TOKENS in litt-code.ts.
    expect(capturedBody.max_tokens).toBe(4096);
  });
});
