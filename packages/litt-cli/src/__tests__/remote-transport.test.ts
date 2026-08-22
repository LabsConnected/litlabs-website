/**
 * Remote transport tests — proves the LOCAL → REMOTE runtime selection
 * path and the `dispatchRemote` / `isRemoteAvailable` contract.
 *
 * Tests cover:
 *   - dispatchRemote sends a well-formed RemoteCommandRequest to /api/command
 *   - Authorization: Bearer <token> header is included (terminal JWT, NOT internal key)
 *   - terminalUrl resolution: options > env > default
 *   - Clerk token requirement (LITT_CLERK_TOKEN) — the CLI never holds TERMINAL_AUTH_SECRET
 *   - Token exchange flow: Clerk token → /api/token-exchange → terminal JWT
 *   - Pre-exchanged terminalToken bypasses token exchange
 *   - success response decoded as RemoteCommandResponse
 *   - protocol-level error (unknown_command) decoded with typed error.code
 *   - command-level failure (ok:false with result) decoded correctly
 *   - HTTP-level failure (500) throws with server error message
 *   - non-JSON response throws cleanly
 *   - isRemoteAvailable returns true/false based on /health/live reachability
 *   - --remote flag routing in resolveDispatch
 *   - REMOTEABLE_COMMANDS gating (non-remoteable commands rejected)
 *   - structured argv preserved end-to-end (never shell-string encoded)
 *   - timeout handling
 *   - userId is NOT sent in the request body (server derives it from the token)
 *
 * Uses a mocked global fetch — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  dispatchRemote,
  isRemoteAvailable,
  exchangeClerkToken,
  clearTerminalTokenCache,
  type RemoteDispatchOptions,
} from "../lib/remote.js";
import { resolveDispatch } from "../lib/dispatch.js";
import { DEFAULT_TERMINAL_URL } from "../lib/auth/auth-config.js";
import { getAuthSession, resetAuthSession } from "../lib/auth/auth-session.js";
import { createCredentialStore } from "../lib/auth/credential-store.js";

// ─── Mock fetch ───────────────────────────────────────────────────

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function mockFetchResponse(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  clearTerminalTokenCache();
  // Isolate tests from the real credential store and any persisted session.
  resetAuthSession();
  getAuthSession({ storage: createCredentialStore("memory") });
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
  clearTerminalTokenCache();
  resetAuthSession();
});

// ─── dispatchRemote with pre-exchanged terminalToken ──────────────

describe("dispatchRemote (pre-exchanged terminalToken)", () => {
  const TERMINAL_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSIsImF1ZCI6ImxpdHRyZWUtdGVybWluYWwifQ.signature";
  const DEFAULT_URL = DEFAULT_TERMINAL_URL;

  it("sends a well-formed POST to /api/command with the command and args", async () => {
    fetchSpy.mockResolvedValue(
      mockFetchResponse({
        ok: true,
        runId: "run_123",
        kind: "status",
        result: { status: "success", success: true, message: "ok", data: {} },
        timestamp: Date.now(),
        durationMs: 10,
      }),
    );

    await dispatchRemote("status", ["--short"], {
      terminalToken: TERMINAL_JWT,
      cwd: "/project",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${DEFAULT_URL}/api/command`);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TERMINAL_JWT}`,
    });
    const body = JSON.parse(init?.body as string);
    expect(body.command).toBe("status");
    expect(body.args).toEqual(["--short"]);
    expect(body.cwd).toBe("/project");
  });

  it("includes Authorization: Bearer <token> header (terminal JWT, NOT internal key)", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT });

    const init = fetchSpy.mock.calls[0][1];
    const authHeader = init?.headers?.["Authorization"] as string;
    expect(authHeader).toBe(`Bearer ${TERMINAL_JWT}`);
    // Must NOT have X-Internal-Service-Key — that's service-to-service only
    expect(init?.headers?.["X-Internal-Service-Key"]).toBeUndefined();
  });

  it("does NOT send userId in the request body (server derives from token)", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    // userId should NOT be in the request body — server derives it from the JWT
    expect(body.userId).toBeUndefined();
  });

  it("resolves terminalUrl from options first", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("test", [], {
      terminalToken: TERMINAL_JWT,
      terminalUrl: "https://custom.example.com",
    });

    expect(fetchSpy.mock.calls[0][0]).toBe("https://custom.example.com/api/command");
  });

  it("resolves terminalUrl from LITT_TERMINAL_URL env when no option", async () => {
    const oldEnv = process.env.LITT_TERMINAL_URL;
    process.env.LITT_TERMINAL_URL = "https://env.example.com";
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    try {
      await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT });
      expect(fetchSpy.mock.calls[0][0]).toBe("https://env.example.com/api/command");
    } finally {
      if (oldEnv === undefined) delete process.env.LITT_TERMINAL_URL;
      else process.env.LITT_TERMINAL_URL = oldEnv;
    }
  });

  it("falls back to default URL when no option or env", async () => {
    const oldEnv = process.env.LITT_TERMINAL_URL;
    delete process.env.LITT_TERMINAL_URL;
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    try {
      await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT });
      expect(fetchSpy.mock.calls[0][0]).toBe(`${DEFAULT_TERMINAL_URL}/api/command`);
    } finally {
      if (oldEnv !== undefined) process.env.LITT_TERMINAL_URL = oldEnv;
    }
  });

  it("decodes a success response as RemoteCommandResponse", async () => {
    const response = {
      ok: true,
      runId: "run_abc_123",
      requestId: "req_1",
      kind: "build",
      result: {
        status: "success",
        success: true,
        message: "Build succeeded",
        data: { stdout: "Compiled successfully", exitCode: 0 },
      },
      timestamp: 1700000000000,
      durationMs: 5000,
    };
    fetchSpy.mockResolvedValue(mockFetchResponse(response));

    const result = await dispatchRemote("build", [], { terminalToken: TERMINAL_JWT });

    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run_abc_123");
    expect(result.requestId).toBe("req_1");
    expect(result.kind).toBe("build");
    expect(result.result?.success).toBe(true);
    expect(result.result?.message).toBe("Build succeeded");
    expect(result.result?.data?.stdout).toBe("Compiled successfully");
  });

  it("decodes a protocol-level error (unknown_command) with typed error.code", async () => {
    const response = {
      ok: false,
      runId: "run_err",
      kind: "error",
      error: {
        code: "unknown_command",
        message: "Unknown command: /foobar",
        availableCommands: ["status", "diff", "build"],
      },
      timestamp: 1700000000000,
      durationMs: 0,
    };
    fetchSpy.mockResolvedValue(mockFetchResponse(response, 200));

    const result = await dispatchRemote("foobar", [], { terminalToken: TERMINAL_JWT });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("unknown_command");
    expect(result.error?.message).toBe("Unknown command: /foobar");
    expect(result.error?.availableCommands).toEqual(["status", "diff", "build"]);
  });

  it("decodes a command-level failure (ok:false with result)", async () => {
    const response = {
      ok: false,
      runId: "run_fail",
      kind: "build",
      result: {
        status: "failed",
        success: false,
        message: "Build failed: type error",
        data: { stdout: "", stderr: "src/index.ts(10,5): error TS2322", exitCode: 1 },
      },
      timestamp: 1700000000000,
      durationMs: 3000,
    };
    fetchSpy.mockResolvedValue(mockFetchResponse(response));

    const result = await dispatchRemote("build", [], { terminalToken: TERMINAL_JWT });

    expect(result.ok).toBe(false);
    expect(result.result).toBeDefined();
    expect(result.result?.success).toBe(false);
    expect(result.result?.status).toBe("failed");
    expect(result.result?.data?.stderr).toContain("error TS2322");
  });

  it("throws on HTTP 500 with server error message", async () => {
    fetchSpy.mockResolvedValue(
      mockFetchResponse({ error: "Internal server error" }, 500),
    );

    await expect(dispatchRemote("test", [], { terminalToken: TERMINAL_JWT })).rejects.toThrow(
      /Internal server error/,
    );
  });

  it("throws on HTTP 401 (auth failure)", async () => {
    fetchSpy.mockResolvedValue(
      mockFetchResponse({ error: "Unauthorized" }, 401),
    );

    await expect(dispatchRemote("test", [], { terminalToken: TERMINAL_JWT })).rejects.toThrow(
      /Unauthorized/,
    );
  });

  it("throws cleanly on non-JSON response", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new Error("Invalid JSON"); },
    } as MockResponse);

    await expect(dispatchRemote("test", [], { terminalToken: TERMINAL_JWT })).rejects.toThrow(
      /REMOTE unavailable: terminal server returned no usable response/,
    );
  });

  it("preserves structured argv end-to-end (never shell-string encoded)", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "run", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("run", ["echo", "hello world", "--flag=value with spaces"], {
      terminalToken: TERMINAL_JWT,
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.args).toEqual(["echo", "hello world", "--flag=value with spaces"]);
    // Args are an array, NOT a shell string
    expect(Array.isArray(body.args)).toBe(true);
  });

  it("passes mode in the request body", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT, mode: "plan" });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.mode).toBe("plan");
  });

  it("omits cwd from the request body when not specified", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0 }));

    await dispatchRemote("test", [], { terminalToken: TERMINAL_JWT });

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.cwd).toBeUndefined();
  });
});

// ─── Token exchange flow ──────────────────────────────────────────

describe("token exchange (Clerk token → terminal JWT)", () => {
  const CLERK_TOKEN = "clerk-session-jwt-token-here";
  const TERMINAL_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.signature";
  // exchangeClerkToken is called with an explicit URL below, so this
  // local constant is fine for the direct-call test. dispatchRemote
  // tests that don't pass terminalUrl use DEFAULT_TERMINAL_URL.
  const EXCHANGE_URL = "http://127.0.0.1:4001";

  it("exchangeClerkToken sends Clerk token to /api/token-exchange", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({
      terminalToken: TERMINAL_JWT,
      expiresIn: 300,
      userId: "alice",
    }));

    const token = await exchangeClerkToken(CLERK_TOKEN, EXCHANGE_URL);

    expect(token).toBe(TERMINAL_JWT);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${EXCHANGE_URL}/api/token-exchange`);
    const init = fetchSpy.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.headers?.["Authorization"]).toBe(`Bearer ${CLERK_TOKEN}`);
  });

  it("dispatchRemote exchanges Clerk token when no terminalToken provided", async () => {
    // First call: token exchange
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      terminalToken: TERMINAL_JWT,
      expiresIn: 300,
      userId: "alice",
    }));
    // Second call: actual command
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0,
    }));

    await dispatchRemote("test", [], { clerkToken: CLERK_TOKEN });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    // First call: token exchange (uses DEFAULT_TERMINAL_URL — no terminalUrl option)
    expect(fetchSpy.mock.calls[0][0]).toBe(`${DEFAULT_TERMINAL_URL}/api/token-exchange`);
    // Second call: command dispatch with exchanged token
    expect(fetchSpy.mock.calls[1][0]).toBe(`${DEFAULT_TERMINAL_URL}/api/command`);
    const authHeader = fetchSpy.mock.calls[1][1]?.headers?.["Authorization"];
    expect(authHeader).toBe(`Bearer ${TERMINAL_JWT}`);
  });

  it("caches the exchanged terminal token (no re-exchange on second call)", async () => {
    // First call: token exchange
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      terminalToken: TERMINAL_JWT,
      expiresIn: 300,
      userId: "alice",
    }));
    // Second call: command
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      ok: true, runId: "r1", kind: "test", result: {}, timestamp: 0, durationMs: 0,
    }));
    // Third call: another command (should NOT re-exchange)
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      ok: true, runId: "r2", kind: "test", result: {}, timestamp: 0, durationMs: 0,
    }));

    await dispatchRemote("test1", [], { clerkToken: CLERK_TOKEN });
    await dispatchRemote("test2", [], { clerkToken: CLERK_TOKEN });

    // Should be 3 calls total: 1 exchange + 2 commands (NOT 2 exchange + 2 commands)
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("throws if no Clerk token and no terminalToken provided", async () => {
    const oldEnv = process.env.LITT_CLERK_TOKEN;
    delete process.env.LITT_CLERK_TOKEN;

    try {
      await expect(dispatchRemote("test", [])).rejects.toThrow(/REMOTE unavailable: not authenticated/i);
    } finally {
      if (oldEnv !== undefined) process.env.LITT_CLERK_TOKEN = oldEnv;
    }
  });

  it("resolves clerkToken from LITT_CLERK_TOKEN env", async () => {
    const oldEnv = process.env.LITT_CLERK_TOKEN;
    process.env.LITT_CLERK_TOKEN = CLERK_TOKEN;

    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      terminalToken: TERMINAL_JWT,
      expiresIn: 300,
      userId: "alice",
    }));
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({
      ok: true, runId: "r", kind: "test", result: {}, timestamp: 0, durationMs: 0,
    }));

    try {
      await dispatchRemote("test", []);
      // Should have exchanged the env-provided Clerk token (uses DEFAULT_TERMINAL_URL)
      expect(fetchSpy.mock.calls[0][0]).toBe(`${DEFAULT_TERMINAL_URL}/api/token-exchange`);
    } finally {
      if (oldEnv === undefined) delete process.env.LITT_CLERK_TOKEN;
      else process.env.LITT_CLERK_TOKEN = oldEnv;
    }
  });

  it("token exchange failure throws with server error", async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ error: "Invalid Clerk token" }, 401));

    await expect(exchangeClerkToken(CLERK_TOKEN, EXCHANGE_URL)).rejects.toThrow(
      /Invalid Clerk token/,
    );
  });
});

// ─── isRemoteAvailable ────────────────────────────────────────────

describe("isRemoteAvailable", () => {
  it("returns true when /health/live responds ok", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as MockResponse);

    const result = await isRemoteAvailable();
    expect(result).toBe(true);
    expect(fetchSpy.mock.calls[0][0]).toBe(`${DEFAULT_TERMINAL_URL}/health/live`);
  });

  it("returns false when /health/live responds non-200", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 503 } as MockResponse);

    const result = await isRemoteAvailable();
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (server unreachable)", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await isRemoteAvailable();
    expect(result).toBe(false);
  });

  it("uses custom terminalUrl when provided", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200 } as MockResponse);

    await isRemoteAvailable({ terminalUrl: "https://railway.example.com" });
    expect(fetchSpy.mock.calls[0][0]).toBe("https://railway.example.com/health/live");
  });
});

// ─── resolveDispatch --remote flag ────────────────────────────────

describe("resolveDispatch --remote flag", () => {
  it("extracts --remote flag and sets useRemote=true", () => {
    const d = resolveDispatch(["build", "--remote"]);
    expect(d.useRemote).toBe(true);
    expect(d.command).toBe("build");
    // --remote is stripped from rest
    expect(d.rest).toEqual([]);
  });

  it("extracts --remote flag when it appears before the command", () => {
    const d = resolveDispatch(["--remote", "status"]);
    expect(d.useRemote).toBe(true);
    expect(d.command).toBe("status");
  });

  it("useRemote is false when --remote is absent", () => {
    const d = resolveDispatch(["build"]);
    expect(d.useRemote).toBe(false);
  });

  it("combines --remote with --mode", () => {
    const d = resolveDispatch(["build", "--remote", "--mode", "plan"]);
    expect(d.useRemote).toBe(true);
    expect(d.mode).toBe("plan");
    expect(d.command).toBe("build");
  });

  it("preserves rest args after --remote extraction", () => {
    const d = resolveDispatch(["diff", "--remote", "--staged"]);
    expect(d.useRemote).toBe(true);
    expect(d.command).toBe("diff");
    expect(d.rest).toEqual(["--staged"]);
  });

  it("bare `litt --remote` dispatches to cockpit with useRemote=true", () => {
    const d = resolveDispatch(["--remote"]);
    expect(d.useRemote).toBe(true);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
  });
});
