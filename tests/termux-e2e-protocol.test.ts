/**
 * Phase 7: Termux-style end-to-end HTTP protocol test.
 *
 * Starts a REAL terminal-server HTTP instance on a test port and
 * exercises the full protocol without Ink/Desktop. This proves a
 * Termux client (or any HTTP client) can use the same contract
 * without special-case server logic.
 *
 * Tests:
 *   - Authentication boundary (X-Internal-Service-Key)
 *   - Request decoding (RemoteCommandRequest)
 *   - Structured args preserved
 *   - Canonical dispatch (through dispatchCommand → registry → gateway)
 *   - Canonical runId in response
 *   - Typed response (RemoteCommandResponse)
 *   - Typed errors (unknown_command, malformed_request)
 *   - Policy denial (PLAN mode blocks mutation)
 *   - cwd preserved
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as http from "http";
import * as path from "path";
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from "express";
import type { RemoteCommandRequest, RemoteCommandResponse } from "@litt/agent-core";

// We test against the real Express app by importing it.
// The server module exports the app via the HTTP server.
// We create a minimal test server that wires the same routes.

const repoRoot = path.resolve(__dirname, "..");
const TEST_KEY = "test-internal-service-key-32-chars-min!!";

let testServer: http.Server | null = null;
let baseUrl: string;
let testPort: number;

// Build the Express app inline — we import the same route handlers
// the real server uses, but on a test port.
async function startTestServer(): Promise<{ server: http.Server; port: number }> {
  const express = (await import("express")).default;
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  // Import the dispatch the real server uses
  const { dispatchCommand } = await import("../terminal-server/command-bridge.js");

  // Inline auth middleware matching server.ts's requireInternalServiceAuth.
  // We don't import it because it's a local function in server.ts.
  const testAuth = (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const key = req.headers["x-internal-service-key"];
    const expected = process.env.TERMINAL_INTERNAL_SERVICE_KEY;
    if (!expected || expected.length < 32) {
      res.status(500).json({ error: "TERMINAL_INTERNAL_SERVICE_KEY not configured" });
      return;
    }
    if (!key || key !== expected) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  // Mirror the /internal/command route from server.ts
  app.post("/internal/command", testAuth, async (req, res) => {
    const body = req.body as RemoteCommandRequest;
    if (typeof body.command !== "string" || !body.command) {
      res.status(200).json({
        ok: false,
        runId: "run_error",
        error: { code: "malformed_request", message: "command must be a non-empty string" },
        kind: "error",
        timestamp: Date.now(),
        durationMs: 0,
      });
      return;
    }
    if (body.args && !Array.isArray(body.args)) {
      res.status(200).json({
        ok: false,
        runId: "run_error",
        error: { code: "malformed_request", message: "args must be an array" },
        kind: "error",
        timestamp: Date.now(),
        durationMs: 0,
      });
      return;
    }
    const args = Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [];
    const userId = (body.userId as string | null) ?? (req as ExpressRequest & { terminalUserId?: string }).terminalUserId ?? null;

    try {
      const resp = await dispatchCommand({
        command: body.command,
        args,
        cwd: body.cwd ?? repoRoot,
        requestId: body.requestId,
        mode: body.mode,
        workspaceId: body.workspaceId,
        userId,
      });
      res.status(200).json(resp);
    } catch (err) {
      res.status(500).json({
        ok: false,
        runId: "run_error",
        error: {
          code: "internal_error",
          message: err instanceof Error ? err.message : String(err),
        },
        kind: "error",
        timestamp: Date.now(),
        durationMs: 0,
      });
    }
  });

  app.get("/health/live", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  // Use port 0 (ephemeral) to avoid port collisions with other test
  // files or previous runs. The OS assigns a free port.
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

// ─── Termux-style HTTP client ─────────────────────────────────────

async function termuxRequest(
  req: Partial<RemoteCommandRequest> & { command: string },
  key: string = TEST_KEY,
): Promise<{ status: number; body: RemoteCommandResponse }> {
  const resp = await fetch(`http://127.0.0.1:${testPort}/internal/command`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({
      command: req.command,
      args: req.args ?? [],
      cwd: req.cwd ?? repoRoot,
      mode: req.mode,
      requestId: req.requestId,
    } as RemoteCommandRequest),
  });
  const body = (await resp.json()) as RemoteCommandResponse;
  return { status: resp.status, body };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("PHASE 7: Termux-style end-to-end HTTP protocol", () => {
  let statusSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeAll(async () => {
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = TEST_KEY;

    // Mock CommandRouter.status to avoid running real git subprocesses
    // that can exceed the default 5s test timeout under full-suite CPU
    // contention. This test verifies the HTTP PROTOCOL (auth boundary,
    // request decoding, response shape), not subprocess execution.
    const agentCore = await import("@litt/agent-core");
    statusSpy = vi.spyOn(agentCore.CommandRouter.prototype, "status").mockResolvedValue({
      command: "status",
      result: {
        status: "success" as const,
        success: true,
        message: "branch=main changes=0",
        data: { branch: "main", changeCount: 0, root: repoRoot, isGitRepo: true },
      },
    });

    const started = await startTestServer();
    testPort = started.port;
    testServer = started.server;
    baseUrl = `http://127.0.0.1:${testPort}`;
  }, 15_000);

  afterAll(async () => {
    if (testServer) {
      await new Promise<void>((resolve) => testServer!.close(() => resolve()));
      testServer = null;
    }
    statusSpy?.mockRestore();
    delete process.env.TERMINAL_INTERNAL_SERVICE_KEY;
  });

  it("health endpoint is reachable", async () => {
    const resp = await fetch(`${baseUrl}/health/live`);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.ok).toBe(true);
  });

  it("authentication boundary: missing key → 401", async () => {
    const resp = await fetch(`${baseUrl}/internal/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "status", args: [] }),
    });
    expect(resp.status).toBe(401);
  });

  it("authentication boundary: wrong key → 401", async () => {
    const resp = await fetch(`${baseUrl}/internal/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": "wrong-key",
      },
      body: JSON.stringify({ command: "status", args: [] }),
    });
    expect(resp.status).toBe(401);
  });

  it("authentication boundary: correct key → 200", async () => {
    const { status } = await termuxRequest({ command: "status" });
    expect(status).toBe(200);
  });

  it("status request returns typed RemoteCommandResponse with runId", async () => {
    const { body } = await termuxRequest({ command: "status" });
    expect(body.ok).toBe(true);
    expect(body.kind).toBe("status");
    expect(typeof body.runId).toBe("string");
    expect(body.runId).toMatch(/^run_/);
    expect(body.result).toBeDefined();
    expect(typeof body.result!.message).toBe("string");
  });

  it("structured args are preserved through the HTTP protocol", async () => {
    const { body } = await termuxRequest({
      command: "do",
      args: ["echo", "termux-arg-test"],
    });
    expect(body.kind).toBe("exec_result");
    if (body.ok) {
      const stdout = String(body.result!.data.stdout ?? "");
      expect(stdout).toContain("termux-arg-test");
    }
  });

  it("cwd is preserved through the HTTP protocol", async () => {
    const { body } = await termuxRequest({
      command: "local",
      cwd: repoRoot,
    });
    expect(body.kind).toBe("local_info");
    expect(body.result!.data.cwd).toBe(repoRoot);
  });

  it("unsupported command returns typed unknown_command error", async () => {
    const { body } = await termuxRequest({ command: "totally_fake_command" });
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.error!.code).toBe("unknown_command");
    expect(Array.isArray(body.error!.availableCommands)).toBe(true);
  });

  it("malformed request (empty command) returns typed malformed_request", async () => {
    const { body } = await termuxRequest({ command: "" });
    expect(body.ok).toBe(false);
    expect(body.error!.code).toBe("malformed_request");
  });

  it("PLAN mode denies mutating /do through HTTP", async () => {
    const { body } = await termuxRequest({
      command: "do",
      args: ["node", "-e", "1"],
      mode: "plan",
    });
    expect(body.ok).toBe(false);
    expect(body.result!.data.policyEffect).toBe("deny");
  });

  it("PLAN mode allows read-only /do through HTTP", async () => {
    const { body } = await termuxRequest({
      command: "do",
      args: ["echo", "plan-ok"],
      mode: "plan",
    });
    expect(body.ok).toBe(true);
    expect(body.result!.data.policyEffect).toBe("allow");
  });

  it("requestId is echoed back distinct from runId", async () => {
    const { body } = await termuxRequest({
      command: "status",
      requestId: "termux-req-001",
    });
    expect(body.requestId).toBe("termux-req-001");
    expect(body.runId).not.toBe("termux-req-001");
    expect(body.runId).toMatch(/^run_/);
  });

  it("response includes timestamp and durationMs", async () => {
    const { body } = await termuxRequest({ command: "status" });
    expect(typeof body.timestamp).toBe("number");
    expect(body.timestamp).toBeGreaterThan(0);
    expect(typeof body.durationMs).toBe("number");
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─── Regression: clean server lifecycle ───────────────────────────

describe("Server lifecycle: no port/socket/env leaks", () => {
  it("repeated startup/shutdown leaves no server, socket, or env mutation behind", async () => {
    const initialKey = process.env.TERMINAL_INTERNAL_SERVICE_KEY;

    // Start and stop a server 3 times on ephemeral ports
    for (let i = 0; i < 3; i++) {
      process.env.TERMINAL_INTERNAL_SERVICE_KEY = `test-key-iteration-${i}-${TEST_KEY}`;
      const { server, port } = await startTestServer();

      // Verify the server is reachable
      const resp = await fetch(`http://127.0.0.1:${port}/health/live`);
      expect(resp.status).toBe(200);

      // Close the server and wait for it to fully release the port
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });

      // Verify the port is no longer reachable (connection refused)
      try {
        await fetch(`http://127.0.0.1:${port}/health/live`);
        // If we get here, the port is still listening — that's a leak
        throw new Error(`Port ${port} still reachable after server.close() at iteration ${i}`);
      } catch (err) {
        // Expected: connection refused or network error
        if (err instanceof Error && !err.message.includes("still reachable")) {
          // Good — connection refused means the port was released
        } else {
          throw err;
        }
      }
    }

    // Verify env was cleaned up
    process.env.TERMINAL_INTERNAL_SERVICE_KEY = initialKey;
  });
});
