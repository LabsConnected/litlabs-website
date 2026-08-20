/**
 * /internal/sessions HTTP integration tests.
 *
 * Tests actual HTTP behavior of the internal sessions endpoint:
 *   - missing TERMINAL_INTERNAL_SERVICE_KEY → 503
 *   - missing request header → 401
 *   - incorrect key → 401
 *   - correct key → 200
 *   - response only contains safe session snapshot fields
 *   - response never exposes PTY handles, env vars, credentials, etc.
 *
 * Uses supertest to test the actual Express middleware + handler
 * without starting a real TCP server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PtySessionManager } from "../pty-session-manager.js";
import { requireInternalServiceAuth } from "../internal-auth.js";

// ─── Constants ────────────────────────────────────────────────────

const VALID_KEY = "a".repeat(32); // 32+ char service key
const WRONG_KEY = "b".repeat(32);

// ─── Mock factory (minimal — just needs to create sessions) ───────

function createNoOpFactory() {
  const noOpHandle = {
    write: () => {},
    resize: () => {},
    kill: () => {},
  };
  return {
    spawnHost: () => noOpHandle,
    spawnDocker: () => noOpHandle,
  };
}

// ─── Test app builder ─────────────────────────────────────────────

function createTestApp(ptyManager: PtySessionManager): express.Application {
  const app = express();
  app.get("/internal/sessions", requireInternalServiceAuth, (_req, res) => {
    const sessions = ptyManager.snapshot();
    res.json({ sessions });
  });
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("GET /internal/sessions HTTP integration", () => {
  let app: express.Application;
  let ptyManager: PtySessionManager;
  let tempRoot: string;
  let originalKey: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "pty-http-test-"));
    originalKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    ptyManager = new PtySessionManager({}, createNoOpFactory() as any);
    app = createTestApp(ptyManager);
  });

  afterEach(() => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = originalKey;
    ptyManager.shutdown();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // ─── 503: key not configured ────────────────────────────────────

  it("returns 503 when TERMINAL_INTERNAL_SERVICE_KEY is not configured", async () => {
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    const res = await request(app).get("/internal/sessions");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  // ─── 401: missing header ────────────────────────────────────────

  it("returns 401 when X-Internal-Service-Key header is missing", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = VALID_KEY;
    const res = await request(app).get("/internal/sessions");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  // ─── 401: incorrect key ─────────────────────────────────────────

  it("returns 401 when X-Internal-Service-Key header is incorrect", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = VALID_KEY;
    const res = await request(app)
      .get("/internal/sessions")
      .set("X-Internal-Service-Key", WRONG_KEY);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  // ─── 200: correct key ───────────────────────────────────────────

  it("returns 200 with session list when key is correct", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = VALID_KEY;
    ptyManager.create({
      userId: "user-1",
      projectId: "proj-1",
      workspaceId: "ws-1",
      cwd: tempRoot,
      allowedRoot: tempRoot,
      useDocker: false,
      onData: () => {},
      onExit: () => {},
    });
    const res = await request(app)
      .get("/internal/sessions")
      .set("X-Internal-Service-Key", VALID_KEY);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(1);
    expect(res.body.sessions[0].userId).toBe("user-1");
  });

  // ─── Safe shape: only allowed fields ────────────────────────────

  it("response contains only safe session snapshot fields", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = VALID_KEY;
    ptyManager.create({
      userId: "user-1",
      projectId: "proj-1",
      workspaceId: "ws-1",
      cwd: tempRoot,
      allowedRoot: tempRoot,
      useDocker: false,
      onData: () => {},
      onExit: () => {},
    });
    const res = await request(app)
      .get("/internal/sessions")
      .set("X-Internal-Service-Key", VALID_KEY);
    expect(res.status).toBe(200);
    const snap = res.body.sessions[0];
    const allowedKeys = new Set([
      "sessionId", "userId", "projectId", "workspaceId",
      "cwd", "shell", "createdAt", "lastActivityAt",
      "exited", "exitCode",
    ]);
    for (const key of Object.keys(snap)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  // ─── No sensitive fields leaked ─────────────────────────────────

  it("response never exposes PTY handles, env vars, credentials, or callbacks", async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = VALID_KEY;
    ptyManager.create({
      userId: "user-1",
      projectId: "proj-1",
      workspaceId: "ws-1",
      cwd: tempRoot,
      allowedRoot: tempRoot,
      useDocker: false,
      onData: () => {},
      onExit: () => {},
    });
    const res = await request(app)
      .get("/internal/sessions")
      .set("X-Internal-Service-Key", VALID_KEY);
    expect(res.status).toBe(200);
    const snap = res.body.sessions[0];
    const forbiddenKeys = [
      "handle", "ptyProcess", "idleTimer", "lifetimeTimer",
      "env", "environment", "secret", "key", "token", "password",
      "onData", "onExit", "onOutputDropped",
      "totalOutputDelivered", "totalOutputDropped", "outputBuffered",
      "process", "pid", "stdin", "stdout", "stderr",
    ];
    const actualKeys = Object.keys(snap);
    for (const forbidden of forbiddenKeys) {
      expect(actualKeys).not.toContain(forbidden);
    }
  });
});
