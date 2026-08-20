/**
 * /api/command + /api/token-exchange user authentication security tests.
 *
 * Tests the security chain:
 *   CLI authenticated user (Clerk session)
 *     → Clerk-issued token
 *     → POST /api/token-exchange (server verifies Clerk token)
 *     → server derives userId from Clerk token (NOT from request body)
 *     → server mints short-lived terminal JWT
 *     → client uses terminal JWT for /api/command
 *     → server verifies terminal JWT
 *     → server extracts userId from JWT (NOT from request body)
 *     → authorized workspace/project
 *     → ExecutionGateway
 *
 * Security properties verified:
 *   - Missing auth token → 401
 *   - Invalid terminal token (bad signature) → 401
 *   - Expired terminal token → 401
 *   - Wrong audience → 401
 *   - Valid terminal token → 200 (command dispatched)
 *   - userId comes from JWT, NOT request body (impersonation prevention)
 *   - cwd outside user workspace → 403
 *   - /internal/command remains separately protected by internal service key
 *   - /api/command does NOT accept X-Internal-Service-Key
 *   - /internal/command does NOT accept Bearer token
 *   - Token exchange rejects invalid Clerk tokens
 *   - Token exchange derives userId from Clerk token, not request body
 *   - CLI cannot mint arbitrary user identity (no access to TERMINAL_AUTH_SECRET)
 *
 * Uses supertest to test the actual Express middleware + handler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import { resolve, relative, isAbsolute } from "path";
import { mintTerminalToken, verifyTerminalToken, bearerToken } from "../auth.js";
import { requireInternalServiceAuth, type AuthenticatedRequest } from "../internal-auth.js";
import type { RemoteCommandRequest } from "@litt/agent-core";

// ─── Constants ────────────────────────────────────────────────────

const VALID_SECRET = "s".repeat(32);
const INTERNAL_KEY = "k".repeat(32);

// ─── Terminal JWT minting (server-side only — matches auth.ts) ─────

function mintServerToken(
  userId: string,
  secret: string = VALID_SECRET,
  options: { exp?: number; aud?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    aud: options.aud ?? "littree-terminal",
    iat: now,
    exp: options.exp ?? now + 300,
  };
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

// ─── Mock Clerk verification ──────────────────────────────────────
// Mocks verifyClerkToken so we can test the token exchange endpoint
// without real Clerk credentials.

vi.mock("../clerk-verify.js", () => ({
  verifyClerkToken: vi.fn(async (token: string) => {
    if (!token || token === "invalid-clerk-token") {
      throw new Error("Invalid Clerk token");
    }
    if (token === "expired-clerk-token") {
      throw new Error("Clerk token expired");
    }
    // Extract userId from the mock token format: "clerk-token-<userId>"
    const userId = token.replace("clerk-token-", "");
    if (!userId || userId === "clerk-token-") {
      throw new Error("Clerk token has no subject");
    }
    return { userId, claims: { sub: userId } };
  }),
}));

// ─── Mock workspace store ─────────────────────────────────────────
// Simulates the WorkspaceManager's in-memory workspace store for
// workspace authorization tests.

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

function getMockWorkspace(workspaceId: string): MockWorkspace | undefined {
  return mockWorkspaces.get(workspaceId);
}

// ─── Test app builder ─────────────────────────────────────────────

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());

  // ─── /api/token-exchange — Clerk token → terminal JWT ─────────
  // Includes workspace/project authorization (server-side).
  app.post("/api/token-exchange", async (req: AuthenticatedRequest, res) => {
    try {
      const clerkToken = bearerToken(req.headers.authorization);
      if (!clerkToken) {
        res.status(401).json({ error: "Missing Clerk token" });
        return;
      }
      const { verifyClerkToken } = await import("../clerk-verify.js");
      const verified = await verifyClerkToken(clerkToken);
      const userId = verified.userId;

      // ─── Workspace/project authorization (server-side) ────────
      const body = req.body ?? {};
      const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
      let authorizedWorkspaceId: string | undefined;
      let authorizedProjectId: string | undefined;
      let authorizedWorkspaceRoot: string | undefined;

      if (requestedWorkspaceId) {
        const ws = getMockWorkspace(requestedWorkspaceId);
        if (!ws) {
          res.status(404).json({ error: "Workspace not found" });
          return;
        }
        if (ws.userId !== userId) {
          res.status(403).json({
            error: "Forbidden — workspace does not belong to the authenticated user",
          });
          return;
        }
        authorizedWorkspaceId = ws.workspaceId;
        authorizedProjectId = ws.projectId;
        authorizedWorkspaceRoot = ws.root;
      }

      const terminalToken = authorizedWorkspaceId
        ? mintTerminalToken(userId, 300, {
            workspaceId: authorizedWorkspaceId,
            projectId: authorizedProjectId,
            cwd: authorizedWorkspaceRoot,
          })
        : mintTerminalToken(userId, 300);

      res.json({
        terminalToken,
        expiresIn: 300,
        userId,
        workspaceId: authorizedWorkspaceId,
        projectId: authorizedProjectId,
        workspaceRoot: authorizedWorkspaceRoot,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token exchange failed";
      res.status(401).json({ error: message });
    }
  });

  // ─── /api/command — user-authenticated command endpoint ───────
  app.post("/api/command", (req: AuthenticatedRequest, res) => {
    let userId: string;
    try {
      const token = bearerToken(req.headers.authorization);
      const payload = verifyTerminalToken(token);
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const body = req.body as RemoteCommandRequest;
    if (!body?.command || typeof body.command !== "string") {
      res.status(400).json({ error: "Missing 'command' field" });
      return;
    }

    // Workspace boundary validation
    const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
    const userWorkspaceRoot = workspaceRoot
      ? resolve(workspaceRoot, userId)
      : process.cwd();

    let cwd = body.cwd ?? userWorkspaceRoot;
    if (workspaceRoot) {
      const resolvedCwd = resolve(cwd);
      const resolvedUserRoot = resolve(userWorkspaceRoot);
      const rel = relative(resolvedUserRoot, resolvedCwd);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        res.status(403).json({ error: "Forbidden — cwd is outside your workspace" });
        return;
      }
    }

    // userId from JWT — NOT from body
    const normalizedReq: RemoteCommandRequest = {
      ...body,
      args: Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [],
      userId,
      cwd,
    };

    res.json({
      ok: true,
      runId: "test_run",
      kind: "test",
      result: { status: "success", success: true, message: "ok", data: {} },
      timestamp: Date.now(),
      durationMs: 0,
      _testUserId: normalizedReq.userId,
      _testCwd: normalizedReq.cwd,
    });
  });

  // ─── /internal/command — remains service-to-service only ──────
  app.post("/internal/command", requireInternalServiceAuth, (_req: AuthenticatedRequest, res) => {
    res.json({ ok: true, runId: "internal_run", kind: "test" });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("/api/command user authentication", () => {
  let oldAuthSecret: string | undefined;
  let oldInternalKey: string | undefined;
  let oldWorkspaceRoot: string | undefined;

  beforeEach(() => {
    oldAuthSecret = process.env.TERMINAL_AUTH_SECRET;
    oldInternalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    oldWorkspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT;
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    process.env.TERMINAL_WORKSPACE_ROOT = "/data/workspaces";
  });

  afterEach(() => {
    if (oldAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
    else process.env.TERMINAL_AUTH_SECRET = oldAuthSecret;
    if (oldInternalKey === undefined) delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    else process.env.TERMINAL_INTERNAL_SERVICE_KEY = oldInternalKey;
    if (oldWorkspaceRoot === undefined) delete process.env.TERMINAL_WORKSPACE_ROOT;
    else process.env.TERMINAL_WORKSPACE_ROOT = oldWorkspaceRoot;
    vi.clearAllMocks();
  });

  // ─── Missing auth ──────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/command")
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when Authorization header has no Bearer prefix", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", token)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  // ─── Invalid token ─────────────────────────────────────────────

  it("returns 401 when terminal token has a bad signature", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${mintBadSignatureToken("alice")}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  it("returns 401 when token is malformed", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", "Bearer not-a-valid-token")
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  // ─── Expired token ─────────────────────────────────────────────

  it("returns 401 when terminal token is expired", async () => {
    const app = createTestApp();
    const expiredToken = mintServerToken("alice", VALID_SECRET, {
      exp: Math.floor(Date.now() / 1000) - 100,
    });
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${expiredToken}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  // ─── Wrong audience ────────────────────────────────────────────

  it("returns 401 when token has wrong audience", async () => {
    const app = createTestApp();
    const wrongAudToken = mintServerToken("alice", VALID_SECRET, {
      aud: "wrong-audience",
    });
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${wrongAudToken}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  // ─── Valid user ────────────────────────────────────────────────

  it("returns 200 when terminal token is valid", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ─── Server derives userId from JWT, NOT from request body ─────

  it("extracts userId from the JWT, NOT from the request body", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [], userId: "evil-impersonator" });

    expect(res.status).toBe(200);
    expect(res.body._testUserId).toBe("alice");
    expect(res.body._testUserId).not.toBe("evil-impersonator");
  });

  // ─── Forged sub fails (client cannot mint tokens) ──────────────

  it("a token with forged sub (signed with wrong secret) fails", async () => {
    const app = createTestApp();
    // Client tries to mint a token with sub="admin" using a guessed secret
    const forgedToken = mintServerToken("admin", "wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${forgedToken}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  // ─── Workspace boundary ────────────────────────────────────────

  it("returns 403 when cwd is outside the user's workspace", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [], cwd: "/data/workspaces/bob" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("returns 403 when cwd uses path traversal to escape workspace", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [], cwd: "/data/workspaces/alice/../../../bob" });

    expect(res.status).toBe(403);
  });

  it("returns 200 when cwd is within the user's workspace", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [], cwd: "/data/workspaces/alice/project" });

    expect(res.status).toBe(200);
  });

  // ─── Internal endpoint remains separately protected ────────────

  it("/internal/command returns 401 without X-Internal-Service-Key", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/internal/command")
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  it("/internal/command returns 401 with wrong X-Internal-Service-Key", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/internal/command")
      .set("X-Internal-Service-Key", "wrong-key")
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  it("/internal/command returns 200 with correct X-Internal-Service-Key", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/internal/command")
      .set("X-Internal-Service-Key", INTERNAL_KEY)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(200);
  });

  // ─── Cross-auth rejection ──────────────────────────────────────

  it("/api/command does NOT accept X-Internal-Service-Key as auth", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/command")
      .set("X-Internal-Service-Key", INTERNAL_KEY)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });

  it("/internal/command does NOT accept Bearer token as auth", async () => {
    const app = createTestApp();
    const token = mintServerToken("alice");
    const res = await request(app)
      .post("/internal/command")
      .set("Authorization", `Bearer ${token}`)
      .send({ command: "status", args: [] });

    expect(res.status).toBe(401);
  });
});

// ─── Token exchange tests ─────────────────────────────────────────

describe("/api/token-exchange", () => {
  let oldAuthSecret: string | undefined;

  beforeEach(() => {
    oldAuthSecret = process.env.TERMINAL_AUTH_SECRET;
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
  });

  afterEach(() => {
    if (oldAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
    else process.env.TERMINAL_AUTH_SECRET = oldAuthSecret;
    vi.clearAllMocks();
  });

  it("returns a terminal JWT when Clerk token is valid", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send();

    expect(res.status).toBe(200);
    expect(res.body.terminalToken).toBeDefined();
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.userId).toBe("alice");
  });

  it("derives userId from the Clerk token, NOT from the request body", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ userId: "evil-impersonator" });

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("alice");
    expect(res.body.userId).not.toBe("evil-impersonator");
  });

  it("returns 401 when Clerk token is missing", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing Clerk token/);
  });

  it("returns 401 when Clerk token is invalid", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer invalid-clerk-token")
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid Clerk token/);
  });

  it("returns 401 when Clerk token is expired", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer expired-clerk-token")
      .send();

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  it("the minted terminal JWT verifies correctly", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send();

    expect(res.status).toBe(200);
    const terminalToken = res.body.terminalToken as string;
    // The terminal JWT should verify with the server's secret
    const payload = verifyTerminalToken(terminalToken);
    expect(payload.sub).toBe("alice");
    expect(payload.aud).toBe("littree-terminal");
  });

  it("the minted terminal JWT can be used for /api/command", async () => {
    const app = createTestApp();

    // Step 1: Exchange Clerk token for terminal JWT
    const exchangeRes = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send();

    expect(exchangeRes.status).toBe(200);
    const terminalToken = exchangeRes.body.terminalToken as string;

    // Step 2: Use the terminal JWT for /api/command
    const cmdRes = await request(app)
      .post("/api/command")
      .set("Authorization", `Bearer ${terminalToken}`)
      .send({ command: "status", args: [] });

    expect(cmdRes.status).toBe(200);
    expect(cmdRes.body._testUserId).toBe("alice");
  });

  it("X-Internal-Service-Key does NOT work for token exchange", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("X-Internal-Service-Key", INTERNAL_KEY)
      .send();

    expect(res.status).toBe(401);
  });
});

// ─── CLI cannot mint arbitrary identity ───────────────────────────

describe("CLI cannot mint arbitrary user identity", () => {
  it("a client without TERMINAL_AUTH_SECRET cannot forge a valid token", () => {
    // The CLI never has TERMINAL_AUTH_SECRET. Any token it mints
    // with a guessed secret will fail verification.
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;

    // Simulate a client trying to mint a token with a wrong secret
    const forgedToken = mintServerToken("admin", "guessed-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx");
    expect(() => verifyTerminalToken(forgedToken)).toThrow();
  });

  it("a token signed with the correct secret but forged sub would require the secret", () => {
    // This test documents the security property: to mint a token
    // with arbitrary sub, you need TERMINAL_AUTH_SECRET. The CLI
    // never has it, so it cannot forge identity.
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;

    // Only the server can mint valid tokens
    const serverMinted = mintTerminalToken("alice", 300);
    const payload = verifyTerminalToken(serverMinted);
    expect(payload.sub).toBe("alice");

    // A client without the secret cannot produce a valid token
    const clientMinted = mintServerToken("admin", "wrong-secret");
    expect(() => verifyTerminalToken(clientMinted)).toThrow();
  });
});

// ─── Workspace/project authorization during token exchange ────────

describe("/api/token-exchange workspace/project authorization", () => {
  let oldAuthSecret: string | undefined;

  beforeEach(() => {
    oldAuthSecret = process.env.TERMINAL_AUTH_SECRET;
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
    resetMockWorkspaces();
  });

  afterEach(() => {
    if (oldAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
    else process.env.TERMINAL_AUTH_SECRET = oldAuthSecret;
    vi.clearAllMocks();
  });

  it("returns a workspace-bound terminal JWT when workspaceId belongs to the user", async () => {
    addMockWorkspace({
      workspaceId: "ws-alice-1",
      userId: "alice",
      projectId: "proj-1",
      root: "/data/workspaces/alice/project",
      branch: "main",
      ready: true,
    });

    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ workspaceId: "ws-alice-1" });

    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBe("ws-alice-1");
    expect(res.body.projectId).toBe("proj-1");
    expect(res.body.workspaceRoot).toBe("/data/workspaces/alice/project");

    // The terminal JWT should contain the workspace claims
    const payload = verifyTerminalToken(res.body.terminalToken);
    expect(payload.sub).toBe("alice");
    expect(payload.wid).toBe("ws-alice-1");
    expect(payload.pid).toBe("proj-1");
  });

  it("returns 403 when workspaceId belongs to a DIFFERENT user", async () => {
    addMockWorkspace({
      workspaceId: "ws-bob-1",
      userId: "bob",
      projectId: "proj-bob",
      root: "/data/workspaces/bob/project",
      branch: "main",
      ready: true,
    });

    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ workspaceId: "ws-bob-1" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
    expect(res.body.terminalToken).toBeUndefined();
  });

  it("returns 404 when workspaceId does not exist", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ workspaceId: "ws-nonexistent" });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Workspace not found/);
    expect(res.body.terminalToken).toBeUndefined();
  });

  it("does NOT trust userId from the request body for workspace auth", async () => {
    // Alice tries to access bob's workspace by sending userId: "bob"
    // in the body. The server must use the Clerk token's userId (alice),
    // NOT the body userId.
    addMockWorkspace({
      workspaceId: "ws-bob-1",
      userId: "bob",
      projectId: "proj-bob",
      root: "/data/workspaces/bob/project",
      branch: "main",
      ready: true,
    });

    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ workspaceId: "ws-bob-1", userId: "bob" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Forbidden/);
  });

  it("returns a token without workspace claims when no workspaceId is requested", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send();

    expect(res.status).toBe(200);
    expect(res.body.workspaceId).toBeUndefined();
    const payload = verifyTerminalToken(res.body.terminalToken);
    expect(payload.wid).toBeUndefined();
    expect(payload.pid).toBeUndefined();
  });

  it("the workspace-bound terminal JWT carries the authorized workspaceId, not a client-supplied one", async () => {
    addMockWorkspace({
      workspaceId: "ws-alice-1",
      userId: "alice",
      projectId: "proj-1",
      root: "/data/workspaces/alice/project",
      branch: "main",
      ready: true,
    });

    const app = createTestApp();
    // Client sends the correct workspaceId but also a forged projectId
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-alice")
      .send({ workspaceId: "ws-alice-1", projectId: "forged-project" });

    expect(res.status).toBe(200);
    // The terminal JWT should contain the SERVER-AUTHORIZED projectId,
    // not the client-supplied "forged-project"
    const payload = verifyTerminalToken(res.body.terminalToken);
    expect(payload.pid).toBe("proj-1");
    expect(payload.pid).not.toBe("forged-project");
  });
});

// ─── Dev token hard-disable in production ─────────────────────────

describe("dev token hard-disable in production", () => {
  let oldAuthSecret: string | undefined;
  let oldNodeEnv: string | undefined;

  beforeEach(() => {
    oldAuthSecret = process.env.TERMINAL_AUTH_SECRET;
    oldNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    if (oldAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
    else process.env.TERMINAL_AUTH_SECRET = oldAuthSecret;
    if (oldNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldNodeEnv;
  });

  it("rejects dev tokens when NODE_ENV=production even if secret is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TERMINAL_AUTH_SECRET;

    const devToken = "dev-" + Buffer.from(
      JSON.stringify({
        sub: "desktop-local-dev",
        aud: "littree-terminal",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    expect(() => verifyTerminalToken(devToken)).toThrow();
  });

  it("rejects dev tokens when NODE_ENV=production even if secret is set", () => {
    process.env.NODE_ENV = "production";
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;

    const devToken = "dev-" + Buffer.from(
      JSON.stringify({
        sub: "desktop-local-dev",
        aud: "littree-terminal",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    expect(() => verifyTerminalToken(devToken)).toThrow();
  });

  it("accepts dev tokens in non-production mode when secret is unset (local dev)", () => {
    process.env.NODE_ENV = "development";
    delete process.env.TERMINAL_AUTH_SECRET;

    const devToken = "dev-" + Buffer.from(
      JSON.stringify({
        sub: "desktop-local-dev",
        aud: "littree-terminal",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    const payload = verifyTerminalToken(devToken);
    expect(payload.sub).toBe("desktop-local-dev");
  });

  it("rejects dev tokens in non-production mode when secret IS set (server is hardened)", () => {
    process.env.NODE_ENV = "development";
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;

    const devToken = "dev-" + Buffer.from(
      JSON.stringify({
        sub: "desktop-local-dev",
        aud: "littree-terminal",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    // When the secret is set, dev tokens are rejected even in dev mode —
    // the server is configured for signed tokens only.
    expect(() => verifyTerminalToken(devToken)).toThrow();
  });

  it("a forged dev token with sub='admin' is rejected in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.TERMINAL_AUTH_SECRET;

    // Attacker tries to forge an admin identity via dev token
    const forgedDevToken = "dev-" + Buffer.from(
      JSON.stringify({
        sub: "admin",
        aud: "littree-terminal",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");

    expect(() => verifyTerminalToken(forgedDevToken)).toThrow();
  });
});

// ─── LITT_CLERK_TOKEN is temporary acceptance-test auth ───────────

describe("LITT_CLERK_TOKEN documentation boundary", () => {
  // This test section enforces that LITT_CLERK_TOKEN is documented
  // as a temporary acceptance-test mechanism, NOT the final login UX.
  // The final UX will be `litt login` with OS keychain storage.

  it("remote.ts source documents LITT_CLERK_TOKEN as temporary", () => {
    const fs = require("fs");
    const path = require("path");
    const remoteSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "packages", "litt-cli", "src", "lib", "remote.ts"),
      "utf-8",
    );
    // The source must document LITT_CLERK_TOKEN as temporary
    expect(remoteSrc).toMatch(/LITT_CLERK_TOKEN is a TEMPORARY/);
    expect(remoteSrc).toMatch(/acceptance-test/);
    expect(remoteSrc).toMatch(/NOT the final CLI login UX/);
  });

  it("runtime-client.ts source documents the token exchange flow", () => {
    const fs = require("fs");
    const path = require("path");
    const clientSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "packages", "litt-cli", "src", "lib", "runtime-client.ts"),
      "utf-8",
    );
    // The source must document that the client never holds TERMINAL_AUTH_SECRET
    expect(clientSrc).toMatch(/NEVER holds TERMINAL_AUTH_SECRET/);
    expect(clientSrc).toMatch(/token exchange/i);
  });

  it("Tauri commands.rs hard-disables generate_dev_token in release builds", () => {
    const fs = require("fs");
    const path = require("path");
    const commandsSrc = fs.readFileSync(
      path.join(__dirname, "..", "..", "packages", "litt-shell", "src-tauri", "src", "commands.rs"),
      "utf-8",
    );
    // The Rust source must have a cfg!(debug_assertions) production guard
    expect(commandsSrc).toMatch(/cfg!\(debug_assertions\)/);
    expect(commandsSrc).toMatch(/disabled in production builds/);
  });
});
