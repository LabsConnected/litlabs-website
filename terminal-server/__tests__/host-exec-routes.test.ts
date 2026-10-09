/**
 * Route-level regression tests: blocked host execution is reported
 * consistently as HTTP 503 HOST_EXECUTION_DISABLED, never as a 200 `ok:false`
 * response, and non-execution commands keep working.
 *
 * The routes below use the REAL dispatchCommand → registry → handlers and
 * the REAL respondWithDispatch helper that server.ts uses for /api/command
 * and /internal/command. No command is ever executed: in a production-like
 * environment the handlers refuse before any executor is constructed, and
 * child_process / simple-git are mocked as a tripwire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const m = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
  simpleGit: vi.fn(),
}));

vi.mock("child_process", async (orig) => {
  const actual = await orig<typeof import("child_process")>();
  return { ...actual, execFile: m.execFile, execFileSync: m.execFileSync, spawn: m.spawn };
});
vi.mock("simple-git", () => ({ simpleGit: m.simpleGit }));
vi.mock("../workspace/WorkspaceManager", () => ({
  getWorkspaceRoot: () => null,
  getWorkspace: () => undefined,
}));

import { dispatchCommand } from "../command-bridge";
import { respondWithDispatch, respondIfHostExecBlocked } from "../host-exec-http";
import { HostExecutionBlockedError } from "../isolation-policy";

const RAILWAY_KEYS = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;

function asEnvironment(kind: "production" | "railway" | "development") {
  vi.unstubAllEnvs();
  for (const key of RAILWAY_KEYS) vi.stubEnv(key, "");
  vi.stubEnv("NODE_ENV", kind === "production" ? "production" : "development");
  if (kind === "railway") vi.stubEnv("RAILWAY_SERVICE_ID", "svc_1");
}

/** Same wiring as server.ts: dispatchCommand + respondWithDispatch. */
function buildApp() {
  const app = express();
  app.use(express.json());
  for (const path of ["/api/command", "/internal/command"]) {
    app.post(path, async (req, res) => {
      await respondWithDispatch(res, () =>
        dispatchCommand({
          command: req.body.command,
          args: req.body.args ?? [],
          userId: "user_1",
        } as never),
      );
    });
  }
  return app;
}

function expectNothingSpawned() {
  expect(m.execFile).not.toHaveBeenCalled();
  expect(m.execFileSync).not.toHaveBeenCalled();
  expect(m.spawn).not.toHaveBeenCalled();
  expect(m.simpleGit).not.toHaveBeenCalled();
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

const EXEC_COMMANDS: Array<{ command: string; args?: string[] }> = [
  { command: "status" },
  { command: "diff" },
  { command: "check" },
  { command: "build" },
  { command: "test" },
  { command: "git", args: ["status"] },
  { command: "do", args: ["ls", "-la"] },
];

describe.each(["/api/command", "/internal/command"])("POST %s", (path) => {
  describe.each(["production", "railway"] as const)("in a %s environment", (kind) => {
    beforeEach(() => asEnvironment(kind));

    it.each(EXEC_COMMANDS)("returns 503 HOST_EXECUTION_DISABLED for $command", async (body) => {
      const res = await request(buildApp()).post(path).send(body);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("HOST_EXECUTION_DISABLED");
      expect(res.body.error).toMatch(/disabled in production/);
      expectNothingSpawned();
    });

    it("does not disrupt non-execution commands", async () => {
      const res = await request(buildApp()).post(path).send({ command: "help" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expectNothingSpawned();
    });

    it("keeps usage errors for /do with no arguments as a normal 200 response", async () => {
      const res = await request(buildApp()).post(path).send({ command: "do" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.code).toBeUndefined();
    });
  });

  it("keeps unknown-command errors as 200 ok:false (not a 503)", async () => {
    asEnvironment("production");
    const res = await request(buildApp()).post(path).send({ command: "definitely-not-a-command" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});

describe("respondWithDispatch", () => {
  it("maps only HostExecutionBlockedError to 503; other errors stay 500", async () => {
    const app = express();
    app.get("/blocked", (_req, res) =>
      respondWithDispatch(res, async () => {
        throw new HostExecutionBlockedError("test.surface");
      }),
    );
    app.get("/boom", (_req, res) =>
      respondWithDispatch(res, async () => {
        throw new Error("boom");
      }),
    );
    const blocked = await request(app).get("/blocked");
    expect(blocked.status).toBe(503);
    expect(blocked.body.code).toBe("HOST_EXECUTION_DISABLED");
    const boom = await request(app).get("/boom");
    expect(boom.status).toBe(500);
    expect(boom.body.error).toBe("boom");
    expect(boom.body.code).toBeUndefined();
  });

  it("respondIfHostExecBlocked ignores unrelated errors", () => {
    const res = { status: vi.fn(), json: vi.fn() } as never;
    expect(respondIfHostExecBlocked(new Error("x"), res)).toBe(false);
  });
});

// ─── /internal/workspace/:id/exec and operator wiring ───────────────
// These live inside server.ts / litt-operator.ts, which cannot be imported
// without booting the server and model providers. Their guarantees are
// asserted from source order instead; this is weaker than an HTTP test and
// is reported as such.

describe("source-order assertions for paths that cannot be mounted", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const server = readFileSync(join(dir, "server.ts"), "utf-8");
  const operator = readFileSync(join(dir, "litt-operator.ts"), "utf-8");

  it("/internal/workspace/:id/exec refuses before the gateway is consulted and maps to 503", () => {
    const start = server.indexOf('app.post("/internal/workspace/:workspaceId/exec"');
    const end = server.indexOf("// ─── Internal Preview Endpoints", start);
    const handler = server.slice(start, end);
    const assertAt = handler.indexOf('assertHostExecutionPermitted("workspace.exec")');
    const gatewayAt = handler.indexOf("const gateway = getExecutionGateway(");
    expect(assertAt).toBeGreaterThan(-1);
    expect(gatewayAt).toBeGreaterThan(assertAt);
    expect(handler).toContain("respondIfHostExecBlocked(err, res)");
  });

  it("operator output states plainly that execution is disabled", () => {
    expect(operator).toContain("EXECUTION_DISABLED_NOTICE_FOR_MODEL");
    expect(operator).toMatch(/execClosed && result\.toolCalls\.length > 0/);
    expect(operator).toContain("EXECUTION_DISABLED_NOTICE_FOR_USER");
  });
});
