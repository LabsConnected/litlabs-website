/**
 * Workspace discovery regression tests.
 *
 * These cover the P0 failure where `litt workspace select` reported
 *
 *     Workspace list failed (404).
 *     Could not establish a remote session.
 *
 * against a fully authenticated account. Two distinct defects:
 *
 *   1. terminal-server never registered GET /api/workspaces, so every
 *      listing 404'd. (Fixed server-side in terminal-server/workspace-routes.ts.)
 *   2. The CLI collapsed every non-401/403 status into `session_failed`,
 *      so a missing route was reported as a session problem and the
 *      operator was told to retry — which could never work.
 *
 * Coverage:
 *   A. authenticated workspace list success
 *   B. empty workspace list
 *   C. 401 / 403 auth failures
 *   D. 404 stale/missing endpoint
 *   E. 5xx server failure
 *   F. workspace selection success
 *   G. switching between two workspaces
 *   H. persisted selection
 *   I. no cross-user workspace leakage from the client
 *
 * Uses mocked fetch — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The auth session is mocked so `workspaceCommand` runs its real path
// (signed-in → token → list → select → persist) without a keychain.
const mockIsSignedIn = vi.fn(async () => true);
const mockGetAccessToken = vi.fn(async () => "clerk-token-abc" as string | null);
vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({
    isSignedIn: mockIsSignedIn,
    getAccessToken: mockGetAccessToken,
  }),
}));

const {
  listRemoteWorkspaces,
  classifyHttpFailure,
  clearTerminalTokenCache,
} = await import("../lib/remote.js");
const { workspaceCommand, describeWorkspaceListFailure } = await import("../commands/workspace.js");
const { getSelectedRemoteWorkspace } = await import("../lib/remote-workspace-store.js");

// ─── fetch mocking ────────────────────────────────────────────────

const TERMINAL_JWT = "terminal.jwt.token";
const CLERK_TOKEN = "clerk-token-abc";

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function jsonResponse(body: unknown, status = 200): MockResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * Express answers an unregistered route with an HTML body, so
 * `response.json()` REJECTS. That rejection path is exactly what the
 * production 404 hit, so it must be modelled faithfully rather than as
 * a tidy JSON error.
 */
function htmlNotFoundResponse(): MockResponse {
  return {
    ok: false,
    status: 404,
    json: async () => {
      throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON");
    },
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

/** Queue: token exchange succeeds, then the given /api/workspaces reply. */
function stubListing(workspacesResponse: MockResponse): void {
  fetchSpy.mockResolvedValueOnce(
    jsonResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }) as never,
  );
  fetchSpy.mockResolvedValueOnce(workspacesResponse as never);
}

const WS_A = { workspaceId: "ws-a", projectId: "p-a", root: "/data/alice/site", branch: "main" };
const WS_B = { workspaceId: "ws-b", projectId: "p-b", root: "/data/alice/worker", branch: "dev" };

let tempDir: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  clearTerminalTokenCache();
  tempDir = mkdtempSync(join(tmpdir(), "litt-ws-discovery-"));
  process.env.LITT_REMOTE_WORKSPACE_FILE = join(tempDir, "remote-workspace.json");
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockIsSignedIn.mockResolvedValue(true);
  mockGetAccessToken.mockResolvedValue(CLERK_TOKEN);
});

afterEach(() => {
  fetchSpy.mockRestore();
  logSpy.mockRestore();
  errSpy.mockRestore();
  vi.restoreAllMocks();
  clearTerminalTokenCache();
  delete process.env.LITT_REMOTE_WORKSPACE_FILE;
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── A. Authenticated list success ────────────────────────────────

describe("A — authenticated workspace list", () => {
  it("returns every ready workspace the server reports", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));

    const result = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });

    expect(result).toEqual([WS_A, WS_B]);
  });

  it("calls GET /api/workspaces with the exchanged terminal JWT", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A] }));

    await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/api\/workspaces$/);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TERMINAL_JWT}`);
    // A GET listing — no method override, no body.
    expect(init.method ?? "GET").toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("drops a malformed record instead of failing the whole listing", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, { workspaceId: "ws-broken" }, WS_B] }));

    const result = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });

    expect(result.map((w) => w.workspaceId)).toEqual(["ws-a", "ws-b"]);
  });
});

// ─── B. Empty list ────────────────────────────────────────────────

describe("B — empty workspace list", () => {
  it("returns [] for { workspaces: [] } without throwing", async () => {
    stubListing(jsonResponse({ workspaces: [] }));
    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).resolves.toEqual([]);
  });

  it("`workspace select` exits 0 and does not persist anything", async () => {
    stubListing(jsonResponse({ workspaces: [] }));

    const code = await workspaceCommand(["select"]);

    expect(code).toBe(0);
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });
});

// ─── C / D / E. Failure classification ────────────────────────────

describe("classifyHttpFailure", () => {
  it("maps each status to its own category", () => {
    expect(classifyHttpFailure(401)).toBe("auth_revoked");
    expect(classifyHttpFailure(403)).toBe("forbidden");
    expect(classifyHttpFailure(404)).toBe("endpoint_missing");
    expect(classifyHttpFailure(500)).toBe("server_error");
    expect(classifyHttpFailure(502)).toBe("service_unavailable");
    expect(classifyHttpFailure(503)).toBe("service_unavailable");
  });

  it("never reports a non-auth status as an auth failure", () => {
    for (const status of [404, 500, 502, 503]) {
      expect(["auth_revoked", "auth_expired", "not_authenticated"]).not.toContain(
        classifyHttpFailure(status),
      );
    }
  });
});

describe("C — auth failures", () => {
  it("401 → auth_revoked", async () => {
    stubListing(jsonResponse({ error: "Unauthorized" }, 401));
    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "auth_revoked",
    });
  });

  it("403 → forbidden, and does NOT clear valid credentials", async () => {
    const { CREDENTIAL_CLEARING_REASONS } = await import("../lib/remote-unavailable.js");
    stubListing(jsonResponse({ error: "Forbidden" }, 403));

    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "forbidden",
    });
    expect(CREDENTIAL_CLEARING_REASONS.has("forbidden")).toBe(false);
  });
});

describe("D — 404 stale/missing endpoint", () => {
  it("maps the Express HTML 404 to endpoint_missing, not session_failed", async () => {
    stubListing(htmlNotFoundResponse());

    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "endpoint_missing",
    });
  });

  it("does not tell the operator the remote SESSION failed", async () => {
    stubListing(htmlNotFoundResponse());

    const error = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN }).catch((e) => e);

    // This is the exact string the P0 bug surfaced. It named the wrong
    // system and offered a remedy (retry) that could never succeed.
    expect(error.message).not.toContain("Could not establish a remote session");
    expect(error.message).toContain("404");
  });

  it("`workspace select` headlines the missing endpoint and exits 1", async () => {
    stubListing(htmlNotFoundResponse());

    const code = await workspaceCommand(["select"]);

    expect(code).toBe(1);
    // `fail()` prints to stdout and the remedy to stderr — the operator
    // sees both, so assert against the combined output.
    const printed = [...logSpy.mock.calls, ...errSpy.mock.calls].flat().join("\n");
    expect(printed).toContain("no workspace-listing endpoint");
    expect(printed).not.toContain("Could not establish a remote session");
  });

  it("does not clear credentials for a missing endpoint", async () => {
    const { CREDENTIAL_CLEARING_REASONS } = await import("../lib/remote-unavailable.js");
    expect(CREDENTIAL_CLEARING_REASONS.has("endpoint_missing")).toBe(false);
  });
});

describe("E — 5xx server failure", () => {
  it("500 → server_error", async () => {
    stubListing(jsonResponse({ error: "Workspace listing failed" }, 500));
    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "server_error",
    });
  });

  it("503 → service_unavailable", async () => {
    stubListing(jsonResponse({ error: "unavailable" }, 503));
    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "service_unavailable",
    });
  });

  it("a 500 is never reported as an empty workspace list", async () => {
    stubListing(jsonResponse({ error: "boom" }, 500));
    await expect(listRemoteWorkspaces({ clerkToken: CLERK_TOKEN })).rejects.toThrow();
  });
});

describe("describeWorkspaceListFailure", () => {
  it("gives each category its own headline and remedy", async () => {
    const { RemoteUnavailableError } = await import("../lib/remote-unavailable.js");
    const cases = ["endpoint_missing", "service_unavailable", "server_error", "auth_revoked", "forbidden"] as const;
    const headlines = cases.map(
      (reason) => describeWorkspaceListFailure(new RemoteUnavailableError(reason)).headline,
    );
    expect(new Set(headlines).size).toBe(cases.length);
    for (const reason of cases) {
      expect(describeWorkspaceListFailure(new RemoteUnavailableError(reason)).remedy).toBeTruthy();
    }
  });

  it("falls back to the raw message for a non-typed error", () => {
    const result = describeWorkspaceListFailure(new Error("socket hang up"));
    expect(result.headline).toContain("socket hang up");
  });
});

// ─── F / G / H. Selection, switching, persistence ─────────────────

describe("F — workspace selection success", () => {
  it("auto-selects and persists when exactly one workspace exists", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A] }));

    const code = await workspaceCommand(["select"]);

    expect(code).toBe(0);
    const saved = getSelectedRemoteWorkspace();
    expect(saved).toMatchObject({
      workspaceId: "ws-a",
      projectId: "p-a",
      root: "/data/alice/site",
      branch: "main",
    });
  });

  it("selects by workspace ID when several exist", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));

    const code = await workspaceCommand(["select", "ws-b"]);

    expect(code).toBe(0);
    expect(getSelectedRemoteWorkspace()?.workspaceId).toBe("ws-b");
  });

  it("selects by 1-based index", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));

    const code = await workspaceCommand(["select", "2"]);

    expect(code).toBe(0);
    expect(getSelectedRemoteWorkspace()?.workspaceId).toBe("ws-b");
  });

  it("rejects an unknown workspace without disturbing the current selection", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    await workspaceCommand(["select", "ws-a"]);
    clearTerminalTokenCache();

    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    const code = await workspaceCommand(["select", "ws-nonexistent"]);

    expect(code).toBe(1);
    expect(getSelectedRemoteWorkspace()?.workspaceId).toBe("ws-a");
  });
});

describe("G — switching between two workspaces", () => {
  it("a second select replaces the first", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    expect(await workspaceCommand(["select", "ws-a"])).toBe(0);
    expect(getSelectedRemoteWorkspace()?.workspaceId).toBe("ws-a");

    clearTerminalTokenCache();
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    expect(await workspaceCommand(["select", "ws-b"])).toBe(0);

    const saved = getSelectedRemoteWorkspace();
    expect(saved?.workspaceId).toBe("ws-b");
    // Every field switches together — no half-updated selection that
    // would bind commands to one workspace's id and another's root.
    expect(saved?.projectId).toBe("p-b");
    expect(saved?.root).toBe("/data/alice/worker");
    expect(saved?.branch).toBe("dev");
  });

  it("`workspace clear` removes the selection", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A] }));
    await workspaceCommand(["select"]);
    expect(getSelectedRemoteWorkspace()).not.toBeNull();

    expect(await workspaceCommand(["clear"])).toBe(0);
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });
});

describe("H — persisted selection", () => {
  it("survives a fresh read of the store (new process equivalent)", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    await workspaceCommand(["select", "ws-b"]);

    // Re-import the store module with a cleared registry — this reads
    // the file from disk exactly as a new CLI invocation would.
    vi.resetModules();
    const fresh = await import("../lib/remote-workspace-store.js");
    expect(fresh.getSelectedRemoteWorkspace()?.workspaceId).toBe("ws-b");
  });

  it("`workspace current` reports the persisted selection", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A, WS_B] }));
    await workspaceCommand(["select", "ws-b"]);

    const code = await workspaceCommand(["current"]);

    expect(code).toBe(0);
    const printed = logSpy.mock.calls.flat().join("\n");
    expect(printed).toContain("ws-b");
  });

  it("selection is stamped with a selectedAt timestamp", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A] }));
    await workspaceCommand(["select"]);
    expect(getSelectedRemoteWorkspace()!.selectedAt).toBeGreaterThan(0);
  });
});

// ─── I. No cross-user leakage ─────────────────────────────────────

describe("I — no cross-user workspace leakage", () => {
  it("never sends a userId — identity comes only from the bearer token", async () => {
    stubListing(jsonResponse({ workspaces: [WS_A] }));

    await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });

    const [url, init] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(url).not.toMatch(/userId|user_id|\?/);
    expect(init.body).toBeUndefined();
    // The only identity material on the request is the Authorization header.
    expect(Object.keys(init.headers as Record<string, string>)).toEqual(["Authorization"]);
  });

  it("a workspace-scoped token is never reused across workspaces", async () => {
    // Token cache is keyed by workspaceId; a different workspace must
    // force a fresh exchange rather than reusing a token whose signed
    // `wid` claim points at the previous workspace.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ terminalToken: "token-for-a", expiresIn: 300 }) as never,
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ workspaces: [WS_A] }) as never);
    await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN, workspaceId: "ws-a" });

    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ terminalToken: "token-for-b", expiresIn: 300 }) as never,
    );
    fetchSpy.mockResolvedValueOnce(jsonResponse({ workspaces: [WS_B] }) as never);
    await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN, workspaceId: "ws-b" });

    const exchanges = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/api/token-exchange"),
    );
    expect(exchanges).toHaveLength(2);
    const headerB = (fetchSpy.mock.calls[3][1] as RequestInit).headers as Record<string, string>;
    expect(headerB.Authorization).toBe("Bearer token-for-b");
  });
});
