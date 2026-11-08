import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Local Ollama route regression tests for callLLMWithTools.
 *
 * Contracts under test (all proven by live failures on this dev host):
 *   - Ollama attempts go through a scoped undici dispatcher (lifted
 *     headersTimeout) so a slow CPU-bound turn is NOT killed by the
 *     ~300s socket default — while the app-level timeout still applies
 *   - a picker model hint ("ollama/<tag>") is honored verbatim, never
 *     silently swapped for the env/auto pick
 *   - small-context (":Nk") models get max_tokens clamped to what fits
 *     inside num_ctx after prompt headroom — no silent prompt truncation
 *   - keep_alive is sent so a multi-turn build does not thrash reloads
 *   - reasoning-only responses (content "" + reasoning field, no
 *     tool_calls) come back as empty-tool-call responses — no crash,
 *     no fabricated calls
 *   - the app timeout still classifies a stalled local attempt "timeout"
 *   - upstream cancellation aborts the attempt
 */

vi.mock("@/lib/evals/braintrust", () => ({ logLLMCall: vi.fn() }));
vi.mock("@/lib/siteConfig", () => ({ SITE_URL: "https://test.example.com" }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Ollama calls go through undici's own fetch (custom dispatchers are
// rejected by Node's bundled fetch) — route it through the same mock so
// dispatched calls stay interceptable and no real socket opens.
vi.mock("undici", async (importOriginal) => {
  const original = await importOriginal<typeof import("undici")>();
  return {
    ...original,
    fetch: (...args: Parameters<typeof original.fetch>) => mockFetch(...args),
  };
});

import {
  callLLMWithTools,
  _setOllamaProbeForTests,
  _resetOllamaWarmForTests,
} from "./llm-tool-calling";
import { _resetProviderHealthForTests } from "./provider-registry";

const TEST_TOOL = {
  id: "files.write",
  description: "Write a file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

const PROVIDER_ENVS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "OPENAI_API_KEY",
  "OLLAMA_MODEL",
  "OLLAMA_TIMEOUT_MS",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_PROJECT_ID",
  "VERCEL",
];

function clearProviderEnvs() {
  for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
  // Do NOT stub LITT_DISABLE_OLLAMA — the ollama route must stay eligible.
  vi.stubEnv("LITT_DISABLE_OLLAMA", "");
}

function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function ollamaChatResponse(message: Record<string, unknown>, finishReason = "tool_calls") {
  return okJson({
    model: "litt-builder:8k",
    choices: [{ message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 10 },
  });
}

/** Default mockFetch: warm path (/api/ps → empty, /api/generate → ok) and
 *  a chat/completions responder supplied per-test. */
function mockOllamaTransport(chatImpl: () => unknown) {
  mockFetch.mockImplementation(async (url: string, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/ps")) return okJson({ models: [] });
    if (u.endsWith("/api/generate")) return okJson({ done: true });
    if (u.endsWith("/api/tags")) return okJson({ models: [] });
    if (u.endsWith("/chat/completions")) return chatImpl();
    return okJson({});
  });
}

const SYSTEM = "You build websites with tools.";
const MESSAGES = [{ role: "user" as const, content: "Build index.html" }];

describe("callLLMWithTools — local Ollama route", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    _resetProviderHealthForTests();
    _resetOllamaWarmForTests();
    clearProviderEnvs();
    _setOllamaProbeForTests(async () => ["litt-builder:8k", "litt-hermes:16k"]);
  });
  afterEach(() => {
    _setOllamaProbeForTests(null);
    vi.unstubAllEnvs();
  });

  it("passes a scoped undici dispatcher (lifted headersTimeout) on the ollama fetch", async () => {
    mockOllamaTransport(() =>
      ollamaChatResponse({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "files_write", arguments: '{"path":"index.html","content":"<html></html>"}' } },
        ],
      }),
    );
    await callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], {});
    const chatCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith("/chat/completions"));
    expect(chatCall).toBeTruthy();
    expect(chatCall![1]?.dispatcher).toBeTruthy();
    // Non-ollama probes stay on the default dispatcher (undefined).
    const psCall = mockFetch.mock.calls.find(([u]) => String(u).endsWith("/api/ps"));
    expect(psCall![1]?.dispatcher).toBeUndefined();
  });

  it("honors a picker model hint verbatim instead of the env/auto pick", async () => {
    let sentModel: string | undefined;
    mockOllamaTransport(() => {
      return ollamaChatResponse({ role: "assistant", content: "done", tool_calls: [] }, "stop");
    });
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/chat/completions")) {
        sentModel = JSON.parse(String(init?.body)).model;
        return ollamaChatResponse({ role: "assistant", content: "done", tool_calls: [] }, "stop");
      }
      return okJson(u.endsWith("/api/ps") ? { models: [] } : { done: true });
    });
    await callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], { model: "ollama/litt-builder:8k" });
    expect(sentModel).toBe("litt-builder:8k");
  });

  it("clamps max_tokens to the remaining num_ctx headroom on :8k models and sends keep_alive", async () => {
    let sentBody: Record<string, unknown> = {};
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/chat/completions")) {
        sentBody = JSON.parse(String(init?.body));
        return ollamaChatResponse({ role: "assistant", content: "ok", tool_calls: [] }, "stop");
      }
      return okJson(u.endsWith("/api/ps") ? { models: [] } : { done: true });
    });
    // A large system prompt (~28k chars ≈ 7k tokens) against the 8192 ctx
    // forces the clamp well below the declared 4096.
    await callLLMWithTools("x".repeat(28_000), MESSAGES, [TEST_TOOL], { model: "ollama/litt-builder:8k", maxTokens: 4096 });
    expect(sentBody.max_tokens).toBeLessThan(4096);
    expect(sentBody.max_tokens).toBeGreaterThanOrEqual(256);
    expect(sentBody.keep_alive).toBe("10m");
  });

  it("does not clamp max_tokens on a big-context model", async () => {
    let sentBody: Record<string, unknown> = {};
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/chat/completions")) {
        sentBody = JSON.parse(String(init?.body));
        return ollamaChatResponse({ role: "assistant", content: "ok", tool_calls: [] }, "stop");
      }
      return okJson(u.endsWith("/api/ps") ? { models: [] } : { done: true });
    });
    await callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], { model: "ollama/litt-hermes:16k", maxTokens: 4096 });
    expect(sentBody.max_tokens).toBe(4096);
  });

  it("parses a real tool_call response into ToolCalls", async () => {
    mockOllamaTransport(() =>
      ollamaChatResponse({
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "c1", type: "function", function: { name: "files_write", arguments: '{"path":"index.html","content":"x"}' } },
        ],
      }),
    );
    const res = await callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], { model: "ollama/litt-builder:8k" });
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0].toolId).toBe("files.write");
  });

  it("returns an empty-tool-call response for reasoning-only output — no fabricated calls", async () => {
    mockOllamaTransport(() =>
      ollamaChatResponse({
        role: "assistant",
        content: "",
        reasoning: "Let me think about whether to write the file first...",
      }, "stop"),
    );
    const res = await callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], { model: "ollama/litt-builder:8k" });
    expect(res.toolCalls).toHaveLength(0);
    expect(res.text ?? "").not.toContain("<tool_call>");
  });

  it("aborts the attempt on upstream cancellation", async () => {
    const ac = new AbortController();
    mockFetch.mockImplementation(async () => {
      ac.abort();
      // A still-pending request that must see the abort.
      return new Promise(() => {});
    });
    await expect(
      callLLMWithTools(SYSTEM, MESSAGES, [TEST_TOOL], { model: "ollama/litt-builder:8k", signal: ac.signal }),
    ).rejects.toBeTruthy();
  });
});
