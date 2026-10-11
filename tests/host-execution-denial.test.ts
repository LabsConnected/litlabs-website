/**
 * Behavioral denial tests for host-execution guards.
 *
 * The static inventory test (host-execution-inventory.test.ts) verifies the
 * guard code EXISTS in source. These tests verify the guards actually DENY
 * execution at runtime: route handlers are mounted with various
 * environments and must return 503 HOST_EXECUTION_DISABLED without
 * spawning any process — unless the environment is explicitly opted in with
 * verified isolation (development only).
 *
 * Default-deny contract:
 * - No markers, no opt-in → 503 (even in development)
 * - NODE_ENV=development alone → 503 (dev is not authorization)
 * - Opt-in without verified isolation → 503
 * - Production + opt-in + verified → 503 (opt-in impossible in production)
 * - Dev + opt-in + verified isolation → allowed (200, may spawn)
 *
 * Reconciled from Muse c3a71ead/f904baa8: adapted to the combined contract
 * (two-key opt-in + loopback bind + direct-request check, NODE_ENV dev/test).
 *
 * Run: npx vitest run tests/host-execution-denial.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { EventEmitter } from "events";

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/roles", () => ({ isAdmin: vi.fn() }));

// child_process mock: if any route under test spawns a process, this
// records it so the test can assert NOTHING was spawned.
const { spawnMock, execFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileMock: vi.fn(),
}));
vi.mock("child_process", () => {
  const mocked = { spawn: spawnMock, execFile: execFileMock };
  return { ...mocked, default: mocked };
});

import { auth } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import {
  HOST_EXECUTION_DISABLED_CODE,
  LOCAL_EXECUTION_OPT_IN_VAR,
  ISOLATION_VERIFIED_VAR,
} from "@/lib/host-execution-guard";

const mockAuth = vi.mocked(auth);
const mockIsAdmin = vi.mocked(isAdmin);

const ADMIN_ID = "admin_user_1";

/** Make the guard see a production-like env without touching read-only NODE_ENV. */
function productionEnv() {
  vi.stubEnv("RAILWAY_PROJECT_ID", "test-production-marker");
}

/** Opt in to local execution (dev only). Does NOT work in production. */
function optInDev() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv(LOCAL_EXECUTION_OPT_IN_VAR, "true");
  vi.stubEnv(ISOLATION_VERIFIED_VAR, "true");
  vi.stubEnv("LITT_RESOLVED_BIND_HOST", "127.0.0.1");
}

/** Every request carries a loopback Host, as a direct browser request would. */
function req(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(url, { ...init, headers: { host: "localhost:3001", ...(init.headers ?? {}) } });
}

/** Opt in without asserting verified isolation. */
function optInWithoutVerification() {
  vi.stubEnv(LOCAL_EXECUTION_OPT_IN_VAR, "true");
}

function makeFakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn> };
    stdout: { on: ReturnType<typeof vi.fn> };
    stderr: { on: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = { write: vi.fn() };
  proc.stdout = { on: vi.fn() };
  proc.stderr = { on: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

describe("default denial: bridge/cli", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_USER_ID", ADMIN_ID);
    mockAuth.mockReset();
    mockIsAdmin.mockReset();
    spawnMock.mockReset();
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET returns 503 and spawns nothing with no opt-in (default deny)", async () => {
    // No production markers, no opt-in: default-deny applies.
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal"),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("GET returns 503 in production (admin auth)", async () => {
    productionEnv();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal"),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("POST returns 503 in production even with opt-in keys (opt-in impossible in prod)", async () => {
    productionEnv();
    optInDev();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);

    const { POST } = await import("@/app/api/bridge/cli/route");
    const res = await POST(
      req("http://localhost/api/bridge/cli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "x", type: "input", input: "echo hi" }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("GET returns 503 with opt-in but no verified isolation", async () => {
    optInWithoutVerification();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal"),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("allows execution ONLY with explicit opt-in + verified isolation (dev)", async () => {
    optInDev();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal"),
    );

    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("denies a proxied request even when fully opted in and loopback-bound", async () => {
    optInDev();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal", { headers: { "x-forwarded-for": "203.0.113.9" } }),
    );

    expect(res.status).toBe(503);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("denies a non-loopback Host header (tunnel / DNS-rebinding shape)", async () => {
    optInDev();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(
      req("http://localhost/api/bridge/cli?tool=terminal", { headers: { host: "abc123.ngrok.app" } }),
    );

    expect(res.status).toBe(503);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("denies when the dev server is bound to a reachable address", async () => {
    optInDev();
    vi.stubEnv("LITT_RESOLVED_BIND_HOST", "0.0.0.0");
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    spawnMock.mockReturnValue(makeFakeProc() as never);

    const { GET } = await import("@/app/api/bridge/cli/route");
    const res = await GET(req("http://localhost/api/bridge/cli?tool=terminal"));

    expect(res.status).toBe(503);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("default denial: agents/execute", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_USER_ID", ADMIN_ID);
    vi.stubEnv("ENABLE_AGENT_COMMANDS", "true");
    mockAuth.mockReset();
    spawnMock.mockReset();
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("POST returns 503 with no opt-in even with flag on and admin auth", async () => {
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);

    const { POST } = await import("@/app/api/agents/execute/route");
    const res = await POST(
      req("http://localhost/api/agents/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo", args: ["hi"] }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("POST returns 503 in production even with flag on and admin auth", async () => {
    productionEnv();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);

    const { POST } = await import("@/app/api/agents/execute/route");
    const res = await POST(
      req("http://localhost/api/agents/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "echo", args: ["hi"] }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("default denial: litt/command", () => {
  beforeEach(() => {
    vi.stubEnv("ENABLE_LOCAL_BUILD_API", "true");
    mockAuth.mockReset();
    mockIsAdmin.mockReset();
    spawnMock.mockReset();
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("POST returns 503 with no opt-in even with flag on and admin auth", async () => {
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    mockIsAdmin.mockResolvedValue(true);

    const { POST } = await import("@/app/api/litt/command/route");
    const res = await POST(
      req("http://localhost/api/litt/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "typecheck" }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("POST returns 503 in production even with flag on and admin auth", async () => {
    productionEnv();
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
    mockIsAdmin.mockResolvedValue(true);

    const { POST } = await import("@/app/api/litt/command/route");
    const res = await POST(
      req("http://localhost/api/litt/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "typecheck" }),
      }),
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe(HOST_EXECUTION_DISABLED_CODE);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});

describe("default denial: docker provider execution boundary", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("create() throws HostExecutionDisabledError with no opt-in (default deny)", async () => {
    const { DockerSandboxProvider } = await import(
      "@/lib/terminal-v1/providers/docker-provider"
    );
    const runner = {
      exec: vi.fn(async () => ({ stdout: "", stderr: "" })),
      spawn: vi.fn(),
    };
    const provider = new DockerSandboxProvider(runner);

    await expect(
      provider.create({
        projectId: "proj-12345678",
        userId: "user-1",
        workspaceId: "ws-1",
      }),
    ).rejects.toMatchObject({ code: HOST_EXECUTION_DISABLED_CODE });

    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("create() throws HostExecutionDisabledError in production", async () => {
    productionEnv();
    const { DockerSandboxProvider } = await import(
      "@/lib/terminal-v1/providers/docker-provider"
    );
    const runner = {
      exec: vi.fn(async () => ({ stdout: "", stderr: "" })),
      spawn: vi.fn(),
    };
    const provider = new DockerSandboxProvider(runner);

    await expect(
      provider.create({
        projectId: "proj-12345678",
        userId: "user-1",
        workspaceId: "ws-1",
      }),
    ).rejects.toMatchObject({ code: HOST_EXECUTION_DISABLED_CODE });

    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("execute() throws HostExecutionDisabledError in production", async () => {
    productionEnv();
    const { DockerSandboxProvider } = await import(
      "@/lib/terminal-v1/providers/docker-provider"
    );
    const runner = {
      exec: vi.fn(async () => ({ stdout: "", stderr: "" })),
      spawn: vi.fn(),
    };
    const provider = new DockerSandboxProvider(runner);

    await expect(
      provider.execute("sbx-none", { command: "echo hi" }),
    ).rejects.toMatchObject({ code: HOST_EXECUTION_DISABLED_CODE });

    expect(runner.exec).not.toHaveBeenCalled();
  });

  it("health() throws HostExecutionDisabledError in production", async () => {
    productionEnv();
    const { DockerSandboxProvider } = await import(
      "@/lib/terminal-v1/providers/docker-provider"
    );
    const runner = {
      exec: vi.fn(async () => ({ stdout: "", stderr: "" })),
      spawn: vi.fn(),
    };
    const provider = new DockerSandboxProvider(runner);

    await expect(provider.health()).rejects.toMatchObject({
      code: HOST_EXECUTION_DISABLED_CODE,
    });

    expect(runner.exec).not.toHaveBeenCalled();
  });
});
