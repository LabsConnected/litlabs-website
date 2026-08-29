/**
 * GET /api/workspaces endpoint tests.
 *
 * Verifies the workspace listing contract:
 *   - Missing/invalid/expired terminal token → 401
 *   - Only the authenticated user's workspaces are returned
 *   - Only ready workspaces are included
 *   - Other users' workspaces are excluded
 *   - Empty ready-workspace result → { workspaces: [] }
 *   - One malformed record does not fail the whole list
 *   - Registry failure → 500 (distinct from 404 and from empty)
 *   - Response exposes only safe fields: workspaceId, projectId, root, branch
 *   - No secrets, JWTs, internal metadata, or cross-user data leaks
 *
 * These mount the REAL handler via registerWorkspaceRoutes — the same
 * function server.ts calls. The previous version of this file defined
 * its own inline copy of the handler, so the suite passed green while
 * the deployed server had no /api/workspaces route at all and returned
 * 404 to every `litt workspace select`. A test that builds its own
 * implementation of the thing under test cannot detect the thing being
 * absent, so the route registration itself is now covered too.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import { registerWorkspaceRoutes, selectReadyWorkspaces } from "../workspace-routes.js";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager.js";

// ─── Constants ────────────────────────────────────────────────────

const VALID_SECRET = "s".repeat(32);

// ─── Terminal JWT minting ─────────────────────────────────────────

function mintServerToken(
  userId: string,
  secret: string = VALID_SECRET,
  options: { exp?: number; wid?: string; cwd?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: userId,
    aud: "littree-terminal",
    iat: now,
    exp: options.exp ?? now + 300,
  };
  if (options.wid) payload.wid = options.wid;
  if (options.cwd) payload.cwd = options.cwd;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function mintBadSignatureToken(userId: string): string {
  const payload = {
    sub: userId,
    aud: "littree-terminal",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", "wrong-secret").update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function mintExpiredToken(userId: string): string {
  return mintServerToken(userId, VALID_SECRET, { exp: Math.floor(Date.now() / 1000) - 60 });
}

// ─── Mock workspace store ─────────────────────────────────────────

const mockWorkspaces = new Map<string, WorkspaceDescriptor>();

function addMockWorkspace(ws: Partial<WorkspaceDescriptor> & { workspaceId: string }): void {
  mockWorkspaces.set(ws.workspaceId, {
    userId: "alice",
    projectId: "p",
    root: "/data/ws",
    branch: "main",
    commitSha: "abc123",
    ready: true,
    ...ws,
  } as WorkspaceDescriptor);
}

/**
 * Stands in for WorkspaceManager.listWorkspaces — same signature and
 * same userId filtering, so the handler runs against a faithful store.
 */
function fakeListWorkspaces(userId: string): WorkspaceDescriptor[] {
  return Array.from(mockWorkspaces.values()).filter((w) => w.userId === userId);
}

// ─── Test app builder (mounts the REAL handler) ───────────────────

function createTestApp(
  listWorkspaces: (userId: string) => WorkspaceDescriptor[] = fakeListWorkspaces,
): express.Application {
  const app = express();
  app.use(express.json());
  registerWorkspaceRoutes(app, { listWorkspaces });
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /api/workspaces", () => {
  let app: express.Application;

  beforeEach(() => {
    // Set the secret so verifyTerminalToken works
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
    mockWorkspaces.clear();
    app = createTestApp();
  });

  // ─── Route existence ────────────────────────────────────────────
  // The regression this endpoint shipped with: the CLI called a route
  // the server never registered, so Express answered 404 and the CLI
  // reported it as a failed remote session.

  it("is registered — an authenticated request is never 404", async () => {
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(200);
  });

  // ─── Authentication ─────────────────────────────────────────────

  it("returns 401 when no Authorization header is present", async () => {
    const res = await request(app).get("/api/workspaces");
    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("returns 401 when Authorization header has no Bearer token", async () => {
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", "Basic abc123");
    expect(res.status).toBe(401);
  });

  it("returns 401 when terminal token has a bad signature", async () => {
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintBadSignatureToken("alice")}`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when terminal token is expired", async () => {
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintExpiredToken("alice")}`);
    expect(res.status).toBe(401);
  });

  // ─── Workspace filtering ────────────────────────────────────────

  it("returns only the authenticated user's ready workspaces", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", projectId: "p1", root: "/data/ws1", branch: "main" });
    addMockWorkspace({ workspaceId: "ws2", userId: "alice", projectId: "p2", root: "/data/ws2", branch: "dev" });
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", projectId: "p3", root: "/data/bob", branch: "main" });

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(2);
    const ids = res.body.workspaces.map((w: { workspaceId: string }) => w.workspaceId);
    expect(ids).toContain("ws1");
    expect(ids).toContain("ws2");
    expect(ids).not.toContain("ws-bob");
  });

  it("excludes workspaces that are not ready", async () => {
    addMockWorkspace({ workspaceId: "ws-ready", userId: "alice", projectId: "p1", root: "/data/ready", branch: "main", ready: true });
    addMockWorkspace({ workspaceId: "ws-init", userId: "alice", projectId: "p2", root: "/data/init", branch: "main", ready: false });

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].workspaceId).toBe("ws-ready");
  });

  it("returns { workspaces: [] } when user has no ready workspaces", async () => {
    addMockWorkspace({ workspaceId: "ws-init", userId: "alice", projectId: "p1", root: "/data/init", branch: "main", ready: false });

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([]);
  });

  it("returns { workspaces: [] } when user has no workspaces at all", async () => {
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("nobody")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toEqual([]);
  });

  // ─── Resilience ─────────────────────────────────────────────────

  it("one malformed record does not hide the user's other workspaces", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    addMockWorkspace({ workspaceId: "ws-good", userId: "alice", projectId: "p1", root: "/data/good", branch: "main" });
    // Missing `root` — a partially-written registry entry.
    mockWorkspaces.set("ws-bad", {
      workspaceId: "ws-bad",
      userId: "alice",
      projectId: "p2",
      branch: "main",
      commitSha: "x",
      ready: true,
    } as unknown as WorkspaceDescriptor);

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].workspaceId).toBe("ws-good");
    warnSpy.mockRestore();
  });

  it("returns 500 — not 404, not an empty list — when the registry throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const brokenApp = createTestApp(() => {
      throw new Error("registry unreadable");
    });

    const res = await request(brokenApp)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(500);
    // A server fault must not masquerade as "you have no workspaces".
    expect(res.body.workspaces).toBeUndefined();
    errSpy.mockRestore();
  });

  // ─── Response shape ─────────────────────────────────────────────

  it("exposes only workspaceId, projectId, root, branch — no secrets or internal fields", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", projectId: "p1", root: "/data/ws1", branch: "main" });

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    const ws = res.body.workspaces[0];
    expect(Object.keys(ws).sort()).toEqual(["branch", "projectId", "root", "workspaceId"]);
    // Must NOT expose userId, ready, commitSha, or any internal field
    expect(ws).not.toHaveProperty("userId");
    expect(ws).not.toHaveProperty("ready");
    expect(ws).not.toHaveProperty("commitSha");
  });

  it("never returns another user's workspace even if the token is valid", async () => {
    addMockWorkspace({ workspaceId: "ws-alice", userId: "alice", projectId: "p1", root: "/data/alice", branch: "main" });
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", projectId: "p2", root: "/data/bob", branch: "main" });

    // Bob's token should only see Bob's workspace
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("bob")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].workspaceId).toBe("ws-bob");
  });

  it("does not leak another user's workspace even if the store ignores the userId filter", async () => {
    // Defense in depth: a store that returns everything must still not
    // produce a cross-user listing.
    addMockWorkspace({ workspaceId: "ws-alice", userId: "alice", projectId: "p1", root: "/data/alice", branch: "main" });
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", projectId: "p2", root: "/data/bob", branch: "main" });
    const leakyApp = createTestApp(() => Array.from(mockWorkspaces.values()));

    const res = await request(leakyApp)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("bob")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].workspaceId).toBe("ws-bob");
  });
});

// ─── Pure selection logic ─────────────────────────────────────────

describe("selectReadyWorkspaces", () => {
  const ws = (over: Partial<WorkspaceDescriptor>): WorkspaceDescriptor => ({
    workspaceId: "w",
    userId: "alice",
    projectId: "p",
    root: "/r",
    branch: "main",
    commitSha: "s",
    ready: true,
    ...over,
  });

  it("keeps only ready, owned, well-formed records", () => {
    const result = selectReadyWorkspaces(
      [
        ws({ workspaceId: "a" }),
        ws({ workspaceId: "b", ready: false }),
        ws({ workspaceId: "c", userId: "bob" }),
      ],
      "alice",
    );
    expect(result.map((w) => w.workspaceId)).toEqual(["a"]);
  });

  it("returns [] rather than throwing on an empty store", () => {
    expect(selectReadyWorkspaces([], "alice")).toEqual([]);
  });
});
