/**
 * E2B sandbox provider — unit tests (E2B client fully mocked, no network).
 *
 * Covers: fail-closed without E2B_API_KEY, create/env hygiene, execution
 * policy, timeout + crash cleanup (immediate destroy), idle-timeout and
 * max-lifetime reapers, two-session isolation in bookkeeping, cost hooks,
 * file read/write, publish-credential rejection.
 *
 * Run: npx vitest run src/lib/terminal-v1/providers/e2b-provider.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  E2BSandboxProvider,
  E2BNotConfiguredError,
  requireE2BApiKey,
  resolveIdleTimeoutMs,
  resolveMaxSessionMs,
  assertNoPublishingCredentials,
  type E2BSandboxHandle,
  type E2BClientFactory,
} from "./e2b-provider";

const TEST_KEY = "e2b_test_key_do_not_use";

function makeMockSandbox(overrides: Partial<E2BSandboxHandle> = {}): E2BSandboxHandle {
  return {
    sandboxId: `e2b-${Math.random().toString(36).slice(2, 10)}`,
    commands: {
      run: vi.fn(async (_cmd: string) => ({
        exitCode: 0,
        stdout: "ok",
        stderr: "",
      })),
    },
    files: {
      read: vi.fn(async (_path: string) => "file-content"),
      write: vi.fn(async (_path: string, _data: unknown) => ({})),
    },
    pty: {
      create: vi.fn(async (_opts: unknown) => ({
        pid: 4242,
        sendStdin: vi.fn(async (_d: unknown) => {}),
        kill: vi.fn(async () => true),
        disconnect: vi.fn(async () => {}),
      })),
      resize: vi.fn(async (_pid: number, _size: unknown) => ({})),
    },
    getHost: vi.fn((_port: number) => "abc123.host.e2b.dev"),
    kill: vi.fn(async () => true),
    ...overrides,
  };
}

function makeFactory(sandbox?: E2BSandboxHandle): {
  factory: E2BClientFactory;
  createMock: ReturnType<typeof vi.fn>;
  sandbox: E2BSandboxHandle;
} {
  const sbx = sandbox ?? makeMockSandbox();
  const createMock = vi.fn(async (_opts: unknown) => sbx);
  return { factory: { create: createMock }, createMock, sandbox: sbx };
}

const baseInput = {
  workspaceId: "ws-1",
  userId: "user_abc",
  projectId: "proj-12345678",
};

beforeEach(() => {
  vi.stubEnv("E2B_API_KEY", TEST_KEY);
  vi.stubEnv("E2B_IDLE_TIMEOUT_MS", "");
  vi.stubEnv("E2B_MAX_SESSION_MS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fail-closed without E2B_API_KEY", () => {
  it("requireE2BApiKey throws E2BNotConfiguredError when the key is absent", () => {
    vi.stubEnv("E2B_API_KEY", "");
    expect(() => requireE2BApiKey("test")).toThrow(E2BNotConfiguredError);
    expect(() => requireE2BApiKey("test")).toThrow(/E2B_API_KEY is not set/);
  });

  it("create() refuses without a key and never touches the client", async () => {
    vi.stubEnv("E2B_API_KEY", "");
    const { factory, createMock } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    await expect(provider.create(baseInput)).rejects.toThrow(
      E2BNotConfiguredError,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("health() reports unhealthy (not an exception) without a key", async () => {
    vi.stubEnv("E2B_API_KEY", "");
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const h = await provider.health();
    expect(h.healthy).toBe(false);
    expect(JSON.stringify(h.details)).toMatch(/E2B_API_KEY/);
    // The key value itself must never appear in health output.
    expect(JSON.stringify(h.details)).not.toContain(TEST_KEY);
  });
});

describe("create()", () => {
  it("creates a running instance and passes the env key (never hardcoded)", async () => {
    const { factory, createMock } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    expect(inst.state).toBe("running");
    expect(inst.provider).toBe("e2b");
    expect(inst.sandboxId).toMatch(/^sbx-/);
    expect(createMock).toHaveBeenCalledTimes(1);
    const opts = createMock.mock.calls[0][0] as {
      apiKey: string;
      envs: Record<string, string>;
    };
    expect(opts.apiKey).toBe(TEST_KEY);
    // Allowlisted identity env only — never the E2B key, never host env.
    expect(opts.envs.LITTREE_USER_ID).toBe("user_abc");
    expect(opts.envs.LITTREE_PROJECT_ID).toBe("proj-12345678");
    expect(opts.envs.E2B_API_KEY).toBeUndefined();
    // HOME is the allowlist default, never the host's real HOME.
    expect(opts.envs.HOME).toBe("/workspace");
  });

  it("rejects publishing credentials in caller env (publish ≠ execute)", async () => {
    const { factory, createMock } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    await expect(
      provider.create({
        ...baseInput,
        env: { NETLIFY_AUTH_TOKEN: "nfp_secret" },
      }),
    ).rejects.toThrow(/publishing credential/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("assertNoPublishingCredentials blocks the E2B key itself and hosting tokens", () => {
    expect(() =>
      assertNoPublishingCredentials({ E2B_API_KEY: "x" }),
    ).toThrow(/publish/);
    expect(() =>
      assertNoPublishingCredentials({ VERCEL_TOKEN: "x" }),
    ).toThrow(/publish/);
    expect(() =>
      assertNoPublishingCredentials({ LITTREE_USER_ID: "u" }),
    ).not.toThrow();
  });
});

describe("timeout configuration", () => {
  it("idle timeout defaults to 5 minutes", () => {
    expect(resolveIdleTimeoutMs()).toBe(5 * 60 * 1000);
  });

  it("idle timeout never exceeds the 30-minute ceiling", () => {
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", String(60 * 60 * 1000));
    expect(resolveIdleTimeoutMs()).toBe(30 * 60 * 1000);
  });

  it("invalid idle timeout falls back to the default", () => {
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", "not-a-number");
    expect(resolveIdleTimeoutMs()).toBe(5 * 60 * 1000);
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", "-5");
    expect(resolveIdleTimeoutMs()).toBe(5 * 60 * 1000);
  });

  it("max session defaults to 60 minutes and honors env", () => {
    expect(resolveMaxSessionMs()).toBe(60 * 60 * 1000);
    vi.stubEnv("E2B_MAX_SESSION_MS", String(10 * 60 * 1000));
    expect(resolveMaxSessionMs()).toBe(10 * 60 * 1000);
  });
});

describe("execute()", () => {
  it("runs the command and records cost stats", async () => {
    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    const res = await provider.execute(inst.sandboxId, {
      command: "echo hello",
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("ok");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(sandbox.commands.run).toHaveBeenCalledTimes(1);

    const stats = provider.getSessionStats(inst.sandboxId);
    expect(stats?.executions).toBe(1);
    expect(stats?.totalExecMs).toBeGreaterThanOrEqual(0);
    expect(stats?.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(stats?.state).toBe("running");
  });

  it("rejects policy-denied commands before touching the sandbox", async () => {
    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await expect(
      provider.execute(inst.sandboxId, { command: "rm -rf /" }),
    ).rejects.toThrow(/execution policy/i);
    expect(sandbox.commands.run).not.toHaveBeenCalled();
    // Session survives a policy rejection (nothing ran).
    expect(await provider.get(inst.sandboxId)).not.toBeNull();
  });

  it("rejects empty commands", async () => {
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);
    await expect(
      provider.execute(inst.sandboxId, { command: "   " }),
    ).rejects.toThrow(/empty command/i);
  });

  it("destroys the sandbox immediately when the client throws mid-run (crash)", async () => {
    const sbx = makeMockSandbox({
      commands: {
        run: vi.fn(async () => {
          throw new Error("connection reset by peer");
        }),
      },
    });
    const { factory } = makeFactory(sbx);
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await expect(
      provider.execute(inst.sandboxId, { command: "echo hi" }),
    ).rejects.toThrow(/connection reset/);

    // Immediate destroy on the failure path: kill called, session dropped.
    expect(sbx.kill).toHaveBeenCalledTimes(1);
    expect(await provider.get(inst.sandboxId)).toBeNull();
    expect(provider.getSessionStats(inst.sandboxId)).toBeNull();
  });

  it("destroys the sandbox on command timeout", async () => {
    const timeoutErr = new Error("Command timed out");
    timeoutErr.name = "TimeoutError";
    const sbx = makeMockSandbox({
      commands: {
        run: vi.fn(async () => {
          throw timeoutErr;
        }),
      },
    });
    const { factory } = makeFactory(sbx);
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await expect(
      provider.execute(inst.sandboxId, { command: "sleep 30", timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/);
    expect(sbx.kill).toHaveBeenCalledTimes(1);
    expect(await provider.get(inst.sandboxId)).toBeNull();
  });
});

describe("reaper + idle timeout (abandoned sessions)", () => {
  it("force-destroys a session that exceeds max lifetime, leaving the other alone", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2B_MAX_SESSION_MS", "1000");
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", String(60 * 60 * 1000)); // idle not the trigger

    const a = makeMockSandbox();
    const b = makeMockSandbox();
    let n = 0;
    const factory: E2BClientFactory = {
      create: vi.fn(async () => (n++ === 0 ? a : b)),
    };
    const provider = new E2BSandboxProvider(factory);
    // Stagger creation so only A's max-lifetime fires: A at t=0 (reaper at
    // t=1000), B at t=500 (reaper at t=1500). Advance to t=1000.
    const instA = await provider.create({ ...baseInput, projectId: "proj-aaaaaaaa" });
    await vi.advanceTimersByTimeAsync(500);
    const instB = await provider.create({ ...baseInput, projectId: "proj-bbbbbbbb" });
    await vi.advanceTimersByTimeAsync(500);

    // Session A reaped; session B untouched.
    expect(a.kill).toHaveBeenCalledTimes(1);
    expect(b.kill).not.toHaveBeenCalled();
    expect(await provider.get(instA.sandboxId)).toBeNull();
    const stillThere = await provider.get(instB.sandboxId);
    expect(stillThere?.state).toBe("running");
  });

  it("idle timeout destroys an inactive session", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", "500");
    vi.stubEnv("E2B_MAX_SESSION_MS", String(60 * 60 * 1000));

    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await vi.advanceTimersByTimeAsync(500);
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
    expect(await provider.get(inst.sandboxId)).toBeNull();
  });

  it("activity resets the idle timer", async () => {
    vi.useFakeTimers();
    vi.stubEnv("E2B_IDLE_TIMEOUT_MS", "500");
    vi.stubEnv("E2B_MAX_SESSION_MS", String(60 * 60 * 1000));

    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await vi.advanceTimersByTimeAsync(400);
    await provider.execute(inst.sandboxId, { command: "echo hi" });
    await vi.advanceTimersByTimeAsync(400);
    // Idle timer was reset by the execute() at t=400; kill only at t=900.
    expect(sandbox.kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(sandbox.kill).toHaveBeenCalledTimes(1);
  });

  it("destroy() is idempotent and never touches other sessions", async () => {
    const a = makeMockSandbox();
    const b = makeMockSandbox();
    let n = 0;
    const factory: E2BClientFactory = {
      create: vi.fn(async () => (n++ === 0 ? a : b)),
    };
    const provider = new E2BSandboxProvider(factory);
    const instA = await provider.create({ ...baseInput, projectId: "proj-aaaaaaaa" });
    const instB = await provider.create({ ...baseInput, projectId: "proj-bbbbbbbb" });

    await provider.destroy(instA.sandboxId);
    await provider.destroy(instA.sandboxId); // second call: no-op
    expect(a.kill).toHaveBeenCalledTimes(1);
    expect(b.kill).not.toHaveBeenCalled();
    expect((await provider.get(instB.sandboxId))?.state).toBe("running");
  });

  it("a failed kill during destroy still drops the session record", async () => {
    const sbx = makeMockSandbox({
      kill: vi.fn(async () => {
        throw new Error("already gone");
      }),
    });
    const { factory } = makeFactory(sbx);
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await provider.destroy(inst.sandboxId); // must not throw
    expect(await provider.get(inst.sandboxId)).toBeNull();
  });
});

describe("files", () => {
  it("readFile/writeFile round-trip inside the sandbox", async () => {
    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await provider.writeFile(inst.sandboxId, "/workspace/app.txt", "hello");
    expect(sandbox.files.write).toHaveBeenCalledWith("/workspace/app.txt", "hello");
    const content = await provider.readFile(inst.sandboxId, "/workspace/app.txt");
    expect(content).toBe("file-content");
    expect(sandbox.files.read).toHaveBeenCalledWith("/workspace/app.txt");
  });

  it("rejects relative paths and parent traversal", async () => {
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await expect(provider.readFile(inst.sandboxId, "relative.txt")).rejects.toThrow(
      /absolute/,
    );
    await expect(
      provider.writeFile(inst.sandboxId, "/workspace/../etc/passwd", "x"),
    ).rejects.toThrow(/traversal/);
  });
});

describe("terminal + ports + lifecycle", () => {
  it("connectTerminal wires write/resize/output through the PTY", async () => {
    const { factory, sandbox } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    const transport = await provider.connectTerminal(inst.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });
    expect(transport.sessionId).toMatch(/^sess-/);

    const createOpts = (sandbox.pty.create as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as { onData: (d: Uint8Array) => void; cols: number };
    expect(createOpts.cols).toBe(80);

    const seen: string[] = [];
    transport.onOutput((d) => seen.push(d));
    createOpts.onData(new TextEncoder().encode("hello-pty"));
    expect(seen).toEqual(["hello-pty"]);

    transport.write("ls\n");
    const ptyHandle = await (sandbox.pty.create as ReturnType<typeof vi.fn>).mock
      .results[0].value;
    expect(ptyHandle.sendStdin).toHaveBeenCalledWith("ls\n");

    transport.resize(100, 30);
    expect(sandbox.pty.resize).toHaveBeenCalledWith(4242, {
      cols: 100,
      rows: 30,
    });
  });

  it("exposePort returns a token-gated preview URL", async () => {
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    const ep = await provider.exposePort(inst.sandboxId, 3000);
    expect(ep.port).toBe(3000);
    expect(ep.url).toBe("https://abc123.host.e2b.dev");
    expect(ep.state).toBe("private");
    expect(ep.previewToken).toBeTruthy();
    expect(new Date(ep.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("start() on a stopped sandbox refuses (E2B kill is terminal)", async () => {
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    const inst = await provider.create(baseInput);

    await provider.stop(inst.sandboxId);
    expect((await provider.get(inst.sandboxId))?.state).toBe("stopped");
    await expect(provider.start(inst.sandboxId)).rejects.toThrow(/cannot be restarted/i);
  });

  it("get() returns null for unknown sandboxes", async () => {
    const { factory } = makeFactory();
    const provider = new E2BSandboxProvider(factory);
    expect(await provider.get("sbx-nope")).toBeNull();
  });
});
