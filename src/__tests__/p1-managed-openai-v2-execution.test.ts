/**
 * P1: Managed OpenAI v2 — EXECUTION-level failover proof.
 *
 * p1-managed-openai-v2.test.ts covers the route PLAN (ordering, entitlement
 * gating, cost metadata). This file proves the plan actually EXECUTES: with
 * the free providers failing, an entitled callLLMWithTools() really reaches
 * api.openai.com using LiTT's platform credential, while a free call under
 * the identical failures never touches OpenAI at all.
 *
 * Deterministic and hermetic:
 *   - `fetch` is stubbed; no real network call is ever made.
 *   - free providers are taken out of service through the real, process-local
 *     circuit breaker (recordProviderFailure), never by disabling production.
 *   - the managed-OpenAI route is left healthy so the run has somewhere to go.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/evals/braintrust", () => ({ logLLMCall: vi.fn() }));
vi.mock("@/lib/siteConfig", () => ({ SITE_URL: "https://test.example.com" }));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  callLLMWithTools,
  AllRoutesFailedError,
} from "@/lib/litt-intelligence/llm-tool-calling";
import {
  _resetProviderHealthForTests,
  recordProviderFailure,
} from "@/lib/litt-intelligence/provider-registry";
import { _resetModelRegistryForTests } from "@/lib/litt-intelligence/model-registry";

const PLATFORM_KEY = "sk-platform-managed-openai";
const USER_KEY = "sk-user-supplied-byok";

/** A well-formed OpenAI-compatible tool-calling response. */
function openAiCompatibleResponse(model = "gpt-4o") {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({
      model,
      choices: [
        {
          message: {
            content: "done",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "files_read", arguments: "{}" },
              },
            ],
          },
          finish_reason: "stop",
        },
      ],
    }),
    text: async () => "",
  };
}

const TOOLS = [
  {
    id: "files.read",
    description: "Read a file",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
];

const MESSAGES = [{ role: "user" as const, content: "build me a page" }];

/**
 * Take every free provider out of service the way a real outage would: an
 * auth failure disables a provider outright in the process-local breaker.
 * Gemini is already excluded by GEMINI_DISABLED=true.
 */
function freeProvidersDown() {
  vi.stubEnv("GEMINI_DISABLED", "true");
  recordProviderFailure("openrouter", {
    class: "auth_invalid",
    scope: "provider",
    message: "simulated outage",
  });
  recordProviderFailure("groq", {
    class: "auth_invalid",
    scope: "provider",
    message: "simulated outage",
  });
}

const urlsOf = () => mockFetch.mock.calls.map(([url]) => String(url));
const authOf = (call: unknown[]) =>
  (call[1] as { headers: Record<string, string> }).headers.Authorization;

beforeEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  mockFetch.mockReset();
  vi.stubEnv("GEMINI_API_KEY", "x");
  vi.stubEnv("OPENROUTER_API_KEY", "x");
  vi.stubEnv("GROQ_API_KEY", "x");
  vi.stubEnv("OPENAI_API_KEY", PLATFORM_KEY);
  vi.stubEnv("LITT_DISABLE_OLLAMA", "1");
  vi.stubEnv("GEMINI_DISABLED", "true");
});

afterEach(() => {
  _resetProviderHealthForTests();
  _resetModelRegistryForTests();
  vi.unstubAllEnvs();
});

describe("P1: managed OpenAI — execution-level failover", () => {
  it("an entitled run actually attempts managed OpenAI and succeeds", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    const result = await callLLMWithTools("sys", MESSAGES, TOOLS, {
      allowLittPaidProviders: true,
    });

    // The attempt really happened, and OpenAI served it.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
  });

  it("the OpenAI attempt uses the platform credential and the OpenAI adapter", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    await callLLMWithTools("sys", MESSAGES, TOOLS, { allowLittPaidProviders: true });

    const [url, init] = mockFetch.mock.calls[0];
    // OpenAI's own API endpoint, not a look-alike.
    expect(String(url)).toContain("api.openai.com");
    // LiTT's platform credential — never the user's key.
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers.Authorization).toBe(`Bearer ${PLATFORM_KEY}`);
    // The user key is nowhere in the request.
    expect(JSON.stringify(headers)).not.toContain(USER_KEY);
  });

  it("the OpenAI attempt sends tool definitions (real agentic request)", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    await callLLMWithTools("sys", MESSAGES, TOOLS, { allowLittPaidProviders: true });

    const body = JSON.parse(
      (mockFetch.mock.calls[0][1] as { body: string }).body,
    ) as { model: string; tools?: unknown[]; tool_choice?: string };
    expect(body.model).toBe("gpt-4o");
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools!.length).toBeGreaterThan(0);
  });

  it("a FREE user under identical failures never invokes OpenAI", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    // No entitlement: no permitted route remains. The call must fail
    // truthfully rather than quietly spending platform money.
    await expect(
      callLLMWithTools("sys", MESSAGES, TOOLS, {}),
    ).rejects.toThrow(AllRoutesFailedError);

    // No request was made at all — OpenAI specifically was never contacted.
    expect(mockFetch).not.toHaveBeenCalled();
    expect(urlsOf().some((u) => u.includes("api.openai.com"))).toBe(false);
  });

  it("explicitly denying entitlement behaves exactly like omitting it", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    await expect(
      callLLMWithTools("sys", MESSAGES, TOOLS, { allowLittPaidProviders: false }),
    ).rejects.toThrow(AllRoutesFailedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("managed OpenAI is NOT contacted while the free routes are healthy", async () => {
    // Entitlement present and Gemini disabled, but nothing is failing: the
    // free routes serve the run, so no platform spend occurs.
    vi.stubEnv("GEMINI_DISABLED", "true");
    _resetProviderHealthForTests();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    await callLLMWithTools("sys", MESSAGES, TOOLS, { allowLittPaidProviders: true });

    const urls = urlsOf();
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes("api.openai.com"))).toBe(false);
  });

  it("a BYOK route uses the user's key, never the platform credential", async () => {
    freeProvidersDown();
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    // BYOK is planned ahead of the managed route and bills the user directly.
    const result = await callLLMWithTools("sys", MESSAGES, TOOLS, {
      allowLittPaidProviders: true,
      userApiKey: USER_KEY,
      byokProvider: "openai",
    });

    expect(result.provider).toBe("byok");
    expect(authOf(mockFetch.mock.calls[0])).toBe(`Bearer ${USER_KEY}`);
  });

  it("the managed route never borrows the user's key even when one is present", async () => {
    // Free routes AND BYOK are down, so the managed route must serve — with
    // the platform credential.
    freeProvidersDown();
    recordProviderFailure("byok", {
      class: "auth_invalid",
      scope: "provider",
      message: "simulated outage",
    });
    mockFetch.mockResolvedValue(openAiCompatibleResponse());

    const result = await callLLMWithTools("sys", MESSAGES, TOOLS, {
      allowLittPaidProviders: true,
      userApiKey: USER_KEY,
      byokProvider: "openai",
    });

    expect(result.provider).toBe("openai");
    const openaiCalls = mockFetch.mock.calls.filter(([url]) =>
      String(url).includes("api.openai.com"),
    );
    expect(openaiCalls.length).toBeGreaterThan(0);
    for (const call of openaiCalls) {
      expect(authOf(call)).toBe(`Bearer ${PLATFORM_KEY}`);
      expect(authOf(call)).not.toBe(`Bearer ${USER_KEY}`);
    }
  });
});
