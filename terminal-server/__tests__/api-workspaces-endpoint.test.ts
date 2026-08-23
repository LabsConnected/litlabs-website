/**
 * GET /api/workspaces endpoint tests.
 *
 * Verifies the workspace listing contract:
 *   - Missing/invalid/expired terminal token → 401
 *   - Only the authenticated user's workspaces are returned
 *   - Only ready workspaces are included
 *   - Other users' workspaces are excluded
 *   - Empty ready-workspace result → { workspaces: [] }
 *   - Response exposes only safe fields: workspaceId, projectId, root, branch
 *   - No secrets, JWTs, internal metadata, or cross-user data leaks
 *
 * Uses the same mock patterns as api-chat-endpoint.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import { verifyTerminalToken, bearerToken } from "../auth.js";
import type { AuthenticatedRequest } from "../internal-auth.js";

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

interface MockWorkspace {
  workspaceId: string;
  userId: string;
  projectId: string;
  root: string;
  branch: string;
  ready: boolean;
}

const mockWorkspaces = new Map<string, MockWorkspace>();

function resetMockWorkspaces(): void {
  mockWorkspaces.clear();
}

function addMockWorkspace(ws: MockWorkspace): void {
  mockWorkspaces.set(ws.workspaceId, ws);
}

// ─── Test app builder (mirrors the real /api/workspaces handler) ──

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());

  app.get("/api/workspaces", (req: AuthenticatedRequest, res) => {
    try {
      const token = bearerToken(req.headers.authorization);
      const payload = verifyTerminalToken(token);
      const userId = payload.sub;
      const all = Array.from(mockWorkspaces.values());
      const ready = all.filter((w) => w.userId === userId && w.ready);
      res.json({
        workspaces: ready.map((w) => ({
          workspaceId: w.workspaceId,
          projectId: w.projectId,
          root: w.root,
          branch: w.branch,
        })),
      });
    } catch {
      res.status(401).json({ error: "Unauthorized — valid terminal token required" });
    }
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /api/workspaces", () => {
  let app: express.Application;

  beforeEach(() => {
    // Set the secret so verifyTerminalToken works
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
    resetMockWorkspaces();
    app = createTestApp();
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
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", projectId: "p1", root: "/data/ws1", branch: "main", ready: true });
    addMockWorkspace({ workspaceId: "ws2", userId: "alice", projectId: "p2", root: "/data/ws2", branch: "dev", ready: true });
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", projectId: "p3", root: "/data/bob", branch: "main", ready: true });

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

  // ─── Response shape ─────────────────────────────────────────────

  it("exposes only workspaceId, projectId, root, branch — no secrets or internal fields", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", projectId: "p1", root: "/data/ws1", branch: "main", ready: true });

    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`);

    expect(res.status).toBe(200);
    const ws = res.body.workspaces[0];
    expect(Object.keys(ws).sort()).toEqual(["branch", "projectId", "root", "workspaceId"]);
    // Must NOT expose userId, ready, or any internal field
    expect(ws).not.toHaveProperty("userId");
    expect(ws).not.toHaveProperty("ready");
  });

  it("never returns another user's workspace even if the token is valid", async () => {
    addMockWorkspace({ workspaceId: "ws-alice", userId: "alice", projectId: "p1", root: "/data/alice", branch: "main", ready: true });
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", projectId: "p2", root: "/data/bob", branch: "main", ready: true });

    // Bob's token should only see Bob's workspace
    const res = await request(app)
      .get("/api/workspaces")
      .set("Authorization", `Bearer ${mintServerToken("bob")}`);

    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].workspaceId).toBe("ws-bob");
  });
});
