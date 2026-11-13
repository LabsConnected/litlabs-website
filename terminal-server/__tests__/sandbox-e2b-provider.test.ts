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
  E2bSandboxProvider,
  type E2bClient,
  type E2bCreateOptions,
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
  paused = false;
  killed = false;
  timeoutExtensions: number[] = [];

  constructor(sandboxId: string, envs: Record<string, string>) {
    this.sandboxId = sandboxId;
    this.createEnvs = envs;
  }

  async runCommand(
    command: string,
    opts: { cwd?: string; timeoutMs?: number; stdin?: string; envs?: Record<string, string> },
  ) {
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
    return !this.killed && !this.paused;
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
    const handle = new FakeE2bHandle(`e2b-sbx-${this.seq}`, opts.envs);
    this.handles.set(handle.sandboxId, handle);
    return handle;
  }

  async connect(sandboxId: string): Promise<E2bSandboxHandle> {
    this.connectCalls += 1;
    const handle = this.handles.get(sandboxId);
    if (!handle) throw new Error(`no such sandbox ${sandboxId}`);
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
      limits: { cpuVcpus: 2, memoryMB: 2048 },
    });

    expect(instance.provider).toBe("e2b");
    expect(instance.state).toBe("running");
    expect(instance.limits.cpuVcpus).toBe(2);
    expect(instance.limits.memoryMB).toBe(2048);

    expect(client.creates).toHaveLength(1);
    const createOpts = client.creates[0];
    expect(createOpts.template).toBe("litt-test-template");
    expect(createOpts.cpuCount).toBe(2);
    expect(createOpts.memoryMB).toBe(2048);
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
    expect(fetched?.limits.cpuVcpus).toBe(2);
    expect(fetched?.limits.memoryMB).toBe(2048);
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

  it("connectTerminal refuses explicitly in Phase 1", async () => {
    const provider = makeProvider(new FakeE2bClient());
    const instance = await provider.create({
      workspaceId: "ws-1",
      userId: "user-1",
      projectId: "proj-1",
    });
    await expect(
      provider.connectTerminal(instance.sandboxId, { shell: "bash", cols: 80, rows: 24 }),
    ).rejects.toThrow(/workspace\.exec only/);
  });

  it("satisfies the Phase 0 CanaryProvider subset structurally", () => {
    const provider: CanaryProvider = makeProvider(new FakeE2bClient());
    expect(provider.name).toBe("e2b");
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
});
