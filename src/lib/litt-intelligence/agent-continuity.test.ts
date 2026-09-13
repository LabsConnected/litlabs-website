import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Agent continuity across provider failover — the core V1 guarantee.
 *
 * These tests run the REAL runAgentLoopV2 and the REAL callLLMWithTools
 * router. Only the network (fetch / Gemini seam) and the tool registry are
 * mocked, so the full lifecycle is exercised:
 *
 *   Provider A → tool_call → tool executes → file mutation → result recorded
 *   → Provider A dies on the next request → Provider B receives the shared
 *   transcript including the completed tool result → final response.
 *
 * The mutating tool must execute exactly once — provider failover must never
 * replay a completed mutation.
 */

vi.mock("@/lib/evals/braintrust", () => ({ logLLMCall: vi.fn() }));
vi.mock("@/lib/siteConfig", () => ({ SITE_URL: "https://test.example.com" }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Fake tool registry — a single mutating files.write tool whose execution is
// spied on so we can prove exactly-once semantics.
const { filesWriteTool, executeSpy } = vi.hoisted(() => ({
  filesWriteTool: {
    id: "files.write",
    description: "Write a file to the workspace",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    risk: "medium",
    permissionLevel: "workspace",
    approvalPolicy: "auto-safe",
    timeoutMs: 10_000,
    idempotent: true,
    readOnly: false,
    enabled: true,
  },
  executeSpy: vi.fn(),
}));

vi.mock("./tool-registry", () => ({
  toolRegistry: {
    listEnabled: vi.fn(() => [filesWriteTool]),
    get: vi.fn((id: string) => (id === "files.write" ? filesWriteTool : undefined)),
    validateInputs: vi.fn(() => null),
    execute: executeSpy,
  },
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import {
  _setGeminiModelFactory,
  _setOllamaProbeForTests,
  type GeminiModelLike,
} from "./llm-tool-calling";
import {
  _resetProviderHealthForTests,
  getProviderHealth,
} from "./provider-registry";
import type { WorkspaceTransport } from "./workspace-transport";

// ─── Helpers ──────────────────────────────────────────────────────

const PROVIDER_ENVS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_HOST_PC",
  "LITT_OLLAMA_URL",
  "OLLAMA_MODEL",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
}

function makeTransport(): WorkspaceTransport {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/ws",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn().mockResolvedValue({
      checkpointId: "cp-1",
      label: "pre-agent-loop",
      gitSha: "abc123",
    }),
  } as unknown as WorkspaceTransport;
}

function makeOpenRouterResponse(text: string, toolCalls: unknown[] = []) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      model: "openrouter/free",
      choices: [{ message: { content: text, tool_calls: toolCalls }, finish_reason: "stop" }],
    }),
    text: async () => "",
  };
}

function makeErrorResponse(status: number, message: string) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    json: async () => ({}),
    text: async () => message,
  };
}

function openRouterBodies(): Array<Record<string, unknown>> {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes("openrouter"))
    .map(([, init]) => JSON.parse((init as { body: string }).body));
}

beforeEach(() => {
  mockFetch.mockReset();
  executeSpy.mockReset();
  executeSpy.mockResolvedValue({ ok: true, result: { path: "hello.txt", bytesWritten: 5 } });
  _resetProviderHealthForTests();
  _setGeminiModelFactory(null);
  _setOllamaProbeForTests(null);
  vi.unstubAllEnvs();
  clearProviderEnvs();
});

afterEach(() => {
  _resetProviderHealthForTests();
  _setGeminiModelFactory(null);
  _setOllamaProbeForTests(null);
  vi.unstubAllEnvs();
});

describe("agent continuity — state survives provider failover", () => {
  it("provider dies after a successful tool mutation → replacement provider continues, no duplicate execution", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    // Provider A (Gemini): first call emits a file-writing tool call;
    // second call dies with a server error.
    let geminiCall = 0;
    const geminiModel: GeminiModelLike = {
      generateContent: vi.fn(async () => {
        geminiCall++;
        if (geminiCall === 1) {
          return {
            response: {
              functionCalls: () => [
                { name: "files_write", args: { path: "hello.txt", content: "hello" } },
              ],
              text: () => "I'll write the file.",
            },
          };
        }
        throw new Error("500 Internal Server Error");
      }),
    };
    _setGeminiModelFactory(() => geminiModel);

    // Provider B (OpenRouter free) returns the final response.
    mockFetch.mockResolvedValue(makeOpenRouterResponse("The file has been written."));

    const result = await runAgentLoopV2(
      "write hello.txt containing 'hello'",
      makeTransport(),
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxRuntimeMs: 60_000,
      },
    );

    // ── The tool executed exactly once — no duplicate mutation ──
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith(
      "files.write",
      { path: "hello.txt", content: "hello" },
      expect.objectContaining({ hasApproval: true }),
    );

    // ── Provider B received the completed tool result ──
    const orBodies = openRouterBodies();
    expect(orBodies.length).toBeGreaterThanOrEqual(1);
    const messages = orBodies[0].messages as Array<Record<string, unknown>>;
    const assistantMsg = messages.find((m) => m.role === "assistant");
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(assistantMsg?.tool_calls).toBeDefined();
    expect((assistantMsg!.tool_calls as Array<{ function: { name: string } }>)[0].function.name)
      .toBe("files_write");
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toContain("hello.txt");
    // Correlation id is preserved across the provider boundary.
    const emittedCallId = (assistantMsg!.tool_calls as Array<{ id: string }>)[0].id;
    expect(toolMsg!.tool_call_id).toBe(emittedCallId);

    // ── The loop finished successfully on the replacement provider ──
    expect(result.modelFailed).toBeUndefined();
    expect(result.cancelled).toBe(false);
    expect(result.finalText).toBe("The file has been written.");
    expect(result.toolCalls).toEqual([
      { toolId: "files.write", success: true, summary: expect.any(String) },
    ]);

    // ── Routing events show the actual providers used ──
    const routing = result.events.filter((e) => e.type === "model_routing");
    expect(routing.map((e) => (e as { provider: string }).provider)).toEqual([
      "gemini",
      "openrouter",
    ]);
  });

  it("a replacement provider re-emitting the same mutation does not execute it twice", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    let geminiCall = 0;
    const geminiModel: GeminiModelLike = {
      generateContent: vi.fn(async () => {
        geminiCall++;
        if (geminiCall === 1) {
          return {
            response: {
              functionCalls: () => [
                { name: "files_write", args: { path: "hello.txt", content: "hello" } },
              ],
              text: () => "Writing the file.",
            },
          };
        }
        throw new Error("503 Service Unavailable");
      }),
    };
    _setGeminiModelFactory(() => geminiModel);

    // Provider B re-emits the IDENTICAL tool call (provider failover can
    // produce this), then on the next turn returns a final answer.
    let orCall = 0;
    mockFetch.mockImplementation(async () => {
      orCall++;
      if (orCall === 1) {
        return makeOpenRouterResponse("Retrying the write.", [
          {
            id: "call_or_1",
            type: "function",
            function: {
              name: "files_write",
              arguments: JSON.stringify({ path: "hello.txt", content: "hello" }),
            },
          },
        ]);
      }
      return makeOpenRouterResponse("All done — the file was already written.");
    });

    const result = await runAgentLoopV2(
      "write hello.txt",
      makeTransport(),
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxRuntimeMs: 60_000,
      },
    );

    // The mutation ran ONCE even though two providers emitted it.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(result.finalText).toContain("already written");
    // The dedupe was recorded as a skipped execution.
    expect(
      result.events.some(
        (e) => e.type === "tool_result" && e.summary === "skipped — already executed",
      ),
    ).toBe(true);
  });

  it("local Ollama completes the run when every cloud provider fails", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    _setOllamaProbeForTests(async () => ["llama3.1:8b"]);

    // Gemini dies immediately; OpenRouter is out of credits; Ollama wins.
    const geminiModel: GeminiModelLike = {
      generateContent: vi.fn(async () => {
        throw new Error("500 Internal Server Error");
      }),
    };
    _setGeminiModelFactory(() => geminiModel);

    mockFetch
      .mockResolvedValueOnce(makeErrorResponse(402, "insufficient credits"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          model: "llama3.1:8b",
          choices: [{ message: { content: "Done locally.", tool_calls: [] }, finish_reason: "stop" }],
        }),
        text: async () => "",
      });

    const result = await runAgentLoopV2(
      "say hello",
      makeTransport(),
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxRuntimeMs: 60_000,
      },
    );

    expect(result.modelFailed).toBeUndefined();
    expect(result.finalText).toBe("Done locally.");
    const routing = result.events.filter((e) => e.type === "model_routing");
    expect((routing[routing.length - 1] as { provider: string }).provider).toBe("ollama");
  });

  it("all providers failing produces a truthful, sanitized failure", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-or-key");

    const geminiModel: GeminiModelLike = {
      generateContent: vi.fn(async () => {
        throw new Error("401 invalid key sk-should-never-leak");
      }),
    };
    _setGeminiModelFactory(() => geminiModel);
    mockFetch.mockResolvedValue(makeErrorResponse(402, "credits"));

    const result = await runAgentLoopV2(
      "build something",
      makeTransport(),
      {
        systemPrompt: "You are LiTT.",
        executionMode: "auto",
        enableBuildFix: false,
        maxRuntimeMs: 60_000,
      },
    );

    expect(result.modelFailed).toBeTruthy();
    expect(result.cancelled).toBe(false);
    // The user-facing text is the truthful all-routes message, not a raw error.
    expect(result.finalText).toMatch(/all currently available AI routes/i);
    // No secrets leak into any surfaced field.
    expect(result.finalText).not.toContain("sk-should-never-leak");
    expect(result.modelFailed).not.toContain("sk-should-never-leak");
    expect(result.events.some((e) => e.type === "model_failed")).toBe(true);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
    // Gemini was disabled at provider level (401 → auth_invalid).
    expect(getProviderHealth("gemini").state).toBe("disabled");
  });
});
