/**
 * CLI bridge route — execution-policy tests.
 *
 * - Non-admin users are blocked (existing behavior).
 * - Policy-denied ("dangerous") commands are rejected with 403 even for the
 *   admin user (execution-policy bypass fix).
 * - Safe/elevated input is still forwarded to the child stdin.
 * - No per-secret injection into the child env (GEMINI_API_KEY line removed).
 *
 * Run: npx vitest run src/app/api/bridge/cli/route.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { EventEmitter } from "events";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

// Hoisted mock handle so tests can control spawn's return value.
// NOTE: sync manual mock (not the async importOriginal-spread pattern):
// async factories for node builtins do not propagate to dependency modules
// in this vitest setup, while this form does. `default` is required for the
// CJS interop the transform generates.
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("child_process", () => {
  const mocked = { spawn: spawnMock };
  return { ...mocked, default: mocked };
});

import { GET, POST, enforceBridgeInputPolicy } from "./route";
import { auth } from "@/lib/auth";

const ADMIN_ID = "admin_user_1";
const mockAuth = vi.mocked(auth);

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

describe("bridge/cli execution policy", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_CLERK_ID", "");
    vi.stubEnv("ADMIN_USER_ID", ADMIN_ID);
    spawnMock.mockReset();
    mockAuth.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function adminAuth() {
    mockAuth.mockResolvedValue({ userId: ADMIN_ID } as never);
  }

  function nonAdminAuth() {
    mockAuth.mockResolvedValue({ userId: "someone_else" } as never);
  }

  async function openTerminalSession(): Promise<string> {
    adminAuth();
    const fakeProc = makeFakeProc();
    spawnMock.mockReturnValue(fakeProc as never);
    const res = await GET(
      new NextRequest("http://localhost/api/bridge/cli?tool=terminal", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    const match = text.match(/"sessionId":"([^"]+)"/);
    expect(match).not.toBeNull();
    // NOTE: do NOT cancel the reader — the stream's cancel() callback kills
    // and unregisters the session. Just stop reading; the first chunk is
    // all we need.
    return match![1];
  }

  async function postInput(sessionId: string, input: string): Promise<Response> {
    return POST(
      new NextRequest("http://localhost/api/bridge/cli", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, type: "input", input }),
      }),
    );
  }

  it("blocks non-admin users from opening a session (existing)", async () => {
    nonAdminAuth();
    const res = await GET(
      new NextRequest("http://localhost/api/bridge/cli?tool=terminal", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(401);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("blocks non-admin POST input (existing)", async () => {
    nonAdminAuth();
    const res = await postInput("whatever", "echo hi");
    expect(res.status).toBe(401);
  });

  it("rejects a policy-denied command even for the admin user", async () => {
    const sessionId = await openTerminalSession();
    const fakeProc = spawnMock.mock.results[0].value as ReturnType<
      typeof makeFakeProc
    >;
    const res = await postInput(sessionId, "rm -rf /");
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/denied by execution policy/i);
    expect(fakeProc.stdin.write).not.toHaveBeenCalled();
  });

  it("rejects other dangerous commands (dd, mkfs, shutdown)", async () => {
    const sessionId = await openTerminalSession();
    for (const cmd of [
      "dd if=/dev/zero of=/dev/sda",
      "mkfs /dev/sda1",
      "shutdown -h now",
    ]) {
      const res = await postInput(sessionId, cmd);
      expect(res.status).toBe(403);
    }
  });

  it("still forwards safe input to the child stdin", async () => {
    const sessionId = await openTerminalSession();
    const fakeProc = spawnMock.mock.results[0].value as ReturnType<
      typeof makeFakeProc
    >;
    const res = await postInput(sessionId, "echo hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(fakeProc.stdin.write).toHaveBeenCalledWith("echo hello\n");
  });

  it("enforceBridgeInputPolicy: dangerous → blocked, safe/elevated → allowed", () => {
    expect(enforceBridgeInputPolicy("rm -rf /").allowed).toBe(false);
    expect(enforceBridgeInputPolicy("  kill -9 1").allowed).toBe(false);
    expect(enforceBridgeInputPolicy("echo hello").allowed).toBe(true);
    expect(enforceBridgeInputPolicy("ls -la").allowed).toBe(true);
    expect(enforceBridgeInputPolicy("").allowed).toBe(false);
  });

  it("does not inject secrets into the child env by name", async () => {
    adminAuth();
    const fakeProc = makeFakeProc();
    spawnMock.mockReturnValue(fakeProc as never);
    await GET(
      new NextRequest("http://localhost/api/bridge/cli?tool=gemini", {
        method: "GET",
      }),
    );
    const options = spawnMock.mock.calls[0][2] as {
      env: Record<string, string | undefined>;
    };
    // The explicit per-secret injection line (GEMINI_API_KEY: ...) must be
    // gone: the child env may only contain the inherited server env plus TERM.
    const extraKeys = Object.keys(options.env).filter(
      (k) => !(k in process.env) && k !== "TERM",
    );
    expect(extraKeys).toEqual([]);
    expect(options.env.TERM).toBe("xterm-256color");
  });
});
