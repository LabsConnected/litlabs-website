import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { DockerSandboxProvider, type DockerCommandRunner } from "@/lib/terminal-v1/providers/docker-provider";
import { getSandboxProvider, resetSandboxProvider } from "@/lib/terminal-v1/providers";
import { DEFAULT_SANDBOX_LIMITS } from "@/lib/terminal-v1/types";
import type { ChildProcessWithoutNullStreams } from "child_process";

// Create a mock runner that doesn't touch real Docker
function createMockRunner(): DockerCommandRunner {
  const mockProc: Partial<ChildProcessWithoutNullStreams> = {
    stdout: { on: vi.fn() } as unknown as ChildProcessWithoutNullStreams["stdout"],
    stderr: { on: vi.fn() } as unknown as ChildProcessWithoutNullStreams["stderr"],
    stdin: { write: vi.fn() } as unknown as ChildProcessWithoutNullStreams["stdin"],
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
    pid: 12345,
  };

  return {
    exec: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
    spawn: vi.fn(() => mockProc as ChildProcessWithoutNullStreams),
  };
}

describe("Terminal V1 — Docker Sandbox Provider", () => {
  let runner: DockerCommandRunner;
  let provider: DockerSandboxProvider;

  beforeEach(() => {
    vi.stubEnv("TERMINAL_PROVIDER", "managed-sandbox");
    vi.stubEnv("TERMINAL_AUTH_SECRET", "a".repeat(64));
    vi.stubEnv("TERMINAL_SANDBOX_IMAGE", "littree-terminal-sandbox:test");
    vi.resetModules();
    resetSandboxProvider();
    runner = createMockRunner();
    provider = new DockerSandboxProvider(runner);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    resetSandboxProvider();
  });

  it("provider name is managed-sandbox", () => {
    expect(provider.name).toBe("managed-sandbox");
  });

  it("create returns a sandbox instance with correct fields", async () => {
    const sandbox = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    expect(sandbox.sandboxId).toMatch(/^sbx-/);
    expect(sandbox.workspaceId).toBe("ws-aaa");
    expect(sandbox.userId).toBe("user-aaa");
    expect(sandbox.projectId).toBe("proj-aaa");
    expect(sandbox.state).toBe("running");
    expect(sandbox.provider).toBe("managed-sandbox");
    expect(sandbox.limits).toEqual(DEFAULT_SANDBOX_LIMITS);
    expect(sandbox.createdAt).toBeTruthy();
    expect(sandbox.startedAt).toBeTruthy();
    expect(sandbox.stoppedAt).toBeNull();
  });

  it("create applies custom limits", async () => {
    const sandbox = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
      limits: { cpuVcpus: 2, memoryMB: 2048 },
    });

    expect(sandbox.limits.cpuVcpus).toBe(2);
    expect(sandbox.limits.memoryMB).toBe(2048);
    expect(sandbox.limits.processLimit).toBe(DEFAULT_SANDBOX_LIMITS.processLimit);
  });

  it("create calls docker with correct resource limit args", async () => {
    const execSpy = runner.exec as ReturnType<typeof vi.fn>;
    await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
      limits: { cpuVcpus: 2, memoryMB: 2048, processLimit: 200 },
    });

    // Find the container create call (first arg is "create")
    const createCall = execSpy.mock.calls.find(
      (call: unknown[]) => (call[0] as string[])[0] === "create",
    );
    expect(createCall).toBeDefined();
    const createArgs = createCall![0] as string[];
    expect(createArgs).toContain("--cpus");
    expect(createArgs).toContain("2");
    expect(createArgs).toContain("--memory");
    expect(createArgs).toContain("2048m");
    expect(createArgs).toContain("--pids-limit");
    expect(createArgs).toContain("200");
  });

  it("create does not pass platform secrets in env", async () => {
    const execSpy = runner.exec as ReturnType<typeof vi.fn>;
    await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    const createCall = execSpy.mock.calls.find(
      (call: unknown[]) => (call[0] as string[])[0] === "create",
    );
    const createArgs = createCall![0] as string[];
    const envString = createArgs.join(" ");
    expect(envString).not.toContain("CLERK_SECRET_KEY");
    expect(envString).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(envString).not.toContain("DATABASE_URL");
    expect(envString).not.toContain("STRIPE_SECRET_KEY");
    expect(envString).not.toContain("TERMINAL_AUTH_SECRET");
  });

  it("create passes LITTREE identity env vars", async () => {
    const execSpy = runner.exec as ReturnType<typeof vi.fn>;
    await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    const createCall = execSpy.mock.calls.find(
      (call: unknown[]) => (call[0] as string[])[0] === "create",
    );
    const createArgs = createCall![0] as string[];
    const envString = createArgs.join(" ");
    expect(envString).toContain("LITTREE_USER_ID=user-aaa");
    expect(envString).toContain("LITTREE_PROJECT_ID=proj-aaa");
    expect(envString).toContain("LITTREE_WORKSPACE_ID=ws-aaa");
  });

  it("get returns sandbox by id", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    const fetched = await provider.get(created.sandboxId);
    expect(fetched).not.toBeNull();
    expect(fetched!.sandboxId).toBe(created.sandboxId);
  });

  it("get returns null for unknown sandbox", async () => {
    const fetched = await provider.get("unknown-sbx");
    expect(fetched).toBeNull();
  });

  it("get returns null for deleted sandbox", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    await provider.destroy(created.sandboxId);
    const fetched = await provider.get(created.sandboxId);
    expect(fetched).toBeNull();
  });

  it("user A sandbox differs from user B sandbox", async () => {
    const sandboxA = await provider.create({
      workspaceId: "ws-a",
      userId: "user-a",
      projectId: "proj-a",
    });
    const sandboxB = await provider.create({
      workspaceId: "ws-b",
      userId: "user-b",
      projectId: "proj-b",
    });

    expect(sandboxA.sandboxId).not.toBe(sandboxB.sandboxId);
    expect(sandboxA.userId).not.toBe(sandboxB.userId);
  });

  it("project A sandbox differs from project B sandbox", async () => {
    const sandboxA = await provider.create({
      workspaceId: "ws-a",
      userId: "user-a",
      projectId: "proj-a",
    });
    const sandboxB = await provider.create({
      workspaceId: "ws-b",
      userId: "user-a",
      projectId: "proj-b",
    });

    expect(sandboxA.sandboxId).not.toBe(sandboxB.sandboxId);
    expect(sandboxA.projectId).not.toBe(sandboxB.projectId);
  });

  it("stop changes state to stopped", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    await provider.stop(created.sandboxId);
    const fetched = await provider.get(created.sandboxId);
    expect(fetched!.state).toBe("stopped");
    expect(fetched!.stoppedAt).not.toBeNull();
  });

  it("start changes state back to running", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    await provider.stop(created.sandboxId);
    await provider.start(created.sandboxId);
    const fetched = await provider.get(created.sandboxId);
    expect(fetched!.state).toBe("running");
  });

  it("destroy removes sandbox from registry", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    await provider.destroy(created.sandboxId);
    const fetched = await provider.get(created.sandboxId);
    expect(fetched).toBeNull();
  });

  it("destroy calls docker rm -f and volume rm", async () => {
    const execSpy = runner.exec as ReturnType<typeof vi.fn>;
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    await provider.destroy(created.sandboxId);
    const calls = execSpy.mock.calls.map((c: unknown[]) => (c[0] as string[]).join(" "));
    expect(calls.some((c) => c.includes("rm -f"))).toBe(true);
    expect(calls.some((c) => c.includes("volume rm"))).toBe(true);
  });

  it("connectTerminal throws for non-existent sandbox", async () => {
    await expect(
      provider.connectTerminal("unknown", { shell: "bash", cols: 80, rows: 24 }),
    ).rejects.toThrow("Sandbox not found");
  });

  it("execute throws for non-existent sandbox", async () => {
    await expect(
      provider.execute("unknown", { command: "ls" }),
    ).rejects.toThrow("Sandbox not found");
  });

  it("exposePort returns a private preview endpoint", async () => {
    const created = await provider.create({
      workspaceId: "ws-aaa",
      userId: "user-aaa",
      projectId: "proj-aaa",
    });

    const preview = await provider.exposePort(created.sandboxId, 3000);
    expect(preview.port).toBe(3000);
    expect(preview.state).toBe("private");
    expect(preview.previewToken).toBeTruthy();
    expect(preview.url).toContain(created.sandboxId);
  });

  it("health returns healthy when docker is reachable", async () => {
    const health = await provider.health();
    expect(health.healthy).toBe(true);
    expect(health.details?.dockerVersion).toBe("ok");
  });

  it("health returns unhealthy when docker fails", async () => {
    const failingRunner = createMockRunner();
    (failingRunner.exec as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("docker not found"));
    const failingProvider = new DockerSandboxProvider(failingRunner);
    const health = await failingProvider.health();
    expect(health.healthy).toBe(false);
  });

  it("getSandboxProvider returns DockerSandboxProvider when TERMINAL_PROVIDER=managed-sandbox", () => {
    vi.stubEnv("TERMINAL_PROVIDER", "managed-sandbox");
    resetSandboxProvider();
    const provider = getSandboxProvider();
    expect(provider.name).toBe("managed-sandbox");
  });
});
