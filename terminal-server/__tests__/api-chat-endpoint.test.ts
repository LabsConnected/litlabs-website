/**
 * /api/chat endpoint authentication, workspace isolation, NDJSON streaming,
 * and error-path tests.
 *
 * Tests the security and streaming contract of the managed-key chat endpoint:
 *   - Missing auth → 401
 *   - Invalid terminal token → 401
 *   - Missing message body → 400
 *   - Empty message → 400
 *   - Valid token + no workspace → workspace_required error
 *   - Valid token + workspace belonging to another user → 403
 *   - Valid token + valid workspace → NDJSON stream (meta/delta/done)
 *   - Server error mid-stream → NDJSON error event
 *   - userId comes from JWT, not request body
 *
 * Uses the same mock patterns as api-command-auth.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";
import { mintTerminalToken, verifyTerminalToken, bearerToken } from "../auth.js";
import type { AuthenticatedRequest } from "../internal-auth.js";
import type { LiTTEvent } from "../litt-code.js";
import type { BillingClient, AuthorizationResult } from "../billing.js";

// ─── Constants ────────────────────────────────────────────────────

const VALID_SECRET = "s".repeat(32);

// ─── Terminal JWT minting ─────────────────────────────────────────

function mintServerToken(
  userId: string,
  secret: string = VALID_SECRET,
  options: { exp?: number; aud?: string; wid?: string; cwd?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: userId,
    aud: options.aud ?? "littree-terminal",
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

// ─── Mock workspace store ─────────────────────────────────────────

interface MockWorkspace {
  workspaceId: string;
  userId: string;
  root: string;
  status: "ready" | "initializing" | "error";
}

const mockWorkspaces = new Map<string, MockWorkspace>();

function resetMockWorkspaces(): void {
  mockWorkspaces.clear();
}

function addMockWorkspace(ws: MockWorkspace): void {
  mockWorkspaces.set(ws.workspaceId, ws);
}

// ─── Mock streamLiTTOperator ──────────────────────────────────────

const mockStreamFn = vi.fn();

vi.mock("../litt-agent.js", () => ({
  streamLiTTOperator: (...args: unknown[]) => mockStreamFn(...args),
}));

// ─── Test app builder (mirrors the real /api/chat handler) ────────

function billingDenialStatus(code: string | undefined): number {
  switch (code) {
    case "unauthenticated":
    case "user_not_found":
      return 401;
    case "plan_not_entitled":
      return 403;
    case "insufficient_credits":
      return 402;
    default:
      return 503;
  }
}

/** Billing client that authorizes everyone — the default for these tests. */
function allowAllBilling(): BillingClient {
  return {
    async authorize(clerkId) {
      return {
        ok: true,
        identity: { internalUserId: "internal-1", clerkId: clerkId ?? "u", planId: "owner" },
      };
    },
    async recordUsage() {
      return { recorded: true, debited: true, replayed: false, balanceAfter: 100, costBits: 1 };
    },
  };
}

/** Billing client that denies with a fixed result. */
function denyingBilling(result: AuthorizationResult): BillingClient {
  return {
    async authorize() {
      return result;
    },
    async recordUsage() {
      return { recorded: false, debited: false, replayed: false, balanceAfter: null, costBits: 0 };
    },
  };
}

let getBillingClient: () => BillingClient;

function createTestApp(): express.Application {
  const app = express();
  app.use(express.json());

  app.post("/api/chat", async (req: AuthenticatedRequest, res) => {
    // 1. Verify user JWT
    let userId: string;
    let payload: { sub: string; wid?: string; cwd?: string };
    try {
      const token = bearerToken(req.headers.authorization);
      payload = verifyTerminalToken(token);
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: "Unauthorized — valid terminal token required" });
      return;
    }

    // 2. Validate request body
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "Missing 'message' field" });
      return;
    }

    // 3. Billing gate — the SAME check the real handler runs. /api/chat
    // streams the server's managed OPENROUTER_API_KEY, so without this it
    // is a free, ungated entry point into model execution.
    const authz = await getBillingClient().authorize(userId);
    if (!authz.ok) {
      res.status(billingDenialStatus(authz.code)).json({
        error: { code: authz.code, message: authz.message ?? "Not authorized." },
      });
      return;
    }

    // 4. Resolve workspace cwd
    let cwd: string;
    if (payload.wid) {
      const ws = mockWorkspaces.get(payload.wid);
      if (!ws || ws.userId !== userId) {
        res.status(403).json({ error: { code: "workspace_unauthorized", message: "Workspace access denied" } });
        return;
      }
      cwd = ws.root;
    } else if (payload.cwd) {
      cwd = payload.cwd;
    } else {
      // Auto-select if exactly one ready workspace
      const userWorkspaces = Array.from(mockWorkspaces.values()).filter(
        (w) => w.userId === userId && w.status === "ready",
      );
      if (userWorkspaces.length === 0) {
        res.status(400).json({ error: { code: "workspace_required", message: "No ready workspace — create one first" } });
        return;
      }
      if (userWorkspaces.length > 1) {
        res.status(400).json({ error: { code: "workspace_selection_required", message: "Multiple workspaces — specify which one" } });
        return;
      }
      cwd = userWorkspaces[0].root;
    }

    // 5. Stream NDJSON
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const writeEvent = (event: LiTTEvent) => {
      res.write(JSON.stringify(event) + "\n");
    };

    try {
      const { streamLiTTOperator } = await import("../litt-agent.js");
      await streamLiTTOperator(message, cwd, writeEvent);
      res.end();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "LiTT chat failed";
      if (!res.headersSent) {
        res.status(500).json({ error: errorMsg });
      } else {
        writeEvent({ type: "error", message: errorMsg });
        res.end();
      }
    }
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("/api/chat endpoint", () => {
  let oldAuthSecret: string | undefined;
  let setBilling: (c: BillingClient) => void;

  beforeEach(() => {
    oldAuthSecret = process.env.TERMINAL_AUTH_SECRET;
    process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
    resetMockWorkspaces();
    mockStreamFn.mockReset();
    // Default: billing authorizes. Denial cases override per-test.
    let billing = allowAllBilling();
    getBillingClient = () => billing;
    setBilling = (c: BillingClient) => {
      billing = c;
    };
  });

  afterEach(() => {
    if (oldAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
    else process.env.TERMINAL_AUTH_SECRET = oldAuthSecret;
    vi.clearAllMocks();
  });

  // ─── Authentication ────────────────────────────────────────────

  it("returns 401 when Authorization header is missing", async () => {
    const app = createTestApp();
    const res = await request(app).post("/api/chat").send({ message: "hello" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Unauthorized/);
  });

  it("returns 401 when terminal token has bad signature", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintBadSignatureToken("alice")}`)
      .send({ message: "hello" });
    expect(res.status).toBe(401);
  });

  it("returns 401 when terminal token is expired", async () => {
    const app = createTestApp();
    const expiredToken = mintServerToken("alice", VALID_SECRET, {
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${expiredToken}`)
      .send({ message: "hello" });
    expect(res.status).toBe(401);
  });

  // ─── Body validation ───────────────────────────────────────────

  it("returns 400 when message field is missing", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing.*message/);
  });

  it("returns 400 when message is empty string", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "   " });
    expect(res.status).toBe(400);
  });

  // ─── Workspace isolation ───────────────────────────────────────

  it("returns workspace_required when no workspaces exist for user", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("workspace_required");
  });

  it("returns workspace_selection_required when multiple ready workspaces exist", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    addMockWorkspace({ workspaceId: "ws2", userId: "alice", root: "/data/ws2", status: "ready" });
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe("workspace_selection_required");
  });

  it("returns 403 when workspace belongs to another user", async () => {
    addMockWorkspace({ workspaceId: "ws-bob", userId: "bob", root: "/data/bob", status: "ready" });
    const app = createTestApp();
    // Alice tries to use Bob's workspace via signed claim
    const aliceToken = mintServerToken("alice", VALID_SECRET, { wid: "ws-bob" });
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${aliceToken}`)
      .send({ message: "hello" });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("workspace_unauthorized");
  });

  it("auto-selects the single ready workspace for the user", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    mockStreamFn.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });

    expect(res.status).toBe(200);
    expect(mockStreamFn).toHaveBeenCalledOnce();
    // The cwd passed to streamLiTTOperator should be the workspace root
    const [, cwd] = mockStreamFn.mock.calls[0];
    expect(cwd).toBe("/data/ws1");
  });

  it("uses signed workspace claim from JWT when present", async () => {
    addMockWorkspace({ workspaceId: "ws-alice", userId: "alice", root: "/data/alice", status: "ready" });
    mockStreamFn.mockResolvedValue(undefined);

    const app = createTestApp();
    const token = mintServerToken("alice", VALID_SECRET, { wid: "ws-alice", cwd: "/data/alice" });
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "hello" });

    expect(res.status).toBe(200);
    const [, cwd] = mockStreamFn.mock.calls[0];
    expect(cwd).toBe("/data/alice");
  });

  // ─── NDJSON streaming ──────────────────────────────────────────

  it("streams NDJSON events (meta, delta, done) in order", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    mockStreamFn.mockImplementation(
      async (_msg: string, _cwd: string, emit: (e: LiTTEvent) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test-model", profile: "smart" });
        emit({ type: "delta", text: "Hello " });
        emit({ type: "delta", text: "world" });
        emit({
          type: "done",
          model: "test-model",
          usage: { total_tokens: 10 },
          timing: { ttftMs: 100, generationMs: 200, totalMs: 300 },
        });
      },
    );

    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("x-ndjson");

    const lines = res.text.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(4);
    expect(lines[0].type).toBe("meta");
    expect(lines[0].model).toBe("test-model");
    expect(lines[1].type).toBe("delta");
    expect(lines[1].text).toBe("Hello ");
    expect(lines[2].type).toBe("delta");
    expect(lines[2].text).toBe("world");
    expect(lines[3].type).toBe("done");
    expect(lines[3].usage.total_tokens).toBe(10);
  });

  it("emits NDJSON error event when streamLiTTOperator throws mid-stream", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    mockStreamFn.mockImplementation(
      async (_msg: string, _cwd: string, emit: (e: LiTTEvent) => void) => {
        emit({ type: "meta", provider: "openrouter", model: "test-model", profile: "smart" });
        emit({ type: "delta", text: "partial" });
        throw new Error("Model API went down");
      },
    );

    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });

    expect(res.status).toBe(200);
    const lines = res.text.trim().split("\n").map((l) => JSON.parse(l));
    // Should have meta, delta, then error
    const errorEvent = lines.find((l) => l.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toContain("Model API went down");
  });

  it("returns 500 JSON when error occurs before any data is written", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    // Simulate streamLiTTOperator throwing immediately (before any emit)
    mockStreamFn.mockRejectedValue(new Error("Immediate failure"));

    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello" });

    // Headers are set via res.setHeader but not flushed until res.write().
    // If the operator rejects before any emit(), res.write() is never called,
    // so res.headersSent is false, and the handler sends a 500 JSON response.
    expect(res.status).toBe(500);
    // The error message should be in the response body
    const body = res.body?.error ?? res.text;
    expect(body).toContain("Immediate failure");
  });

  // ─── userId isolation ──────────────────────────────────────────

  it("derives userId from JWT, not from request body", async () => {
    addMockWorkspace({ workspaceId: "ws1", userId: "alice", root: "/data/ws1", status: "ready" });
    mockStreamFn.mockResolvedValue(undefined);

    const app = createTestApp();
    // Alice's token, but body tries to impersonate bob
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("alice")}`)
      .send({ message: "hello", userId: "bob" });

    expect(res.status).toBe(200);
    // The workspace auto-selection used alice's userId, not bob's
    const [, cwd] = mockStreamFn.mock.calls[0];
    expect(cwd).toBe("/data/ws1"); // alice's workspace, not bob's
  });

  // ─── Billing gate ──────────────────────────────────────────────
  //
  // Regression: /api/chat streams the server's MANAGED OpenRouter key.
  // It must run the same billing.ts entitlement/credit check as
  // /api/command's ask path and the Socket.IO model relay — otherwise
  // it is a free, ungated entry point into model execution.
  //
  // The denial STATUS matters as much as the denial: the CLI falls back
  // to status when no typed code is present, and answering "no credits"
  // with a 401 makes a valid session look revoked.

  const DENIALS = [
    { code: "billing_unavailable", status: 503, message: "Billing service unavailable" },
    { code: "plan_not_entitled", status: 403, message: "Your plan does not include LiTT CLI access." },
    { code: "insufficient_credits", status: 402, message: "Insufficient LiTTBits balance." },
    { code: "user_not_found", status: 401, message: "No account found for this identity." },
  ] as const;

  for (const { code, status, message } of DENIALS) {
    it(`denies with HTTP ${status} and code ${code}, and never calls the model`, async () => {
      setBilling(denyingBilling({ ok: false, code, message }));
      const app = createTestApp();
      const res = await request(app)
        .post("/api/chat")
        .set("Authorization", `Bearer ${mintServerToken("user-1", VALID_SECRET, { cwd: "/tmp/ws" })}`)
        .send({ message: "hello" });

      expect(res.status).toBe(status);
      expect(res.body.error?.code).toBe(code);
      expect(res.body.error?.message).toBe(message);
      // The load-bearing assertion: the provider was never reached.
      expect(mockStreamFn).not.toHaveBeenCalled();
    });
  }

  it("authorized requests still reach the model", async () => {
    mockStreamFn.mockImplementation(
      async (_msg: string, _cwd: string, write: (e: LiTTEvent) => void) => {
        write({ type: "delta", text: "hi" });
      },
    );
    const app = createTestApp();
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", `Bearer ${mintServerToken("user-1", VALID_SECRET, { cwd: "/tmp/ws" })}`)
      .send({ message: "hello" });

    expect(res.status).toBe(200);
    expect(mockStreamFn).toHaveBeenCalled();
  });
});
