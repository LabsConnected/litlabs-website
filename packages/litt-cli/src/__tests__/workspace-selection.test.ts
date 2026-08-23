/**
 * Workspace selection tests — local persistence store + remote integration.
 *
 * Covers:
 *   - remote-workspace-store: get/set/clear with temp files
 *   - remote-workspace-store: no selection when file absent
 *   - remote-workspace-store: clear is safe when no file exists
 *   - remote.ts listRemoteWorkspaces: fetches /api/workspaces with terminal token
 *   - remote.ts listRemoteWorkspaces: empty list on { workspaces: [] }
 *   - remote.ts listRemoteWorkspaces: 401 → auth_revoked
 *   - remote.ts remoteChat: workspace_selection_required → typed error
 *   - remote.ts remoteChat: workspaceId passed to token exchange, not /api/chat body
 *
 * Uses mocked fetch — no real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSelectedRemoteWorkspace,
  setSelectedRemoteWorkspace,
  clearSelectedRemoteWorkspace,
} from "../lib/remote-workspace-store.js";
import {
  listRemoteWorkspaces,
  remoteChat,
  clearTerminalTokenCache,
  type RemoteWorkspace,
} from "../lib/remote.js";

// ─── Mock fetch ───────────────────────────────────────────────────

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  body?: { getReader: () => { read: () => Promise<{ done: boolean; value?: Uint8Array }>; releaseLock: () => void } };
}

function mockFetchResponse(body: unknown, status = 200): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mockFetchStream(lines: string[]): MockResponse {
  const encoder = new TextEncoder();
  let idx = 0;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    body: {
      getReader: () => ({
        read: async () => {
          if (idx < lines.length) {
            const value = encoder.encode(lines[idx++] + "\n");
            return { done: false, value };
          }
          return { done: true };
        },
        releaseLock: () => {},
      }),
    },
  };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  clearTerminalTokenCache();
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.restoreAllMocks();
  clearTerminalTokenCache();
});

// ─── remote-workspace-store tests ─────────────────────────────────

describe("remote-workspace-store", () => {
  let tempDir: string;
  let storeFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "litt-ws-store-"));
    storeFile = join(tempDir, "remote-workspace.json");
    process.env.LITT_REMOTE_WORKSPACE_FILE = storeFile;
  });

  afterEach(() => {
    delete process.env.LITT_REMOTE_WORKSPACE_FILE;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when no selection file exists", () => {
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("persists and reads back a selection", () => {
    setSelectedRemoteWorkspace({
      workspaceId: "ws-123",
      projectId: "proj-1",
      root: "/data/myproject",
      branch: "main",
    });

    const result = getSelectedRemoteWorkspace();
    expect(result).not.toBeNull();
    expect(result!.workspaceId).toBe("ws-123");
    expect(result!.projectId).toBe("proj-1");
    expect(result!.root).toBe("/data/myproject");
    expect(result!.branch).toBe("main");
    expect(result!.selectedAt).toBeGreaterThan(0);
  });

  it("clear removes the selection", () => {
    setSelectedRemoteWorkspace({
      workspaceId: "ws-123",
      projectId: "proj-1",
      root: "/data/myproject",
      branch: "main",
    });
    expect(getSelectedRemoteWorkspace()).not.toBeNull();

    clearSelectedRemoteWorkspace();
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("clear is safe when no file exists", () => {
    expect(() => clearSelectedRemoteWorkspace()).not.toThrow();
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("returns null for a corrupted file", () => {
    // Write invalid JSON
    const { writeFileSync } = require("node:fs");
    writeFileSync(storeFile, "{ invalid json }", "utf8");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });
});

// ─── listRemoteWorkspaces tests ───────────────────────────────────

describe("listRemoteWorkspaces", () => {
  const TERMINAL_JWT = "terminal.jwt.token";
  const CLERK_TOKEN = "clerk-token-abc";

  it("fetches GET /api/workspaces with terminal token", async () => {
    // First call: token exchange
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    // Second call: /api/workspaces
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({
        workspaces: [
          { workspaceId: "ws1", projectId: "p1", root: "/data/ws1", branch: "main" },
        ],
      }),
    );

    const result = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });

    expect(result).toHaveLength(1);
    expect(result[0].workspaceId).toBe("ws1");

    // Verify the /api/workspaces call used the terminal JWT
    const workspacesCall = fetchSpy.mock.calls[1];
    expect(workspacesCall[0]).toContain("/api/workspaces");
    expect(workspacesCall[1].headers.Authorization).toBe(`Bearer ${TERMINAL_JWT}`);
  });

  it("returns empty array on { workspaces: [] }", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ workspaces: [] }));

    const result = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });
    expect(result).toEqual([]);
  });

  it("returns empty array when workspaces field is missing", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({}));

    const result = await listRemoteWorkspaces({ clerkToken: CLERK_TOKEN });
    expect(result).toEqual([]);
  });

  it("throws auth_revoked on 401", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ error: "Unauthorized" }, 401),
    );

    await expect(
      listRemoteWorkspaces({ clerkToken: CLERK_TOKEN }),
    ).rejects.toThrow();
  });
});

// ─── remoteChat workspace error handling ──────────────────────────

describe("remoteChat workspace error handling", () => {
  const TERMINAL_JWT = "terminal.jwt.token";
  const CLERK_TOKEN = "clerk-token-abc";

  it("throws workspace_selection_required error on that server response", async () => {
    // Token exchange
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    // /api/chat returns workspace_selection_required
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        { error: { code: "workspace_selection_required", message: "Multiple workspaces — specify which one" } },
        400,
      ),
    );

    await expect(
      remoteChat("hello", () => {}, { clerkToken: CLERK_TOKEN }),
    ).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "workspace_selection_required",
    });
  });

  it("throws workspace_required error on that server response", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        { error: { code: "workspace_required", message: "No ready workspace" } },
        400,
      ),
    );

    await expect(
      remoteChat("hello", () => {}, { clerkToken: CLERK_TOKEN }),
    ).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "workspace_required",
    });
  });

  it("throws workspace_unauthorized error on that server response", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse(
        { error: { code: "workspace_unauthorized", message: "Workspace access denied" } },
        403,
      ),
    );

    await expect(
      remoteChat("hello", () => {}, { clerkToken: CLERK_TOKEN }),
    ).rejects.toMatchObject({
      isRemoteUnavailable: true,
      reason: "workspace_unauthorized",
    });
  });

  it("passes workspaceId to token exchange, not to /api/chat body", async () => {
    // Token exchange — verify workspaceId is in the body
    fetchSpy.mockResolvedValueOnce(
      mockFetchResponse({ terminalToken: TERMINAL_JWT, expiresIn: 300 }),
    );
    // /api/chat — successful stream
    fetchSpy.mockResolvedValueOnce(
      mockFetchStream([
        JSON.stringify({ type: "meta", provider: "openrouter", model: "test", profile: "auto" }),
        JSON.stringify({ type: "done", model: "test" }),
      ]),
    );

    await remoteChat("hello", () => {}, {
      clerkToken: CLERK_TOKEN,
      workspaceId: "ws-selected",
    });

    // Verify token exchange call included workspaceId
    const tokenExchangeCall = fetchSpy.mock.calls[0];
    expect(tokenExchangeCall[0]).toContain("/api/token-exchange");
    const exchangeBody = JSON.parse(tokenExchangeCall[1].body);
    expect(exchangeBody.workspaceId).toBe("ws-selected");

    // Verify /api/chat call did NOT include workspaceId in the body
    const chatCall = fetchSpy.mock.calls[1];
    expect(chatCall[0]).toContain("/api/chat");
    const chatBody = JSON.parse(chatCall[1].body);
    expect(chatBody).toEqual({ message: "hello" });
    expect(chatBody).not.toHaveProperty("workspaceId");
  });
});
