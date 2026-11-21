/**
 * E2B provider tests (SANDBOX-PLAN.md Phase 1).
 *
 * The E2B SDK is faked at the provider's E2bClient adapter boundary:
 * no network, no API key, no vendor account. What is proven here is
 * the provider logic the staging canary will rely on:
 *   1. Lifecycle maps onto the SDK (create/start/stop/destroy/get).
 *   2. Requested limits + identity metadata reach the SDK create call.
 *   3. Sandbox env comes ONLY from the allowlist composer: identity
 *      vars present, caller overrides of identity refused, and any
 *      platform secret in the request refuses the create BEFORE the
 *      SDK is touched.
 *   4. execute maps results and exit codes; exposePort builds the
 *      private endpoint from the SDK host.
 *   5. health() reflects the probe and never leaks the API key.
 */

import { describe, it, expect } from "vitest";
import {
  clampSandboxTimeoutMs,
  E2B_MAX_TIMEOUT_MS,
  E2bRequestTimeoutError,
  E2bSandboxProvider,
  SandboxNotFoundError,
  SANDBOX_EGRESS_DENY_OUT,
  type E2bClient,
  type E2bCreateOptions,
  type E2bPtyConnectOptions,
  type E2bPtyCreateOptions,
  type E2bPtyHandle,
  type E2bPtyInputStream,
  type E2bSandboxHandle,
} from "../sandbox/e2b-provider";
import type { CanaryProvider } from "../sandbox/provider";
import {
  assertNoPlatformSecrets,
  buildSandboxEnv,
  composeSandboxEnv,
  SandboxEnvSecretError,
  SANDBOX_ENV_ALLOWLIST,
} from "../sandbox/env";

const API_KEY = ["e2b", "test", "key", "must", "never", "leak"].join("_");

class FakeE2bHandle implements E2bSandboxHandle {
  readonly sandboxId: string;
  private readonly createEnvs: Record<string, string>;
  /** The create-time metadata (what getInfo reports back). */
  readonly metadata: Record<string, string>;
  paused = false;
  killed = false;
  /** Test knob: isRunning reports false without pause/kill semantics. */
  forceNotRunning = false;
  /** Test knob: readFileBytes never settles (deadline tests). */
  hangReads = false;
  /** What getExpiry reports; null = cannot report. */
  expiryMs: number | null = null;
  timeoutExtensions: number[] = [];
  /** In-memory files for the Phase 2 transfer surface. */
  readonly files = new Map<string, Uint8Array>();

  constructor(
    sandboxId: string,
    envs: Record<string, string>,
    metadata: Record<string, string> = {},
  ) {
    this.sandboxId = sandboxId;
    this.createEnvs = envs;
    this.metadata = metadata;
  }

  async getMetadata(): Promise<Record<string, string> | null> {
    return this.metadata;
  }

  async getExpiry(): Promise<number | null> {
    return this.expiryMs;
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    if (this.hangReads) return new Promise<Uint8Array>(() => {});
    const data = this.files.get(path);
    if (!data) throw new Error(`no such file: ${path}`);
    return data;
  }

  async writeFileBytes(path: string, data: Uint8Array): Promise<void> {
    this.files.set(path, data);
  }

  async listDir(path: string) {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const out = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (rest.includes("/")) continue;
      out.push({
        name: rest,
        path: key,
        type: "file" as const,
        size: this.files.get(key)!.length,
        mode: 0o644,
        mtimeMs: 0,
      });
    }
    return out;
  }

  async removePath(path: string): Promise<void> {
    this.files.delete(path);
  }

  async makeDir(_path: string): Promise<void> {}

  async renamePath(oldPath: string, newPath: string): Promise<void> {
    const data = this.files.get(oldPath);
    if (data) {
      this.files.set(newPath, data);
      this.files.delete(oldPath);
    }
  }

  readonly runCommandUsers: Array<string | undefined> = [];

  async runCommand(
    command: string,
    opts: {
      cwd?: string;
      timeoutMs?: number;
      stdin?: string;
      envs?: Record<string, string>;
      user?: string;
    },
  ) {
    this.runCommandUsers.push(opts.user);
    const env = { ...this.createEnvs, ...(opts.envs ?? {}) };
    const printenv = command.match(/^printenv (\S+)$/);
    if (printenv) {
      const v = env[printenv[1]];
      return v === undefined
        ? { exitCode: 1, stdout: "", stderr: "" }
        : { exitCode: 0, stdout: `${v}\n`, stderr: "" };
    }
    if (command === "false") return { exitCode: 1, stdout: "", stderr: "" };
    if (command.startsWith("echo ")) {
      return { exitCode: 0, stdout: `${command.slice(5)}\n`, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  getHost(port: number): string {
    return `${this.sandboxId}-${port}.proxy.e2b.test`;
  }

  async setTimeout(timeoutMs: number): Promise<void> {
    this.timeoutExtensions.push(timeoutMs);
  }

  async pause(): Promise<boolean> {
    this.paused = true;
    return true;
  }

  async kill(): Promise<boolean> {
    this.killed = true;
    return true;
  }

  async isRunning(): Promise<boolean> {
    return !this.killed && !this.paused && !this.forceNotRunning;
  }

  // ─── PTY fake (terminal bridge) ──────────────────────────────────
  readonly ptyCreates: E2bPtyCreateOptions[] = [];
  readonly ptyConnects: Array<{ pid: number; opts: E2bPtyConnectOptions }> = [];
  readonly ptyInputs: Array<{ pid: number; timeoutMs: number; sent: string[] }> = [];
  readonly ptyResizes: Array<{ pid: number; cols: number; rows: number }> = [];
  readonly ptyKills: number[] = [];
  readonly ptys = new Map<number, FakePtyHandle>();
  private ptySeq = 100;

  async createPty(opts: E2bPtyCreateOptions): Promise<E2bPtyHandle> {
    this.ptyCreates.push(opts);
    const handle = new FakePtyHandle(++this.ptySeq, opts.onData);
    this.ptys.set(handle.pid, handle);
    return handle;
  }

  async connectPty(pid: number, opts: E2bPtyConnectOptions): Promise<E2bPtyHandle> {
    this.ptyConnects.push({ pid, opts });
    const existing = this.ptys.get(pid);
    if (!existing || existing.ended) throw new Error(`no such pty ${pid}`);
    existing.reconnect(opts.onData);
    return existing;
  }

  streamPtyInput(pid: number, opts: { timeoutMs: number }): E2bPtyInputStream {
    const record = { pid, timeoutMs: opts.timeoutMs, sent: [] as string[] };
    this.ptyInputs.push(record);
    return {
      send: async (data: string) => {
        record.sent.push(data);
      },
      close: async () => {},
    };
  }

  async resizePty(pid: number, size: { cols: number; rows: number }): Promise<void> {
    this.ptyResizes.push({ pid, cols: size.cols, rows: size.rows });
  }

  async killPty(pid: number): Promise<boolean> {
    this.ptyKills.push(pid);
    const p = this.ptys.get(pid);
    if (p) p.end(137);
    return true;
  }
}

/**
 * Fake PTY at the adapter boundary. Its wait() models the WRAPPED
 * handle's contract (what wrapSdkPtyHandle guarantees): resolves
 * with the exit code for ANY process exit, rejects only when the
 * event stream died without a result.
 */
class FakePtyHandle implements E2bPtyHandle {
  readonly pid: number;
  private onData: (data: Uint8Array) => void | Promise<void>;
  private readonly waitPromise: Promise<{ exitCode: number }>;
  private waitResolve!: (v: { exitCode: number }) => void;
  private waitReject!: (e: unknown) => void;
  ended = false;
  disconnected = false;

  constructor(pid: number, onData: (data: Uint8Array) => void | Promise<void>) {
    this.pid = pid;
    this.onData = onData;
    this.waitPromise = new Promise((res, rej) => {
      this.waitResolve = res;
      this.waitReject = rej;
    });
  }

  reconnect(onData: (data: Uint8Array) => void | Promise<void>): void {
    this.onData = onData;
  }

  emit(text: string): void {
    void this.onData(new TextEncoder().encode(text));
  }

  end(exitCode: number): void {
    if (this.ended) return;
    this.ended = true;
    this.waitResolve({ exitCode });
  }

  failStream(err: unknown): void {
    if (this.ended) return;
    this.ended = true;
    this.waitReject(err);
  }

  wait(): Promise<{ exitCode: number }> {
    return this.waitPromise;
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
  }
}

class FakeE2bClient implements E2bClient {
  readonly creates: E2bCreateOptions[] = [];
  readonly handles = new Map<string, FakeE2bHandle>();
  connectCalls = 0;
  probeError: Error | null = null;
  private seq = 0;

  async create(opts: E2bCreateOptions): Promise<E2bSandboxHandle> {
    this.creates.push(opts);
    this.seq += 1;
    const handle = new FakeE2bHandle(`e2b-sbx-${this.seq}`, opts.envs, opts.metadata);
    this.handles.set(handle.sandboxId, handle);
    return handle;
  }

  async connect(sandboxId: string): Promise<E2bSandboxHandle> {
    this.connectCalls += 1;
    const handle = this.handles.get(sandboxId);
    // The real SDK refuses to connect a sandbox that is gone
    // (killed / never existed) — the fake models that refusal,
    // which re-adoption's dead-id fallthrough depends on.
    if (!handle || handle.killed) throw new Error(`no such sandbox ${sandboxId}`);
    handle.paused = false;
    return handle;
  }

  async probe(): Promise<void> {
    if (this.probeError) throw this.probeError;
  }
}

function makeProvider(client: FakeE2bClient): E2bSandboxProvider {
  return new E2bSandboxProvider({ apiKey: API_KEY, client, templateId: "litt-test-template" });
}

describe("E2bSandboxProvider — lifecycle", () => {
  it("creates with limits, identity metadata, and allowlisted env; get echoes them", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
      limits: { cpuVcpus: 4, memoryMB: 4096 },
    });

    expect(instance.provider).toBe("e2b");
    expect(instance.state).toBe("running");
    expect(instance.limits.cpuVcpus).toBe(4);
    expect(instance.limits.memoryMB).toBe(4096);

    expect(client.creates).toHaveLength(1);
    const createOpts = client.creates[0];
    expect(createOpts.template).toBe("litt-test-template");
    expect(createOpts.cpuCount).toBe(4);
    expect(createOpts.memoryMB).toBe(4096);
    expect(createOpts.metadata).toEqual({
      littree_user_id: "user-1",
      littree_project_id: "proj-1",
      littree_workspace_id: "ws-1",
    });
    // Identity env present at create time; no platform secret keys at all.
    expect(createOpts.envs.LITTREE_USER_ID).toBe("user-1");
    expect(createOpts.envs.LITTREE_PROJECT_ID).toBe("proj-1");
    expect(createOpts.envs.HOME).toBe("/workspace");
    expect(JSON.stringify(createOpts)).not.toContain(API_KEY);

    const fetched = await provider.get(instance.sandboxId);
    expect(fetched?.limits.cpuVcpus).toBe(4);
    expect(fetched?.limits.memoryMB).toBe(4096);
  });

  it("execute sees the final env with the real sandbox id, and maps exit codes", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    const idResult = await provider.execute(instance.sandboxId, {
      command: `printenv LITTREE_SANDBOX_ID`,
    });
    expect(idResult.exitCode).toBe(0);
    expect(idResult.stdout.trim()).toBe(instance.sandboxId);

    const echo = await provider.execute(instance.sandboxId, { command: "echo hello" });
    expect(echo.exitCode).toBe(0);
    expect(echo.stdout).toBe("hello\n");
    expect(echo.durationMs).toBeGreaterThanOrEqual(0);

    // Per-command user threading (preview EACCES fix): the lifecycle
    // writability repair runs as root; ordinary commands must keep
    // arriving with NO user so the SDK's default (non-root) user
    // still applies to them.
    const handle = client.handles.get(instance.sandboxId)!;
    await provider.execute(instance.sandboxId, {
      command: "chmod -R a+rwX /workspace",
      user: "root",
    });
    expect(handle.runCommandUsers.at(-1)).toBe("root");
    await provider.execute(instance.sandboxId, { command: "echo plain" });
    expect(handle.runCommandUsers.at(-1)).toBeUndefined();

    const fail = await provider.execute(instance.sandboxId, { command: "false" });
    expect(fail.exitCode).toBe(1);
  });

  it("stop pauses (disk preserved), start reconnects, destroy kills and forgets", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    const handle = client.handles.get(instance.sandboxId)!;

    await provider.stop(instance.sandboxId);
    expect(handle.paused).toBe(true);
    expect((await provider.get(instance.sandboxId))?.state).toBe("stopped");

    await provider.start(instance.sandboxId);
    expect(client.connectCalls).toBe(1);
    expect(handle.timeoutExtensions.length).toBe(1);
    expect((await provider.get(instance.sandboxId))?.state).toBe("running");

    await provider.destroy(instance.sandboxId);
    expect(handle.killed).toBe(true);
    expect(await provider.get(instance.sandboxId)).toBeNull();
  });

  it("exposePort returns a private https endpoint built from the SDK host", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    const endpoint = await provider.exposePort(instance.sandboxId, 3000);
    expect(endpoint.port).toBe(3000);
    expect(endpoint.url).toBe(`https://${instance.sandboxId}-3000.proxy.e2b.test`);
    expect(endpoint.state).toBe("private");
    expect(endpoint.previewToken.length).toBeGreaterThanOrEqual(16);
    expect(Date.parse(endpoint.expiresAt)).toBeGreaterThan(Date.now());
  });

  it("connectTerminal attaches a PTY (terminal bridge — the Phase 1 refusal is gone)", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    const transport = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });
    expect(transport.sessionId).toBe(`${instance.sandboxId}:101`);
    expect(client.handles.get(instance.sandboxId)!.ptyCreates).toHaveLength(1);
  });

  it("satisfies the Phase 0 CanaryProvider subset structurally", () => {
    const provider: CanaryProvider = makeProvider(new FakeE2bClient());
    expect(provider.name).toBe("e2b");
  });
});

/**
 * Round 8 (2026-11-16 proof): the create-time timeoutMs is a HARD
 * KILL in E2B despite the limits field being named "idle" — a
 * workspace sandbox created at 11:34:41 was killed at exactly
 * 11:49:41 (15:00), and because execute() never extended the clock
 * and get() never verified liveness against E2B, every later
 * operation (forward push, git evidence probe, preview) ran against
 * the corpse. These tests pin the three-part fix: session-scale
 * create lifetime, extension on exec activity, real liveness in
 * get().
 */
describe("E2bSandboxProvider — lifetime and liveness (round 8)", () => {
  it("creates with the session-scale lifetime (maxSessionMinutes), not the 15-minute idle value", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    expect(client.creates).toHaveLength(1);
    expect(client.creates[0].timeoutMs).toBe(60 * 60_000);
    expect(client.creates[0].timeoutMs).not.toBe(15 * 60_000);
  });

  it("execute re-arms the session clock on activity", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    const handle = client.handles.get(instance.sandboxId)!;
    expect(handle.timeoutExtensions).toEqual([]);

    await provider.execute(instance.sandboxId, { command: "echo one" });
    await provider.execute(instance.sandboxId, { command: "echo two" });

    expect(handle.timeoutExtensions).toEqual([60 * 60_000, 60 * 60_000]);
  });

  /**
   * Round 9: the production E2B account is Hobby, whose sandbox
   * lifetime cap is 1 hour. A caller asking for more (the round-8
   * session limit was 120 minutes) must be CLAMPED at the provider
   * boundary, never passed through for E2B to reject.
   */
  it("clamps an over-cap create lifetime to the plan cap instead of requesting it", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
      limits: { maxSessionMinutes: 180 },
    });

    expect(client.creates).toHaveLength(1);
    expect(client.creates[0].timeoutMs).toBe(E2B_MAX_TIMEOUT_MS);
    expect(client.creates[0].timeoutMs).toBe(60 * 60_000);
  });

  it("clamps extendTimeout (preview keepalive) to the plan cap", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    const handle = client.handles.get(instance.sandboxId)!;

    await provider.extendTimeout(instance.sandboxId, 120 * 60_000);

    expect(handle.timeoutExtensions).toEqual([60 * 60_000]);
  });

  it("clampSandboxTimeoutMs passes under-cap values through and logs over-cap ones", () => {
    const logs: string[] = [];
    const log = (m: string) => logs.push(m);
    expect(clampSandboxTimeoutMs(30 * 60_000, log)).toBe(30 * 60_000);
    expect(logs).toEqual([]);
    expect(clampSandboxTimeoutMs(120 * 60_000, log)).toBe(E2B_MAX_TIMEOUT_MS);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("Clamping sandbox timeout");
  });

  it("get() returns null once E2B has killed the sandbox out-of-band, and forgets it", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    expect(await provider.get(instance.sandboxId)).not.toBeNull();

    // E2B-side death (timeout kill): the handle reports not running
    // while the provider's registry still holds the entry — exactly
    // the corpse state the 2026-11-16 proof hit.
    client.handles.get(instance.sandboxId)!.killed = true;

    expect(await provider.get(instance.sandboxId)).toBeNull();
    // Forgotten, not re-probed forever: still null on the next call,
    // and execute now refuses with the typed not-found error instead
    // of running against the corpse.
    expect(await provider.get(instance.sandboxId)).toBeNull();
    await expect(
      provider.execute(instance.sandboxId, { command: "echo x" }),
    ).rejects.toThrow(/Sandbox not found/);
  });

  it("get() still returns a paused (stopped) sandbox — pause is not death", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    await provider.stop(instance.sandboxId);
    // isRunning() is false for a paused sandbox; the liveness probe
    // must not mistake that for a kill and forget a resumable box.
    expect(client.handles.get(instance.sandboxId)!.paused).toBe(true);
    const fetched = await provider.get(instance.sandboxId);
    expect(fetched?.state).toBe("stopped");
  });
});

describe("E2bSandboxProvider — egress policy", () => {
  it("passes the metadata egress deny rule to the client on create", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    expect(client.creates).toHaveLength(1);
    // The whole link-local block: covers 169.254.169.254 (cloud
    // metadata) and 169.254.170.2 (ECS metadata) alike. Phase 2
    // lifecycle adds allowPublicTraffic: false (design note §3.2) —
    // sandbox URLs are private; the traffic token never leaves the
    // terminal process.
    expect(client.creates[0].network).toEqual({
      denyOut: ["169.254.0.0/16"],
      allowPublicTraffic: false,
    });
    expect(client.creates[0].network.denyOut).toEqual([...SANDBOX_EGRESS_DENY_OUT]);
  });

  it("applies the deny rule to EVERY create, with a fresh array each time", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    // Different tenants, different limits, one with project env — the
    // rule rides along regardless, because provider.create() is the
    // single funnel for canary and real workspace sandboxes alike.
    await provider.create({ workspaceId: "ws-1", userId: "user-1", projectId: "proj-1" });
    await provider.create({
      workspaceId: "ws-2",
      userId: "user-2",
      projectId: "proj-2",
      limits: { cpuVcpus: 4, memoryMB: 4096 },
      env: { PROJECT_FLAG: "on" },
    });

    expect(client.creates).toHaveLength(2);
    for (const createOpts of client.creates) {
      expect(createOpts.network).toEqual({
        denyOut: ["169.254.0.0/16"],
        allowPublicTraffic: false,
      });
    }
    // Each create gets its own copy: mutating one sandbox's rule can
    // never widen or narrow another's.
    expect(client.creates[0].network.denyOut).not.toBe(client.creates[1].network.denyOut);
    client.creates[0].network.denyOut.push("203.0.113.0/24");
    expect(client.creates[1].network.denyOut).toEqual(["169.254.0.0/16"]);
    expect(SANDBOX_EGRESS_DENY_OUT).toEqual(["169.254.0.0/16"]);
  });
});

describe("E2bSandboxProvider — env enforcement", () => {
  it("refuses a platform secret in the create env BEFORE any SDK call", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    await expect(
      provider.create({
        workspaceId: "ws-1",
        userId: "user-1",
        projectId: "proj-1",
        env: { CLERK_SECRET_KEY: "sk_live_whatever" },
      }),
    ).rejects.toBeInstanceOf(SandboxEnvSecretError);
    expect(client.creates).toHaveLength(0);
  });

  it("refuses the provider's own API key as a sandbox env var", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    await expect(
      provider.create({
        workspaceId: "ws-1",
        userId: "user-1",
        projectId: "proj-1",
        env: { E2B_API_KEY: API_KEY },
      }),
    ).rejects.toBeInstanceOf(SandboxEnvSecretError);
    expect(client.creates).toHaveLength(0);
  });

  it("caller env cannot override identity variables; project-scoped vars pass through", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
      env: { LITTREE_USER_ID: "attacker", PROJECT_FLAG: "on" },
    });

    const who = await provider.execute(instance.sandboxId, {
      command: "printenv LITTREE_USER_ID",
    });
    expect(who.stdout.trim()).toBe("user-1");
    const flag = await provider.execute(instance.sandboxId, {
      command: "printenv PROJECT_FLAG",
    });
    expect(flag.stdout.trim()).toBe("on");
  });

  it("health reflects the probe and never leaks the API key", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);

    const ok = await provider.health();
    expect(ok.healthy).toBe(true);
    expect(JSON.stringify(ok)).not.toContain(API_KEY);

    client.probeError = new Error("401 unauthorized");
    const bad = await provider.health();
    expect(bad.healthy).toBe(false);
    expect(JSON.stringify(bad)).not.toContain(API_KEY);
  });

  it("constructor refuses a missing API key", () => {
    expect(() => new E2bSandboxProvider({ apiKey: "" })).toThrow(/E2B_API_KEY/);
  });
});

describe("sandbox env allowlist (env.ts)", () => {
  it("buildSandboxEnv emits only allowlisted keys", () => {
    const env = buildSandboxEnv({
      userId: "u",
      projectId: "p",
      workspaceId: "w",
      sandboxId: "s",
    });
    for (const key of Object.keys(env)) {
      expect(SANDBOX_ENV_ALLOWLIST).toContain(key);
    }
    expect(env.LITTREE_SANDBOX_ID).toBe("s");
  });

  it("assertNoPlatformSecrets throws on platform secrets, passes clean env", () => {
    expect(() => assertNoPlatformSecrets({ PATH: "/usr/bin" })).not.toThrow();
    expect(() => assertNoPlatformSecrets({ STRIPE_SECRET_KEY: "sk" })).toThrow(
      SandboxEnvSecretError,
    );
    expect(() => assertNoPlatformSecrets({ E2B_API_KEY: "k" })).toThrow(
      SandboxEnvSecretError,
    );
    // Empty values are inert (mirrors the web-side semantics).
    expect(() => assertNoPlatformSecrets({ CLERK_SECRET_KEY: "" })).not.toThrow();
  });

  it("composeSandboxEnv: identity wins over caller values", () => {
    const env = composeSandboxEnv({
      userId: "real-user",
      projectId: "p",
      workspaceId: "w",
      sandboxId: "s",
      projectEnv: { LITTREE_USER_ID: "forged", MY_PROJECT_VAR: "1" },
    });
    expect(env.LITTREE_USER_ID).toBe("real-user");
    expect(env.MY_PROJECT_VAR).toBe("1");
  });

  // Regression (2026-11-14 preview failure): the template prepares pnpm
  // into /usr/local/share/corepack, but command processes only see this
  // composed env — when COREPACK_HOME was missing here, Corepack looked
  // under $HOME, found no prepared pnpm, and the preview dependency
  // install died downloading pnpm from the registry (exit 243).
  it("composeSandboxEnv: carries COREPACK_HOME pointing at the template's prepared cache, not overridable by project env", () => {
    const env = composeSandboxEnv({
      userId: "u",
      projectId: "p",
      workspaceId: "w",
      sandboxId: "s",
      projectEnv: { COREPACK_HOME: "/tmp/elsewhere" },
    });
    expect(env.COREPACK_HOME).toBe("/usr/local/share/corepack");
  });
});

/**
 * Terminal bridge (TERMINAL-BRIDGE-SPEC-2026-11-17 §2.3/§2.4/§5.2):
 * the provider's PTY attach. The spike fact these tests pin: in the
 * pinned SDK every PTY stream (create, connect, streamInput)
 * defaults its timeoutMs to 60,000 — the deadline for the WHOLE
 * stream — so the provider must pass the clamped session lifetime
 * (E2B_MAX_TIMEOUT_MS = 3,600,000) explicitly on all three, or a
 * shell dies 60 seconds after it opens.
 */
describe("E2bSandboxProvider — PTY terminal (terminal bridge)", () => {
  async function createWithSandbox(client: FakeE2bClient) {
    const provider = makeProvider(client);
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    const handle = client.handles.get(instance.sandboxId)!;
    return { provider, instance, handle };
  }

  it("pins the clamped session timeout on create AND on the input stream — never the 60s default", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);

    await provider.connectTerminal(instance.sandboxId, { shell: "bash", cols: 80, rows: 24 });

    expect(handle.ptyCreates).toHaveLength(1);
    expect(handle.ptyCreates[0].timeoutMs).toBe(E2B_MAX_TIMEOUT_MS);
    expect(handle.ptyCreates[0].timeoutMs).toBe(3_600_000);
    expect(handle.ptyCreates[0].timeoutMs).not.toBe(60_000);
    // The input stream is opened by the transport with the same pin.
    expect(handle.ptyInputs).toHaveLength(1);
    expect(handle.ptyInputs[0].timeoutMs).toBe(3_600_000);
    expect(handle.ptyInputs[0].timeoutMs).not.toBe(60_000);
  });

  it("creates at /workspace with the stored composed env and clamped dimensions", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);

    const transport = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 9999,
      rows: 0,
    });

    const create = handle.ptyCreates[0];
    expect(create.cwd).toBe("/workspace");
    // Stored composed env verbatim: identity present, HOME default.
    expect(create.envs.LITTREE_USER_ID).toBe("user-1");
    expect(create.envs.LITTREE_PROJECT_ID).toBe("proj-1");
    expect(create.envs.LITTREE_SANDBOX_ID).toBe(instance.sandboxId);
    expect(create.envs.HOME).toBe("/workspace");
    expect(JSON.stringify(create.envs)).not.toContain(API_KEY);
    // Host-manager bounds: cols ∈ [1, 500], rows ∈ [1, 200].
    expect(create.cols).toBe(500);
    expect(create.rows).toBe(1);
    expect(transport.sessionId).toBe(`${instance.sandboxId}:${handle.ptyCreates.length ? 101 : 0}`);
  });

  it("layers caller env through the value guard: HOME pin lands, identity cannot be forged", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);

    await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
      env: { HOME: "/home/litt", LITTREE_USER_ID: "attacker", PROJECT_FLAG: "on" },
    });

    const envs = handle.ptyCreates[0].envs;
    expect(envs.HOME).toBe("/home/litt");
    expect(envs.LITTREE_USER_ID).toBe("user-1");
    expect(envs.PROJECT_FLAG).toBe("on");
  });

  it("refuses the terminal's OWN platform-secret value in caller env BEFORE any SDK PTY call", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const secretValue = "platform-terminal-secret-value";
    const saved = process.env.TERMINAL_AUTH_SECRET;
    process.env.TERMINAL_AUTH_SECRET = secretValue;
    try {
      await expect(
        provider.connectTerminal(instance.sandboxId, {
          shell: "bash",
          cols: 80,
          rows: 24,
          env: { INNOCENT_NAME: secretValue },
        }),
      ).rejects.toBeInstanceOf(SandboxEnvSecretError);
      expect(handle.ptyCreates).toHaveLength(0);

      // A project's OWN secret under a platform NAME is fine — the
      // guard is by value, exactly like execute()'s per-command env.
      await provider.connectTerminal(instance.sandboxId, {
        shell: "bash",
        cols: 80,
        rows: 24,
        env: { CLERK_SECRET_KEY: "the-projects-own-key" },
      });
      expect(handle.ptyCreates).toHaveLength(1);
      expect(handle.ptyCreates[0].envs.CLERK_SECRET_KEY).toBe("the-projects-own-key");
    } finally {
      if (saved === undefined) delete process.env.TERMINAL_AUTH_SECRET;
      else process.env.TERMINAL_AUTH_SECRET = saved;
    }
  });

  it("write goes through the ordered input stream, in call order", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const transport = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });

    transport.write("ls -la\r");
    transport.write("pwd\r");
    // send() is async on the fake; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(handle.ptyInputs[0].sent).toEqual(["ls -la\r", "pwd\r"]);
    expect(handle.ptyInputs[0].pid).toBe(101);
  });

  it("decodes output to strings and replays pre-registration output to the first listener", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const transport = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });
    const pty = handle.ptys.get(101)!;

    // The shell prints its prompt before anyone registers onOutput.
    pty.emit("litt@workspace:~$ ");
    const seen: string[] = [];
    transport.onOutput((d) => seen.push(d));
    expect(seen).toEqual(["litt@workspace:~$ "]);

    pty.emit("hello\r\n");
    expect(seen).toEqual(["litt@workspace:~$ ", "hello\r\n"]);
  });

  it("onExit carries the real exit code; a stream death without a result reports -1", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);

    const t1 = await provider.connectTerminal(instance.sandboxId, { shell: "bash", cols: 80, rows: 24 });
    const exits1: Array<{ exitCode: number }> = [];
    t1.onExit((info) => exits1.push(info));
    handle.ptys.get(101)!.end(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(exits1).toEqual([{ exitCode: 3 }]);

    const t2 = await provider.connectTerminal(instance.sandboxId, { shell: "bash", cols: 80, rows: 24 });
    const exits2: Array<{ exitCode: number }> = [];
    t2.onExit((info) => exits2.push(info));
    handle.ptys.get(102)!.failStream(new Error("Process exited without a result"));
    await Promise.resolve();
    await Promise.resolve();
    expect(exits2).toEqual([{ exitCode: -1 }]);
  });

  it("resize and kill forward the right pid (resize clamps too)", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const transport = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });

    transport.resize(1000, 40);
    await Promise.resolve();
    expect(handle.ptyResizes).toEqual([{ pid: 101, cols: 500, rows: 40 }]);

    transport.kill();
    await Promise.resolve();
    expect(handle.ptyKills).toEqual([101]);
  });

  it("starts a stopped sandbox before attaching", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    await provider.stop(instance.sandboxId);
    expect(handle.paused).toBe(true);

    await provider.connectTerminal(instance.sandboxId, { shell: "bash", cols: 80, rows: 24 });
    expect(client.connectCalls).toBe(1);
    expect(handle.ptyCreates).toHaveLength(1);
  });

  it("unknown sandbox throws SandboxNotFoundError", async () => {
    const provider = makeProvider(new FakeE2bClient());
    await expect(
      provider.connectTerminal("e2b-nope", { shell: "bash", cols: 80, rows: 24 }),
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
    await expect(
      provider.reattachTerminal("e2b-nope", "e2b-nope:5", { shell: "bash", cols: 80, rows: 24 }),
    ).rejects.toBeInstanceOf(SandboxNotFoundError);
  });

  it("reattachTerminal reconnects the same pid with the pinned timeout", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const first = await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    });

    const second = await provider.reattachTerminal(instance.sandboxId, first.sessionId, {
      shell: "bash",
      cols: 100,
      rows: 30,
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(handle.ptyConnects).toHaveLength(1);
    expect(handle.ptyConnects[0].pid).toBe(101);
    expect(handle.ptyConnects[0].opts.timeoutMs).toBe(3_600_000);
    expect(handle.ptyConnects[0].opts.timeoutMs).not.toBe(60_000);
    // No second PTY was created.
    expect(handle.ptyCreates).toHaveLength(1);
  });

  it("reattachTerminal refuses session ids that do not name a pid of this sandbox", async () => {
    const client = new FakeE2bClient();
    const { provider, instance } = await createWithSandbox(client);
    await expect(
      provider.reattachTerminal(instance.sandboxId, "someone-elses-sandbox:101", {
        shell: "bash",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow(/Invalid sandbox terminal session id/);
    await expect(
      provider.reattachTerminal(instance.sandboxId, `${instance.sandboxId}:not-a-pid`, {
        shell: "bash",
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow(/Invalid sandbox terminal session id/);
  });

  it("transport.disconnect stops the stream without killing the PTY", async () => {
    const client = new FakeE2bClient();
    const { provider, instance, handle } = await createWithSandbox(client);
    const transport = (await provider.connectTerminal(instance.sandboxId, {
      shell: "bash",
      cols: 80,
      rows: 24,
    })) as { disconnect: () => void };

    transport.disconnect();
    await Promise.resolve();
    expect(handle.ptys.get(101)!.disconnected).toBe(true);
    expect(handle.ptyKills).toEqual([]);
  });
});

/**
 * Provisioning fix (2026-11-19): the provider registry is in-memory,
 * so a terminal-process restart emptied it while the sandboxes lived
 * on at E2B — get() returned null for every persisted binding, boot
 * reconcile deleted them all, and the next ensure paid a full cold
 * create+mirror. get() now re-adopts by id, recovering identity from
 * the create-time metadata, and fails closed whenever identity
 * cannot be proven. A "restart" is modeled as a second provider
 * instance over the same fake client.
 */
describe("E2bSandboxProvider — re-adoption after restart (provisioning fix)", () => {
  it("get() re-adopts a live sandbox the registry has never seen, recovering identity from metadata", async () => {
    const client = new FakeE2bClient();
    const creator = makeProvider(client);
    const instance = await creator.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });

    const restarted = makeProvider(client);
    const adopted = await restarted.get(instance.sandboxId);
    expect(adopted).not.toBeNull();
    expect(adopted?.userId).toBe("user-1");
    expect(adopted?.projectId).toBe("proj-1");
    expect(adopted?.workspaceId).toBe("ws-1");
    expect(adopted?.state).toBe("running");
    expect(client.connectCalls).toBe(1);

    // The registry is repopulated: a second get() serves the entry
    // (with its liveness probe) without reconnecting.
    const again = await restarted.get(instance.sandboxId);
    expect(again?.sandboxId).toBe(instance.sandboxId);
    expect(client.connectCalls).toBe(1);

    // The adopted env is recomposed from the recovered identity:
    // commands through the new provider see the real sandbox id.
    const idResult = await restarted.execute(instance.sandboxId, {
      command: "printenv LITTREE_SANDBOX_ID",
    });
    expect(idResult.stdout.trim()).toBe(instance.sandboxId);
    const who = await restarted.execute(instance.sandboxId, {
      command: "printenv LITTREE_USER_ID",
    });
    expect(who.stdout.trim()).toBe("user-1");
  });

  it("adopts an existing-but-not-running sandbox as stopped, then serves it from the registry", async () => {
    const client = new FakeE2bClient();
    const creator = makeProvider(client);
    const instance = await creator.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    client.handles.get(instance.sandboxId)!.forceNotRunning = true;

    const restarted = makeProvider(client);
    const adopted = await restarted.get(instance.sandboxId);
    // Registered stopped — the executor's start() resume branch and
    // reconcile's paused handling apply to it unchanged.
    expect(adopted?.state).toBe("stopped");
    expect(client.connectCalls).toBe(1);
    const again = await restarted.get(instance.sandboxId);
    expect(again?.state).toBe("stopped");
    expect(client.connectCalls).toBe(1);
  });

  it("get() returns null for an id E2B no longer has — the dead id falls through", async () => {
    const client = new FakeE2bClient();
    const provider = makeProvider(client);
    await expect(provider.get("e2b-gone")).resolves.toBeNull();
    expect(client.connectCalls).toBe(1);
  });

  it("adoption fails closed when the sandbox carries no identity metadata", async () => {
    const client = new FakeE2bClient();
    // A sandbox created outside this provider: no littree_* tags.
    const foreign = await client.create({
      template: "litt-test-template",
      timeoutMs: 60_000,
      envs: {},
      metadata: {},
      cpuCount: 1,
      memoryMB: 512,
      network: { denyOut: [] },
    });
    const provider = makeProvider(client);
    await expect(provider.get(foreign.sandboxId)).resolves.toBeNull();
  });

  it("adoption fails closed when any one identity field is missing", async () => {
    const client = new FakeE2bClient();
    const creator = makeProvider(client);
    const instance = await creator.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    delete client.handles.get(instance.sandboxId)!.metadata.littree_workspace_id;

    const restarted = makeProvider(client);
    await expect(restarted.get(instance.sandboxId)).resolves.toBeNull();
  });
});

/**
 * Provisioning fix (2026-11-19): every awaited SDK call carries a
 * request deadline. Before this, one stalled call among the
 * mirror's thousands of sequential files calls wedged the workspace
 * lock chain indefinitely. The deadline rejects with
 * E2bRequestTimeoutError; the underlying call is never cancelled.
 */
describe("E2bSandboxProvider — per-call request deadlines (provisioning fix)", () => {
  it("a hanging file read rejects with E2bRequestTimeoutError inside the injected deadline", async () => {
    const client = new FakeE2bClient();
    const provider = new E2bSandboxProvider({
      apiKey: API_KEY,
      client,
      templateId: "litt-test-template",
      requestTimeoutMs: 50,
    });
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    client.handles.get(instance.sandboxId)!.hangReads = true;

    const startedAt = Date.now();
    const failure = await provider.fileTransfer
      .readFile(instance.sandboxId, "/workspace/never.txt")
      .then(
        () => null,
        (err: unknown) => err as Error,
      );
    expect(failure).toBeInstanceOf(E2bRequestTimeoutError);
    expect(failure!.message).toContain("did not settle within 50 ms");
    // The rejection arrived on the deadline's clock, not the hang's.
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });

  it("a healthy call inside the deadline is untouched by it", async () => {
    const client = new FakeE2bClient();
    const provider = new E2bSandboxProvider({
      apiKey: API_KEY,
      client,
      templateId: "litt-test-template",
      requestTimeoutMs: 50,
    });
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    await provider.fileTransfer.writeFile(
      instance.sandboxId,
      "/workspace/a.txt",
      new TextEncoder().encode("content"),
    );
    const bytes = await provider.fileTransfer.readFile(instance.sandboxId, "/workspace/a.txt");
    expect(new TextDecoder().decode(bytes)).toBe("content");
  });
});
