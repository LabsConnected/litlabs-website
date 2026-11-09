// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTerminalTokenResult,
  clearTerminalTokenCache,
  TerminalDisabledError,
  WorkspaceNotReadyError,
} from "./terminal-client";

/**
 * Regression for the 2026-11-08 staging terminal failure: the token route
 * returns 403 TERMINAL_DISABLED while terminalRuntime is off, and the panel
 * mislabeled it "socket unavailable". These tests pin the client contract
 * the panel relies on: a disabled verdict is a TerminalDisabledError that is
 * cached for the session (no re-hammering) until the cache is cleared.
 */

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("getTerminalTokenResult", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    clearTerminalTokenCache();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("maps a 403 TERMINAL_DISABLED response to TerminalDisabledError", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(403, { code: "TERMINAL_DISABLED", error: "The terminal is not available yet." }),
    ) as unknown as typeof fetch;

    await expect(getTerminalTokenResult()).rejects.toBeInstanceOf(TerminalDisabledError);
    await expect(getTerminalTokenResult()).rejects.toThrow(/not available yet/);
  });

  it("caches the disabled verdict — a second call does not refetch", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(403, { code: "TERMINAL_DISABLED", error: "The terminal is not available yet." }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(getTerminalTokenResult()).rejects.toBeInstanceOf(TerminalDisabledError);
    await expect(getTerminalTokenResult()).rejects.toBeInstanceOf(TerminalDisabledError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forceRefresh bypasses the cached disabled verdict", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(403, { code: "TERMINAL_DISABLED", error: "off" })
        : jsonResponse(200, { token: "tok", expiresAt: Date.now() + 60_000, baseUrl: "https://t.example" });
    }) as unknown as typeof fetch;

    await expect(getTerminalTokenResult()).rejects.toBeInstanceOf(TerminalDisabledError);
    const result = await getTerminalTokenResult(true);
    expect(result.token).toBe("tok");
    expect(result.baseUrl).toBe("https://t.example");
    expect(calls).toBe(2);
  });

  it("maps a 409 WORKSPACE_NOT_READY response to WorkspaceNotReadyError", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(409, { code: "WORKSPACE_NOT_READY", error: "Prepare the project workspace first." }),
    ) as unknown as typeof fetch;

    await expect(getTerminalTokenResult(false, "proj-1")).rejects.toBeInstanceOf(WorkspaceNotReadyError);
  });

  it("returns token + baseUrl on success", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { token: "tok-1", expiresAt: Date.now() + 60_000, baseUrl: "wss://t.example" }),
    ) as unknown as typeof fetch;

    const result = await getTerminalTokenResult();
    expect(result.token).toBe("tok-1");
    expect(result.baseUrl).toBe("wss://t.example");
  });
});
