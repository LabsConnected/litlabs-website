/**
 * Preview async start (C3/C4).
 *
 * Proves the three behaviors the fix exists for:
 *   1. startPreviewAccepted returns promptly with the "starting"
 *      runtime while the start's long phase (here: a gated sandbox
 *      dependency install) is still running in the background, and
 *      the runtime later settles to its real verdict. A second
 *      accept during the flight joins it — no second install.
 *   2. A background failure settles the registered runtime to
 *      failed with its typed code (status polling is the verdict
 *      channel), while fast validation failures still reject the
 *      accept call itself, exactly as the synchronous start did.
 *   3. PreviewEndpoint.expiresAt tells the truth: the fake provider
 *      reports its tracked lifetime (create / extendTimeout), and
 *      the E2B provider prefers the sandbox's server-reported
 *      endAt over any offset — and the runtime upstream records the
 *      post-extension expiry, not the pre-extension one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { ExecuteCommandInput, ExecuteCommandResult } from "../sandbox/provider";
import {
  E2bSandboxProvider,
  type E2bClient,
  type E2bSandboxHandle,
} from "../sandbox/e2b-provider";
import {
  startPreviewAccepted,
  getPreviewStatus,
  getPreviewUpstream,
  registerSandboxPreviewSupport,
  stopPreviewAndWait,
} from "../preview/PreviewManager";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";

useTrustedLocalEnv();

const OWNER = "user_owner_async_start";
const OTHER = "user_other_async_start";

/**
 * Fake provider whose dependency installs can be held open (a
 * deferred gate) and/or forced to fail, so tests can observe the
 * start's background phase mid-flight. The install command is the
 * only gated shape; everything else runs the faithful fake.
 */
class GatedInstallProvider extends FakeSandboxProvider {
  installCalls = 0;
  private gate: Promise<void> | null = null;
  private releaseGate: (() => void) | null = null;
  failInstall = false;

  holdInstalls(): void {
    if (!this.gate) {
      this.gate = new Promise<void>((resolve) => {
        this.releaseGate = resolve;
      });
    }
  }

  releaseInstalls(): void {
    this.releaseGate?.();
    this.gate = null;
    this.releaseGate = null;
  }

  override async execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    if (/\binstall\b/.test(input.command)) {
      this.installCalls += 1;
      if (this.gate) await this.gate;
      if (this.failInstall) {
        return { exitCode: 1, stdout: "", stderr: "install boom", durationMs: 1 };
      }
    }
    return super.execute(sandboxId, input);
  }
}

let volumeParent: string;
let provider: GatedInstallProvider;
let executor: SandboxWorkspaceExecutor;
let workspaceId: string;

function openGate(p: FakeSandboxProvider): SandboxExecGate {
  return new SandboxExecGate({
    providerEnabled: true,
    routingEnabled: true,
    isOwner: (userId) => userId === OWNER,
    isVerified: () => true,
    templateId: "fake-template",
    provider: p,
  });
}

function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>app</html>", { status: 200, headers: { "content-type": "text/html" } })),
  );
}

async function waitForStatus(status: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPreviewStatus(workspaceId)?.status === status) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`preview never reached status ${status}; now ${getPreviewStatus(workspaceId)?.status}`);
}

beforeEach(async () => {
  volumeParent = mkdtempSync(join(tmpdir(), "litt-preview-async-"));
  provider = new GatedInstallProvider({
    cloneFiles: {
      "package.json": JSON.stringify({ name: "app", scripts: { dev: "node server.js" } }),
      "server.js": "console.log('app');\n",
    },
  });
  executor = new SandboxWorkspaceExecutor({
    provider,
    gate: openGate(provider),
    templateId: "fake-template",
    log: () => {},
  });
  registerSandboxPreviewSupport({ executor, provider });
  const ws = await executor.prepareRepoWorkspace({
    userId: OWNER,
    projectId: "proj-async-start",
    installationId: 7,
    owner: "acme",
    repo: "site",
    branch: "main",
    workspaceRoot: volumeParent,
    githubToken: ["test", "scoped", "token", "0003"].join("-"),
  });
  workspaceId = ws.workspaceId;
});

afterEach(async () => {
  provider.releaseInstalls();
  await stopPreviewAndWait(workspaceId).catch(() => {});
  registerSandboxPreviewSupport(null);
  vi.unstubAllGlobals();
  rmSync(volumeParent, { recursive: true, force: true });
});

describe("startPreviewAccepted", () => {
  it("returns promptly with the starting runtime while the install is still gated, then settles ready", async () => {
    stubFetchOk();
    provider.holdInstalls();

    const startedAt = Date.now();
    const runtime = await startPreviewAccepted({
      workspaceId,
      userId: OWNER,
      framework: "custom",
      command: "node server.js --port $PORT",
      packageManager: "pnpm",
    });
    const elapsedMs = Date.now() - startedAt;

    // The accept resolved on registration — nowhere near the gated
    // install's (unbounded) duration.
    expect(elapsedMs).toBeLessThan(5_000);
    expect(runtime.status).toBe("starting");
    expect(getPreviewStatus(workspaceId)?.status).toBe("starting");
    // The background flight reaches the install and parks on the gate.
    const installDeadline = Date.now() + 5_000;
    while (provider.installCalls === 0 && Date.now() < installDeadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(provider.installCalls).toBeGreaterThan(0);
    expect(getPreviewStatus(workspaceId)?.status).toBe("starting");

    provider.releaseInstalls();
    await waitForStatus("ready");
  }, 20_000);

  it("a second accept during the flight joins it — no second install runs", async () => {
    stubFetchOk();
    provider.holdInstalls();

    const [first, second] = await Promise.all([
      startPreviewAccepted({
        workspaceId, userId: OWNER, framework: "custom",
        command: "node server.js --port $PORT", packageManager: "pnpm",
      }),
      startPreviewAccepted({
        workspaceId, userId: OWNER, framework: "custom",
        command: "node server.js --port $PORT", packageManager: "pnpm",
      }),
    ]);
    expect(first.status).toBe("starting");
    expect(second.status).toBe("starting");

    provider.releaseInstalls();
    await waitForStatus("ready");
    // Prepare's background install and the start's install adopt one
    // single flight; two accepts must not add another.
    expect(provider.installCalls).toBe(1);
  }, 20_000);

  it("a background install failure settles the runtime failed with its typed code", async () => {
    stubFetchOk();
    provider.holdInstalls();
    provider.failInstall = true;

    const runtime = await startPreviewAccepted({
      workspaceId, userId: OWNER, framework: "custom",
      command: "node server.js --port $PORT", packageManager: "pnpm",
    });
    expect(runtime.status).toBe("starting");

    provider.releaseInstalls();
    await waitForStatus("failed");
    const status = getPreviewStatus(workspaceId);
    expect(status?.errorCode).toBe("preview_dependency_install_failed");
    expect(status?.error).toContain("install boom");
  }, 20_000);

  it("fast validation failures still reject the accept itself", async () => {
    await expect(
      startPreviewAccepted({ workspaceId: "ws-does-not-exist", userId: OWNER }),
    ).rejects.toMatchObject({ code: "preview_workspace_not_found" });

    await expect(
      startPreviewAccepted({ workspaceId, userId: OTHER }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("truthful expiresAt", () => {
  it("the fake provider reports its tracked lifetime, and extendTimeout moves it", async () => {
    const fake = new FakeSandboxProvider();
    const instance = await fake.create({
      workspaceId: "ws-expiry",
      userId: OWNER,
      projectId: "proj-expiry",
    });
    const before = Date.now();
    const first = await fake.exposePort(instance.sandboxId, 3000);
    const firstMs = Date.parse(first.expiresAt);
    // Session-scale lifetime (60 min), never the old synthetic
    // now + 15 min idle offset.
    expect(firstMs).toBeGreaterThan(before + 30 * 60_000);
    expect(firstMs).toBeLessThan(before + 75 * 60_000);

    await fake.extendTimeout(instance.sandboxId, 120 * 60_000);
    const second = await fake.exposePort(instance.sandboxId, 3000);
    expect(Date.parse(second.expiresAt)).toBeGreaterThan(firstMs + 45 * 60_000);
  });

  it("the runtime upstream records the post-extension expiry", async () => {
    stubFetchOk();
    await startPreviewAccepted({
      workspaceId, userId: OWNER, framework: "custom",
      command: "node server.js --port $PORT", packageManager: "npx",
    });
    await waitForStatus("ready");
    const upstream = getPreviewUpstream(workspaceId);
    expect(upstream?.kind).toBe("sandbox");
    // startSandboxPreview extends the session by 120 minutes after
    // the first exposure; the recorded expiry must reflect that
    // extension, not the create-time lifetime (60 min) and never
    // the old synthetic 15-minute offset.
    const expiresAt = (upstream as { expiresAt?: number | null }).expiresAt;
    expect(expiresAt).not.toBeNull();
    expect(expiresAt!).toBeGreaterThan(Date.now() + 90 * 60_000);
  }, 20_000);

  function stubHandle(overrides: Partial<E2bSandboxHandle>): E2bSandboxHandle {
    return {
      sandboxId: "sbx-stub",
      trafficAccessToken: "tok-stub",
      runCommand: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      getHost: () => "3000-sbx-stub.e2b.app",
      setTimeout: async () => {},
      pause: async () => true,
      kill: async () => true,
      isRunning: async () => true,
      readFileBytes: async () => new Uint8Array(),
      writeFileBytes: async () => {},
      listDir: async () => [],
      removePath: async () => {},
      makeDir: async () => {},
      renamePath: async () => {},
      ...overrides,
    };
  }

  function stubClient(handle: E2bSandboxHandle): E2bClient {
    return {
      create: async () => handle,
      connect: async () => handle,
      probe: async () => {},
    };
  }

  it("the E2B provider prefers the sandbox's server-reported endAt", async () => {
    const reportedEndAt = Date.now() + 42 * 60_000;
    const handle = stubHandle({
      getExpiry: async () => reportedEndAt,
    });
    const e2b = new E2bSandboxProvider({ apiKey: "test-key", client: stubClient(handle) });
    const instance = await e2b.create({
      workspaceId: "ws-e2b",
      userId: OWNER,
      projectId: "proj-e2b",
    });
    const endpoint = await e2b.exposePort(instance.sandboxId, 3000);
    expect(endpoint.expiresAt).toBe(new Date(reportedEndAt).toISOString());
  });

  it("the E2B provider falls back to its tracked lifetime when the handle cannot report an expiry", async () => {
    const handle = stubHandle({}); // no getExpiry
    const e2b = new E2bSandboxProvider({ apiKey: "test-key", client: stubClient(handle) });
    const before = Date.now();
    const instance = await e2b.create({
      workspaceId: "ws-e2b",
      userId: OWNER,
      projectId: "proj-e2b",
    });
    const endpoint = await e2b.exposePort(instance.sandboxId, 3000);
    const ms = Date.parse(endpoint.expiresAt);
    // Tracked from the create timeout (maxSessionMinutes = 60 min).
    expect(ms).toBeGreaterThan(before + 30 * 60_000);
    expect(ms).toBeLessThan(before + 75 * 60_000);

    // An extension re-arms the tracked expiry from NOW (E2B counts
    // the lifetime from the last setTimeout call): extending by
    // 30 min moves the expiry EARLIER than the create-time 60 min,
    // which only a tracked, re-armed value can do. (Requests above
    // the 60-minute plan cap are clamped — see clampSandboxTimeoutMs.)
    await e2b.extendTimeout(instance.sandboxId, 30 * 60_000);
    const extended = await e2b.exposePort(instance.sandboxId, 3000);
    const extendedMs = Date.parse(extended.expiresAt);
    expect(extendedMs).toBeLessThan(ms);
    expect(extendedMs).toBeGreaterThan(before + 25 * 60_000);
    expect(extendedMs).toBeLessThan(before + 35 * 60_000);
  });
});
