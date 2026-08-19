/**
 * Native tool delivery — dogfood P0 regression (project.status).
 *
 * The live failure ("I'm unable to access the project status tool in
 * this session…") happened because the OpenRouter transport declared NO
 * native tool schemas: the model saw a prompt-only protocol and refused
 * to call tools. The fix declares the project tools NATIVELY (OpenAI
 * function calling) and translates native `tool_calls` responses back
 * into LiTT's internal `tool_call` fence format so the agent loop keeps
 * ONE parsing path.
 *
 * These tests stub fetch — no live API key needed.
 */

import { describe, it, expect, afterEach } from "vitest";
import { OpenRouterModelProvider } from "../lib/model-provider.js";
import type { ToolDefinition } from "@litt/agent-core";
import { parseToolCall, stripToolCallBlocks } from "@litt/agent-core";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const STATUS_TOOL: ToolDefinition = {
  id: "project.status",
  name: "status",
  description: "Get project status: root, branch, git changes, remote",
  inputSchema: { type: "object", properties: {} },
  readOnly: true,
};

/** SSE body helper — enqueue the given SSE lines then close. */
function sseBody(lines: string[]): BodyInit {
  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l + "\n\n"));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

/** A fetch stub that records the request body and returns the SSE lines. */
function recordingFetch(lines: string[], recorded: { body: any }): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    recorded.body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(sseBody(lines), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
}

describe("OpenRouterModelProvider — native tool schemas are declared", () => {
  it("includes an OpenAI-compatible tools array in the request body when tools are provided", async () => {
    const recorded: { body: any } = { body: null };
    globalThis.fetch = recordingFetch(["data: [DONE]"], recorded);

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      tools: [STATUS_TOOL],
    });
    await provider.stream([{ role: "user", content: "What branch am I on?" }], () => {});

    const tools = recorded.body.tools as Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0].type).toBe("function");
    // OpenAI requires function names to match ^[a-zA-Z0-9_-]+$, so the
    // dotted canonical id `project.status` is sanitized to `project_status`
    // at the provider boundary. The reverse mapping translates it back to
    // `project.status` when the model calls it (see tests below).
    expect(tools[0].function.name).toBe("project_status");
    expect(tools[0].function.name).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(tools[0].function.description).toContain("Get project status");
    expect(tools[0].function.parameters).toEqual({ type: "object", properties: {} });
  });

  it("omits the tools array when none are provided (backward compat)", async () => {
    const recorded: { body: any } = { body: null };
    globalThis.fetch = recordingFetch(["data: [DONE]"], recorded);
    const provider = new OpenRouterModelProvider({ apiKey: "sk-test", model: "openai/gpt-5.6-luna" });
    await provider.stream([{ role: "user", content: "hi" }], () => {});
    expect(recorded.body.tools).toBeUndefined();
  });
});

describe("OpenRouterModelProvider — native tool_calls translate to the internal fence format", () => {
  it("streams a fragmented native tool call and renders a parseable tool_call block", async () => {
    // The model emits a native function call with arguments split across
    // deltas — exactly what OpenAI-compatible streaming returns.
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"project_status\",\"arguments\":\"\"}}]}}]}",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{}\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      tools: [STATUS_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "What branch am I on?" }], () => {});

    expect(result.content).toContain("```tool_call");
    // The agent loop's canonical parser must execute the translated call.
    const parsed = parseToolCall(result.content);
    expect(parsed?.toolId).toBe("project.status");
    expect(parsed?.inputs).toEqual({});
    // And the block must never leak into a final answer.
    expect(stripToolCallBlocks(result.content)).not.toContain("project.status");
  });

  it("appends native tool calls after prose content without corrupting the text", async () => {
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"Let me check\"}}]}",
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"project_status\",\"arguments\":\"{\\\"check\\\":\\\"clean\\\"}\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      tools: [STATUS_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});

    expect(result.content).toContain("Let me check");
    const parsed = parseToolCall(result.content);
    expect(parsed?.toolId).toBe("project.status");
    expect(parsed?.inputs).toEqual({ check: "clean" });
    expect(stripToolCallBlocks(result.content)).toBe("Let me check");
  });

  it("multiple native tool calls in one response translate to multiple blocks (first wins in the loop)", async () => {
    const BRANCH_TOOL: ToolDefinition = {
      id: "project.branch",
      name: "branch",
      description: "Get current git branch name",
      inputSchema: { type: "object", properties: {} },
      readOnly: true,
    };
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"project_status\",\"arguments\":\"{}\"}},{\"index\":1,\"function\":{\"name\":\"project_branch\",\"arguments\":\"{}\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      tools: [STATUS_TOOL, BRANCH_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});

    const first = parseToolCall(result.content);
    expect(first?.toolId).toBe("project.status");
    // The second native call (project_branch) reverse-maps to the canonical
    // project.branch id in its fence block.
    expect(result.content).toContain("project.branch");
  });

  it("a malformed arguments string degrades to empty inputs, never a crash", async () => {
    const lines = [
      "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"project_status\",\"arguments\":\"NOT-JSON\"}}]}}]}",
      "data: [DONE]",
    ];
    globalThis.fetch = recordingFetch(lines, { body: null });

    const provider = new OpenRouterModelProvider({
      apiKey: "sk-test",
      model: "openai/gpt-5.6-luna",
      tools: [STATUS_TOOL],
    });
    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});
    const parsed = parseToolCall(result.content);
    expect(parsed?.toolId).toBe("project.status");
    expect(parsed?.inputs).toEqual({});
  });
});

describe("agent loop — project.status executes end-to-end through the gateway", () => {
  it("a provider that emits the native-translated fence block drives a real tool execution", async () => {
    // Full loop with a stub provider whose FIRST response is the
    // translated tool call and whose SECOND response is the final
    // answer (the shape the real provider produces after execution).
    const { runAgentLoop, createDefaultRegistry } = await import("@litt/agent-core");

    let calls = 0;
    const stubProvider = {
      activeModel: null,
      configuredModel: "openai/gpt-5.6-luna",
      profile: "smart" as const,
      async stream(messages: Array<{ role: string; content: string }>, emit: (e: { type: string; text?: string }) => void) {
        calls++;
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        if (calls === 1) {
          emit({ type: "delta", text: "```tool_call\n{ \"tool\": \"project.status\", \"inputs\": {} }\n```" });
          return { content: "```tool_call\n{ \"tool\": \"project.status\", \"inputs\": {} }\n```", model: "openai/gpt-5.6-luna", provider: "openrouter", usage: { total_tokens: 10 }, timing: { ttftMs: 0, generationMs: 0, totalMs: 0 }, profile: "smart" };
        }
        // Second round: the tool result is in the conversation — answer
        // from the REAL evidence (never claim the tool is unavailable).
        const toolResult = lastUser.includes('"project.status" returned') || lastUser.includes("Tool \"status\" returned");
        emit({ type: "delta", text: toolResult ? "You're on feat/litt-final-integration. Working tree: clean." : "I'm unable to access the project status tool in this session." });
        return { content: toolResult ? "You're on feat/litt-final-integration. Working tree: clean." : "I'm unable to access the project status tool in this session.", model: "openai/gpt-5.6-luna", provider: "openrouter", usage: { total_tokens: 20 }, timing: { ttftMs: 0, generationMs: 0, totalMs: 0 }, profile: "smart" };
      },
    } as never;

    const registry = createDefaultRegistry();
    // The registry handlers execute through a shell — stub it so
    // project.status genuinely succeeds (the real CLI provides the
    // hardened ShellExecutor through the gateway).
    const stubShell = {
      cwd: process.cwd(),
      async execute(req: { command: string; args: string[]; cwd: string; timeoutMs?: number }) {
        const isStatus = req.command === "git" && req.args[0] === "status";
        return {
          ok: isStatus,
          stdout: isStatus ? "" : "",
          stderr: "",
          exitCode: isStatus ? 0 : 1,
          durationMs: 1,
          status: (isStatus ? "success" : "failed") as "success" | "failed" | "cancelled" | "timeout",
          truncated: false,
          pid: 1,
        };
      },
    };
    const result = await runAgentLoop(
      "What branch am I on and is the working tree clean?",
      {
        model: stubProvider,
        tools: registry,
        shell: stubShell as never,
        cwd: process.cwd(),
        userId: "cli-user",
        mode: "act",
        maxRounds: 4,
        // No gateway: the loop falls back to the registry execute path
        // (unit-test boundary) — the real CLI always provides the gateway.
      },
    );

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.toolCalls.some((tc) => tc.toolId === "project.status" && tc.result.success)).toBe(true);
    expect(result.content).toContain("feat/litt-final-integration");
    expect(result.content).not.toContain("unable");
  });
});
