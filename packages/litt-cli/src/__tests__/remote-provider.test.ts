/**
 * RemoteModelProvider tests — proves a clean machine with NO provider
 * env vars can get inference via the remote server path.
 *
 * Covers:
 *   - RemoteModelProvider.stream() sends POST /api/inference with
 *     the terminal JWT (NOT any provider key)
 *   - SSE events (meta/delta/done/complete) are parsed into
 *     ModelStreamEvent emissions
 *   - 402 entitlement failure surfaces a clean error (not an API-key error)
 *   - 401 auth failure surfaces a clean re-login message
 *   - The server's OPENROUTER_API_KEY never appears in any request
 *   - isRemoteInferenceAvailable returns true when signed in + server up
 *   - isRemoteInferenceAvailable returns false when not signed in
 *
 * Uses a mocked global fetch — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteModelProvider, isRemoteInferenceAvailable } from "../lib/remote-model-provider.js";
import { resolveProviderAdapterAsync, canUseAnyProvider } from "../lib/model-provider.js";
import { DEFAULT_TERMINAL_URL } from "../lib/auth/auth-config.js";
import { getAuthSession, resetAuthSession } from "../lib/auth/auth-session.js";
import { createCredentialStore } from "../lib/auth/credential-store.js";
import { clearTerminalTokenCache } from "../lib/remote.js";
import type { RoutedModel } from "../lib/model-runtime.js";

// ─── Mock fetch ───────────────────────────────────────────────────

const TERMINAL_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSIsImF1ZCI6ImxpdHRyZWUtdGVybWluYWwifQ.signature";
const SERVER_OPENROUTER_KEY = "sk-or-v1-SERVER_SECRET_THAT_MUST_NEVER_LEAK";

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  clearTerminalTokenCache();
  resetAuthSession();
  // Use memory credential store — no keychain access
  getAuthSession({ storage: createCredentialStore("memory") });
  // Ensure NO provider env vars are set (clean machine)
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.LITT_LOCAL_MODE;
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
  clearTerminalTokenCache();
  resetAuthSession();
  delete process.env.LITT_LOCAL_MODE;
});

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Build a mock SSE response body from a sequence of events.
 * Returns a ReadableStream that the fetch mock can return.
 */
function mockSSEResponse(
  events: Array<{ event: string; data: unknown }>,
  status = 200,
): Response {
  const chunks = events.map((e) =>
    `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`,
  );
  const fullText = chunks.join("");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(fullText));
      controller.close();
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    json: async () => ({}),
    text: async () => "",
  } as Response;
}

function mockJSONResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: null,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("RemoteModelProvider", () => {
  it("sends POST /api/inference with the terminal JWT, not a provider key", async () => {
    fetchSpy.mockResolvedValue(
      mockSSEResponse([
        { event: "meta", data: { provider: "openrouter", model: "anthropic/claude-sonnet-5", profile: "smart" } },
        { event: "delta", data: { text: "Hello" } },
        { event: "done", data: { model: "anthropic/claude-sonnet-5", usage: { total_tokens: 10 }, timing: { ttftMs: 100, generationMs: 200, totalMs: 300 } } },
        { event: "complete", data: { runId: "run_1", content: "Hello", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
      ]),
    );

    const provider = new RemoteModelProvider({
      terminalToken: undefined,
      cwd: "/project",
      mode: "act",
    });

    // Mock the auth session to return our terminal JWT
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const events: Array<{ type: string; text?: string }> = [];
    const result = await provider.stream(
      [{ role: "user", content: "hi" }],
      (e) => events.push(e as { type: string; text?: string }),
    );

    // Verify the request
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${DEFAULT_TERMINAL_URL}/api/inference`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Authorization": `Bearer ${TERMINAL_JWT}`,
      "Accept": "text/event-stream",
    });

    // Verify NO provider key is in the request
    const bodyStr = JSON.stringify(init);
    expect(bodyStr).not.toContain("OPENROUTER_API_KEY");
    expect(bodyStr).not.toContain("sk-or-v1");
    expect(bodyStr).not.toContain(SERVER_OPENROUTER_KEY);

    // Verify events were emitted
    expect(events.some((e) => e.type === "meta")).toBe(true);
    expect(events.some((e) => e.type === "delta" && e.text === "Hello")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // Verify the result
    expect(result.content).toBe("Hello");
    expect(result.model).toBe("anthropic/claude-sonnet-5");
    expect(result.provider).toBe("openrouter");
  });

  it("surfaces 402 entitlement failure as a clean error, not an API-key error", async () => {
    fetchSpy.mockResolvedValue(
      mockJSONResponse(
        { error: "Out of LiTBit coins (balance: 0). Earn more at https://litlabs.net/wallet", code: "insufficient_credits", plan: "free", coinBalance: 0 },
        402,
      ),
    );

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const events: Array<{ type: string; message?: string }> = [];
    await expect(
      provider.stream(
        [{ role: "user", content: "hi" }],
        (e) => events.push(e as { type: string; message?: string }),
      ),
    ).rejects.toThrow("Out of LiTBit coins");

    // Verify an error event was emitted with the clean message
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toContain("Out of LiTBit coins");
    // Must NOT mention API keys
    expect(errorEvent?.message).not.toContain("OPENROUTER_API_KEY");
    expect(errorEvent?.message).not.toContain("sk-or-v1");
  });

  it("surfaces 401 auth failure with a re-login message", async () => {
    fetchSpy.mockResolvedValue(mockJSONResponse({ error: "Unauthorized" }, 401));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const events: Array<{ type: string; message?: string }> = [];
    await expect(
      provider.stream(
        [{ role: "user", content: "hi" }],
        (e) => events.push(e as { type: string; message?: string }),
      ),
    ).rejects.toThrow("Authentication expired");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.message).toContain("litt login");
  });

  it("throws if not authenticated (no terminal token)", async () => {
    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(null);

    await expect(
      provider.stream([{ role: "user", content: "hi" }], () => {}),
    ).rejects.toThrow("Not authenticated");
  });

  it("accumulates delta text into the final content", async () => {
    fetchSpy.mockResolvedValue(
      mockSSEResponse([
        { event: "meta", data: { provider: "openrouter", model: "test-model", profile: "auto" } },
        { event: "delta", data: { text: "Hello " } },
        { event: "delta", data: { text: "world" } },
        { event: "delta", data: { text: "!" } },
        { event: "done", data: { model: "test-model", usage: { total_tokens: 5 }, timing: { ttftMs: 50, generationMs: 100, totalMs: 150 } } },
        { event: "complete", data: { runId: "run_2", content: "Hello world!", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 1 } },
      ]),
    );

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const result = await provider.stream(
      [{ role: "user", content: "say hello" }],
      () => {},
    );

    expect(result.content).toBe("Hello world!");
    expect(result.usage.total_tokens).toBe(5);
  });
});

describe("isRemoteInferenceAvailable", () => {
  it("returns false when not signed in", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(false);

    const result = await isRemoteInferenceAvailable();
    expect(result).toBe(false);
  });

  it("returns false when signed in but server unreachable", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await isRemoteInferenceAvailable();
    expect(result).toBe(false);
  });

  it("returns true when signed in and server reachable", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await isRemoteInferenceAvailable();
    expect(result).toBe(true);
  });
});

// ─── Priority order tests ──────────────────────────────────────────
// Remote is the DEFAULT for signed-in users. An accidental env var
// must NOT bypass BITS/subscription. Local BYOK requires explicit
// opt-in via LITT_LOCAL_MODE=1.

const MOCK_ROUTED: RoutedModel = {
  id: "claude-sonnet-5",
  label: "Claude Sonnet 5",
  servedBy: "openrouter" as never,
  reason: "auto",
  fallbackReason: null,
  appliedPolicy: "auto",
  openRouterModelId: "anthropic/claude-sonnet-5",
  providerModelId: undefined,
};

describe("resolveProviderAdapterAsync priority order", () => {
  beforeEach(() => {
    // Clean slate for each priority test
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LITT_LOCAL_MODE;
  });

  it("uses REMOTE when signed in, even if OPENROUTER_API_KEY is set (no silent bypass)", async () => {
    // Simulate an accidental env var from another project
    process.env.OPENROUTER_API_KEY = "sk-or-v1-accidental-key";
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const provider = await resolveProviderAdapterAsync(MOCK_ROUTED, {
      cwd: "/project",
      mode: "act",
    });

    // Must be RemoteModelProvider, NOT OpenRouterModelProvider
    expect(provider).toBeInstanceOf(RemoteModelProvider);
    expect(provider.providerId).toBe("remote");
  });

  it("uses LOCAL when LITT_LOCAL_MODE=1 is set, even if signed in", async () => {
    process.env.LITT_LOCAL_MODE = "1";
    process.env.OPENROUTER_API_KEY = "sk-or-v1-byok-key";
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const provider = await resolveProviderAdapterAsync(MOCK_ROUTED, {
      cwd: "/project",
      mode: "act",
    });

    // Must be local OpenRouter, NOT remote — explicit BYOK opt-out
    expect(provider).not.toBeInstanceOf(RemoteModelProvider);
    expect(provider.providerId).toBe("openrouter");
  });

  it("uses LOCAL when not signed in but has OPENROUTER_API_KEY", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-dev-key";
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(false);

    const provider = await resolveProviderAdapterAsync(MOCK_ROUTED, {
      cwd: "/project",
      mode: "act",
    });

    // Not signed in → local developer path
    expect(provider).not.toBeInstanceOf(RemoteModelProvider);
    expect(provider.providerId).toBe("openrouter");
  });

  it("uses REMOTE when signed in and no local key (clean machine)", async () => {
    // No env vars, signed in — the production customer path
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    const provider = await resolveProviderAdapterAsync(MOCK_ROUTED, {
      cwd: "/project",
      mode: "act",
    });

    expect(provider).toBeInstanceOf(RemoteModelProvider);
  });

  it("throws when not signed in and no local key", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(false);

    await expect(
      resolveProviderAdapterAsync(MOCK_ROUTED, { cwd: "/project" }),
    ).rejects.toThrow();
  });

  it("throws with LITT_LOCAL_MODE message when local key missing", async () => {
    process.env.LITT_LOCAL_MODE = "1";
    // No OPENROUTER_API_KEY set
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(
      resolveProviderAdapterAsync(MOCK_ROUTED, { cwd: "/project" }),
    ).rejects.toThrow("LITT_LOCAL_MODE=1 is set but");
  });
});

describe("canUseAnyProvider priority", () => {
  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LITT_LOCAL_MODE;
  });

  it("returns true when signed in (remote path available)", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(true);
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as Response);

    expect(await canUseAnyProvider()).toBe(true);
  });

  it("returns true when not signed in but has local key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-dev";
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(false);

    expect(await canUseAnyProvider()).toBe(true);
  });

  it("returns false when not signed in and no local key", async () => {
    const session = getAuthSession();
    vi.spyOn(session, "isSignedIn").mockResolvedValue(false);

    expect(await canUseAnyProvider()).toBe(false);
  });
});
