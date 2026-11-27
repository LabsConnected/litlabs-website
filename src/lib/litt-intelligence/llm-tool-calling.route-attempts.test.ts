// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetProviderHealthForTests } from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";
import {
  AllRoutesFailedError,
  sanitizeRouteAttempts,
  type RouteAttemptFailure,
} from "./llm-tool-calling";

/**
 * P0 R4 (execution integrity, audit D6) — the route-attempt observer.
 *
 * Before R4, the per-attempt failure list inside callLLMWithTools was
 * only logged on success and carried on the thrown error: nothing a
 * run persisted could say WHY its serving model changed. The
 * onRouteAttempts observer is the channel the agent loop uses to
 * persist those reasons. These tests pin its firing contract:
 *   - success after a failed attempt → fired with the attempts;
 *   - total failure → fired before the AllRoutesFailedError throws;
 *   - a clean first-attempt success → never fired.
 * Plus the sanitizer that shapes what may be persisted: provider,
 * model, failure class, HTTP status — never the raw upstream message.
 */

const PROVIDER_ENVS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "OPENAI_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_AI_API_TOKEN",
  "CLOUDFLARE_AI_MODEL",
  "CLOUDFLARE_TIMEOUT_MS",
  "OLLAMA_BASE_URL",
  "OLLAMA_HOST",
  "OLLAMA_HOST_PC",
  "LITT_OLLAMA_URL",
  "OLLAMA_MODEL",
  "LITT_DISABLE_OLLAMA",
  "OPENROUTER_MODEL",
];

const WRITE_TOOL = {
  id: "files.write",
  description: "Write a file to the project workspace.",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

function cloudflareSuccessBody() {
  return {
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "files_write",
                arguments: JSON.stringify({ path: "index.html", content: "ok" }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("callLLMWithTools — onRouteAttempts observer (P0 R4)", () => {
  beforeEach(() => {
    _resetProviderHealthForTests();
    _resetModelRegistryForTests();
    vi.unstubAllEnvs();
    for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
    // Cloudflare as the only eligible route for the failure/silence
    // tests (same forcing as the provider-fallback-timeout suite);
    // the failover test additionally enables OpenRouter.
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
    vi.stubEnv("CLOUDFLARE_AI_API_TOKEN", "test-token");
    vi.stubEnv("CLOUDFLARE_AI_MODEL", "@cf/mistralai/mistral-small-3.1-24b-instruct");
    vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    _resetProviderHealthForTests();
    _resetModelRegistryForTests();
    vi.unstubAllEnvs();
  });

  it("fires with the failed attempts when the call succeeds after a provider failover", async () => {
    // A second eligible provider (OpenRouter): whichever route the
    // planner tries first fails with a 500, the next one serves the
    // OpenAI-shaped success body. The observer must fire exactly once
    // — at the successful return — carrying the failed attempt.
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "upstream boom" } }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(cloudflareSuccessBody()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const observed: RouteAttemptFailure[][] = [];
    const { callLLMWithTools } = await import("./llm-tool-calling");
    const pending = callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "write the page" }],
      [WRITE_TOOL],
      { onRouteAttempts: (attempts) => observed.push(attempts) },
    );
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await pending;

    expect(result.toolCalls).toHaveLength(1);
    expect(observed).toHaveLength(1);
    expect(observed[0].length).toBeGreaterThanOrEqual(1);
    expect(observed[0][0]).toMatchObject({ class: "server_error", httpStatus: 500 });
  });

  it("fires before throwing when every route fails", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { message: "upstream boom" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const observed: RouteAttemptFailure[][] = [];
    const { callLLMWithTools } = await import("./llm-tool-calling");
    const pending = callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "write the page" }],
      [WRITE_TOOL],
      { onRouteAttempts: (attempts) => observed.push(attempts) },
    );
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).rejects.toBeInstanceOf(AllRoutesFailedError);
    expect(observed.length).toBeGreaterThanOrEqual(1);
    const attempts = observed[observed.length - 1];
    expect(attempts.length).toBeGreaterThanOrEqual(1);
    expect(attempts[0]).toMatchObject({
      provider: "cloudflare",
      class: "server_error",
      httpStatus: 500,
    });
  });

  it("never fires on a clean first-attempt success", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(cloudflareSuccessBody()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const observed: RouteAttemptFailure[][] = [];
    const { callLLMWithTools } = await import("./llm-tool-calling");
    const result = await callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "write the page" }],
      [WRITE_TOOL],
      { onRouteAttempts: (attempts) => observed.push(attempts) },
    );

    expect(result.provider).toBe("cloudflare");
    expect(observed).toHaveLength(0);
  });
});

describe("sanitizeRouteAttempts (P0 R4)", () => {
  it("keeps provider/model/class/status and drops the raw upstream message", () => {
    const sanitized = sanitizeRouteAttempts([
      {
        provider: "openrouter",
        model: "cohere/north-mini-code:free",
        class: "rate_limited",
        httpStatus: 429,
        latencyMs: 120,
        message: "upstream echoed the request: sk-should-never-persist",
      },
      {
        provider: "gemini",
        model: "gemini-2.5-flash",
        class: "timeout",
        latencyMs: 30_000,
        message: "timed out",
      },
    ]);
    expect(sanitized).toEqual([
      { provider: "openrouter", model: "cohere/north-mini-code:free", class: "rate_limited", httpStatus: 429 },
      { provider: "gemini", model: "gemini-2.5-flash", class: "timeout" },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain("sk-should-never-persist");
  });
});
