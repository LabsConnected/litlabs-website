/**
 * Value-based platform-secret check + per-command project env
 * (Phase 2, design note §3.4).
 *
 * The create-time BASE env stays name-guarded (env.ts
 * assertNoPlatformSecrets). Per-command PROJECT env is guarded by
 * VALUE instead, so:
 *   1. a project's OWN Clerk keys (same names, different values) are
 *      accepted for that one command;
 *   2. the terminal's OWN platform-secret VALUES are refused under
 *      any name, before any provider/SDK call;
 *   3. identity variables in per-command env never win;
 *   4. per-command env layers over the base env for one command and
 *      does not persist into the next;
 *   5. the router passes env through to the provider.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import {
  assertNoPlatformSecretValues,
  collectPlatformSecretValues,
  guardPerCommandProjectEnv,
  SandboxEnvSecretError,
} from "../sandbox/env";
import {
  E2bSandboxProvider,
  type E2bClient,
  type E2bCreateOptions,
  type E2bSandboxHandle,
} from "../sandbox/e2b-provider";
import { SandboxVerificationService } from "../sandbox/verification";
import { SandboxExecGate, SandboxExecRouter } from "../sandbox/exec-router";
import {
  createCompliantFakeProvider,
  FakeSandboxProvider,
} from "../sandbox/testing/fake-providers";

const PLATFORM_CLERK = "sk_test_PLATFORM_clerk_value_0123456789";
const PROJECT_CLERK = "sk_test_PROJECT_clerk_value_9876543210";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("collectPlatformSecretValues", () => {
  it("collects the terminal's own values for platform-secret names", () => {
    const values = collectPlatformSecretValues({
      CLERK_SECRET_KEY: PLATFORM_CLERK,
      STRIPE_SECRET_KEY: "sk_live_platform_stripe_value",
      PATH: "/usr/bin",
    });
    expect(values.has(PLATFORM_CLERK)).toBe(true);
    expect(values.has("sk_live_platform_stripe_value")).toBe(true);
    expect(values.has("/usr/bin")).toBe(false);
  });

  it("ignores empty and implausibly short values (false-positive guard)", () => {
    const values = collectPlatformSecretValues({
      CLERK_SECRET_KEY: "",
      DATABASE_URL: "short",
    });
    expect(values.size).toBe(0);
  });
});

describe("value-based check", () => {
  const platformValues = collectPlatformSecretValues({
    CLERK_SECRET_KEY: PLATFORM_CLERK,
  });

  it("accepts a project's OWN secret under a platform-secret NAME", () => {
    expect(() =>
      assertNoPlatformSecretValues({ CLERK_SECRET_KEY: PROJECT_CLERK }, platformValues),
    ).not.toThrow();
  });

  it("refuses the platform's VALUE under any name, naming only the carrier key", () => {
    try {
      assertNoPlatformSecretValues({ TOTALLY_INNOCENT: PLATFORM_CLERK }, platformValues);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SandboxEnvSecretError);
      expect((err as Error).message).toContain("TOTALLY_INNOCENT");
      expect((err as Error).message).not.toContain(PLATFORM_CLERK);
    }
  });
});

describe("guardPerCommandProjectEnv", () => {
  const platformValues = collectPlatformSecretValues({
    CLERK_SECRET_KEY: PLATFORM_CLERK,
  });

  it("drops identity vars (identity always wins) and keeps project vars", () => {
    const cleaned = guardPerCommandProjectEnv(
      { LITTREE_USER_ID: "user_attacker", MY_FLAG: "1" },
      platformValues,
    );
    expect(cleaned).toEqual({ MY_FLAG: "1" });
  });

  it("refuses a platform value hiding in project env", () => {
    expect(() =>
      guardPerCommandProjectEnv({ NEXT_PUBLIC_API_URL: PLATFORM_CLERK }, platformValues),
    ).toThrow(SandboxEnvSecretError);
  });
});

// ─── E2B provider: per-command env end to end ───────────────────────

class FakeE2bHandle implements E2bSandboxHandle {
  readonly sandboxId: string;
  private readonly createEnvs: Record<string, string>;
  readonly runEnvs: Array<Record<string, string> | undefined> = [];

  constructor(sandboxId: string, envs: Record<string, string>) {
    this.sandboxId = sandboxId;
    this.createEnvs = envs;
  }

  async runCommand(
    command: string,
    opts: { cwd?: string; timeoutMs?: number; stdin?: string; envs?: Record<string, string> },
  ) {
    this.runEnvs.push(opts.envs);
    const env = { ...this.createEnvs, ...(opts.envs ?? {}) };
    const printenv = command.match(/^printenv (\S+)$/);
    if (printenv) {
      const v = env[printenv[1]];
      return v === undefined
        ? { exitCode: 1, stdout: "", stderr: "" }
        : { exitCode: 0, stdout: `${v}\n`, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  }

  getHost(port: number): string {
    return `${this.sandboxId}-${port}.proxy.e2b.test`;
  }
  async setTimeout(): Promise<void> {}
  async pause(): Promise<boolean> {
    return true;
  }
  async kill(): Promise<boolean> {
    return true;
  }
  async isRunning(): Promise<boolean> {
    return true;
  }
}

class FakeE2bClient implements E2bClient {
  readonly handles = new Map<string, FakeE2bHandle>();
  private seq = 0;
  async create(opts: E2bCreateOptions): Promise<E2bSandboxHandle> {
    this.seq += 1;
    const handle = new FakeE2bHandle(`e2b-env-${this.seq}`, opts.envs);
    this.handles.set(handle.sandboxId, handle);
    return handle;
  }
  async connect(sandboxId: string): Promise<E2bSandboxHandle> {
    const handle = this.handles.get(sandboxId);
    if (!handle) throw new Error(`no such sandbox ${sandboxId}`);
    return handle;
  }
  async probe(): Promise<void> {}
}

const IDENTITY = { userId: "user_1", projectId: "proj_1", workspaceId: "ws-proj_1" };

describe("E2bSandboxProvider.execute per-command env", () => {
  it("layers project env over the base env for one command only", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", PLATFORM_CLERK);
    const client = new FakeE2bClient();
    const provider = new E2bSandboxProvider({
      apiKey: "e2b_test_key",
      client,
      templateId: "litt-test-template",
    });
    const ref = await provider.create({ ...IDENTITY });

    // The project's OWN Clerk key: same name as a platform secret,
    // different value — accepted, visible to this command.
    const withEnv = await provider.execute(ref.sandboxId, {
      command: "printenv CLERK_SECRET_KEY",
      env: { CLERK_SECRET_KEY: PROJECT_CLERK },
    });
    expect(withEnv.stdout).toBe(`${PROJECT_CLERK}\n`);

    // Next command, no env: the base env is back (no CLERK key there).
    const without = await provider.execute(ref.sandboxId, {
      command: "printenv CLERK_SECRET_KEY",
    });
    expect(without.exitCode).toBe(1);
  });

  it("refuses the terminal's own platform value before any SDK command runs", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_the_platforms_own_stripe_key");
    const client = new FakeE2bClient();
    const provider = new E2bSandboxProvider({
      apiKey: "e2b_test_key",
      client,
      templateId: "litt-test-template",
    });
    const ref = await provider.create({ ...IDENTITY });
    const handle = client.handles.get(ref.sandboxId) as FakeE2bHandle;

    await expect(
      provider.execute(ref.sandboxId, {
        command: "printenv HARMLESS_NAME",
        env: { HARMLESS_NAME: "sk_live_the_platforms_own_stripe_key" },
      }),
    ).rejects.toBeInstanceOf(SandboxEnvSecretError);
    expect(handle.runEnvs).toHaveLength(0); // SDK never saw a command
  });

  it("identity in per-command env never overrides the composed identity", async () => {
    const client = new FakeE2bClient();
    const provider = new E2bSandboxProvider({
      apiKey: "e2b_test_key",
      client,
      templateId: "litt-test-template",
    });
    const ref = await provider.create({ ...IDENTITY });
    const res = await provider.execute(ref.sandboxId, {
      command: "printenv LITTREE_USER_ID",
      env: { LITTREE_USER_ID: "user_attacker" },
    });
    expect(res.stdout).toBe("user_1\n");
  });
});

// ─── Router: env passthrough ─────────────────────────────────────────

describe("SandboxExecRouter per-command env", () => {
  it("passes request env to the provider for that command only", async () => {
    const verification = new SandboxVerificationService(
      createCompliantFakeProvider(),
      { canary: { runId: "env-passthrough-test" } },
    );
    const report = await verification.runNow();
    expect(report.passed).toBe(true);
    const gate = new SandboxExecGate({
      providerEnabled: true,
      routingEnabled: true,
      isOwner: () => true,
      isVerified: () => verification.isVerified(),
    });
    const router = new SandboxExecRouter(new FakeSandboxProvider(), gate, {
      log: () => {},
    });

    const withEnv = await router.tryExecute({
      ...IDENTITY,
      command: "printenv MY_FLAG",
      env: { MY_FLAG: "from-request" },
    });
    expect(withEnv).not.toBeNull();
    expect(withEnv!.result.stdout).toBe("from-request\n");

    const without = await router.tryExecute({ ...IDENTITY, command: "printenv MY_FLAG" });
    expect(without).not.toBeNull();
    expect(without!.result.exitCode).toBe(1);
  });
});
