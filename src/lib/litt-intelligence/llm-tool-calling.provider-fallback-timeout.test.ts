// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetProviderHealthForTests,
} from "./provider-registry";
import { _resetModelRegistryForTests } from "./model-registry";

/**
 * Deterministic regression test for the live staging incident reproduced
 * 2026-11-18 (run 44408304139, acceptance step `post_build_follow_up_mutation`):
 *
 *   model_failed: "All tool-calling models failed. Attempts:
 *   cloudflare/@cf/mistralai/mistral-small-3.1-24b-instruct(timeout, 30002ms).
 *   Excluded: gemini(health_disabled:forbidden), openrouter(health_cooldown:rate_limited)..."
 *
 * With Gemini unavailable and OpenRouter rate-limited in the live incident,
 * Cloudflare Workers AI was the only eligible route. The old shared 30s
 * attempt cap aborted a long-context file-write call. These fake-timer tests
 * prove that a 35s response now succeeds and that the dedicated 120s attempt
 * cap still aborts a stalled request. */

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
                arguments: JSON.stringify({
                  path: "index.html",
                  content: "Golden Acceptance follow-up verified",
                }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe("callLLMWithTools — Cloudflare shared attempt-timeout boundary (live incident 2026-11-18, run 44408304139)", () => {
  beforeEach(() => {
    _resetProviderHealthForTests();
    _resetModelRegistryForTests();
    vi.unstubAllEnvs();
    for (const key of PROVIDER_ENVS) vi.stubEnv(key, "");
    // Force Cloudflare as the ONLY eligible route — mirrors the live
    // incident's exclusions (Gemini billing-forbidden, OpenRouter cooldown)
    // without needing to fabricate provider-health state directly.
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

  it("a Cloudflare response that completes just under the 30s shared cap succeeds", async () => {
    const fetchMock = vi.fn((url: unknown) => {
      expect(String(url)).toContain("/chat/completions");
      return new Promise((resolve) => {
        setTimeout(
          () =>
            resolve(
              new Response(JSON.stringify(cloudflareSuccessBody()), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            ),
          29_000,
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callLLMWithTools } = await import("./llm-tool-calling");
    const pending = callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "update the footer" }],
      [WRITE_TOOL],
    );

    await vi.advanceTimersByTimeAsync(29_000);
    const result = await pending;

    expect(result.provider).toBe("cloudflare");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("files.write");
  });

  it("accepts a 35s Cloudflare file-write response past the old 30s cap", async () => {
    const fetchMock = vi.fn((url: unknown) => {
      expect(String(url)).toContain("/chat/completions");
      return new Promise((resolve) => {
        setTimeout(
          () => resolve(new Response(JSON.stringify(cloudflareSuccessBody()), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })),
          35_000,
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callLLMWithTools } = await import("./llm-tool-calling");
    const pending = callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "update the footer" }],
      [WRITE_TOOL],
    );
    await vi.advanceTimersByTimeAsync(35_000);
    const result = await pending;

    expect(result.provider).toBe("cloudflare");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].toolId).toBe("files.write");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still enforces the dedicated 120s Cloudflare attempt cap", async () => {
    const fetchMock = vi.fn((url: unknown) => {
      expect(String(url)).toContain("/chat/completions");
      return new Promise(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const { callLLMWithTools } = await import("./llm-tool-calling");
    const pending = callLLMWithTools(
      "system prompt",
      [{ role: "user", content: "update the footer" }],
      [WRITE_TOOL],
    );
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(120_100);

    await expect(pending).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});