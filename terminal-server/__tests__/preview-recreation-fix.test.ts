/**
 * Round 16 follow-up — the recreation-fix lane (2026-11-18).
 *
 * The ingress diagnosis (PREVIEW-INGRESS-DIAGNOSIS-2026-11-18.md)
 * proved three defects behind the failed #1042 live proof and
 * named the observability gaps that made them invisible:
 *
 *   1. Verify was not single-flighted: the panel status route and
 *      the #1042 sweeper could run overlapping rounds for one
 *      workspace, and two rounds racing the recreation gate
 *      produced the contradictory same-second log pair (an
 *      "attempt 1 of 2" announcement AND a "cooldown — not
 *      recreating yet" line). Fixed at the driver level
 *      (PreviewManager.verifyPreviewHealth is single-flight per
 *      workspace) AND at the gate (maybeRecreate re-checks the
 *      in-flight flag after its awaited ground-truth exec).
 *   2. A launched recreation could pend forever in silence —
 *      bookkeeping written, destroy never settling, the in-flight
 *      flag stuck, every later recreation silently suppressed.
 *      Fixed with entry/destroy logging and a settle watchdog
 *      that logs loudly and releases the flag.
 *   3. The failure record could not discriminate: probes
 *      collapsed every throw into "no response", exposePort
 *      never recorded whether the traffic token was the
 *      sandbox's real one or the random fallback, and the
 *      preview proxy's token rejections (the panel's 401) were
 *      logged nowhere. Fixed with probe failure classes, a
 *      token-source log bit, and proxy auth-rejection logging.
 *
 * C2's thresholds (4 rounds / 90 s / cap 2 / 120 s cooldown) are
 * untouched by the lane and by these tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  classifyProbeFailure,
  previewRecreationPromise,
  probeUpstream,
  verifySandboxPreviewHealth,
  PREVIEW_RECREATION_COOLDOWN_MS,
  PREVIEW_RECREATION_FAILURE_THRESHOLD,
  PREVIEW_RECREATION_FAILURE_WINDOW_MS,
  type SandboxPreviewSupport,
  type SandboxProbeResult,
} from "../preview/sandbox-runtime";
import {
  registerSandboxPreviewSupport,
  startPreview,
  stopPreviewAndWait,
  verifyPreviewHealth,
  getPreviewStatus,
} from "../preview/PreviewManager";
import { registerPreviewProxyRoute } from "../preview/proxy";
import {
  E2bSandboxProvider,
  type E2bClient,
  type E2bSandboxHandle,
} from "../sandbox/e2b-provider";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { PreviewRuntime } from "../preview/PreviewManager";
import type { SandboxProvider } from "../sandbox/provider";
import type { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";

useTrustedLocalEnv();

const WS = {
  workspaceId: "ws-preview-home",
  userId: "user-1",
  projectId: "proj-1",
  root: "/volume/ws-preview-home",
  branch: "main",
  commitSha: "",
  ready: true,
} as WorkspaceDescriptor;

function makeRuntime(): PreviewRuntime {
  return {
    workspaceId: "ws-preview-home",
    userId: "user-1",
    projectId: "proj-1",
    process: null,
    port: 0,
    framework: "custom",
    command: "node server.js --port 3000",
    status: "starting",
    startedAt: Date.now(),
    lastHealthCheck: null,
    error: null,
    errorCode: null,
    logs: [],
    clerkEnvFingerprint: null,
    clerkProjectEnv: null,
    upstream: undefined,
  } as PreviewRuntime;
}

const SBX1_ORIGIN = "https://3000-sbx-1.e2b.app";
const SBX2_ORIGIN = "https://3000-sbx-2.e2b.app";

const failing: SandboxProbeResult = {
  healthy: false,
  authConfigError: false,
  rootRouteMissing: false,
  status: null,
};
const healthy: SandboxProbeResult = {
  healthy: true,
  authConfigError: false,
  rootRouteMissing: false,
  status: 200,
};
const probeByOrigin =
  (healthyOrigins: ReadonlySet<string>) =>
  async (origin: string): Promise<SandboxProbeResult> =>
    healthyOrigins.has(origin) ? healthy : failing;

function makeReadyRuntime(): PreviewRuntime {
  const runtime = makeRuntime();
  runtime.status = "ready";
  runtime.packageManager = "pnpm";
  runtime.upstream = {
    kind: "sandbox",
    sandboxId: "sbx-1",
    origin: SBX1_ORIGIN,
    headers: { "e2b-traffic-access-token": "tok-sbx-1" },
    expiresAt: null,
  };
  return runtime;
}

function seedSustained(runtime: PreviewRuntime) {
  runtime.healthExternalFailureCount =
    PREVIEW_RECREATION_FAILURE_THRESHOLD - 1;
  runtime.healthExternalFailureSince =
    Date.now() - PREVIEW_RECREATION_FAILURE_WINDOW_MS - 1_000;
}

// ─── 1a. Gate-level race: the post-await in-flight re-check ──────

describe("verifySandboxPreviewHealth — recreation gate race (round 16 follow-up)", () => {
  it("two overlapping rounds launch exactly ONE recreation and never log the contradictory cooldown line", async () => {
    // Ground truth is DEFERRED: both rounds must be parked inside
    // maybeRecreate's awaited ground-truth exec at the same time —
    // the exact interleave the 2026-11-18 proof hit, where round A
    // announced "attempt 1 of 2" and round B, microseconds later,
    // logged "the last sandbox recreation was 8154ms ago, inside
    // the cooldown — not recreating yet".
    const groundTruthResolvers: Array<() => void> = [];
    const destroySandbox = vi.fn(async (_ws: WorkspaceDescriptor) => {});
    const ensureSandboxForPreview = vi.fn(async () => ({ sandboxId: "sbx-2" }));
    const exposePort = vi.fn(async (sandboxId: string) => ({
      url: `https://3000-${sandboxId}.e2b.app`,
      previewToken: `tok-${sandboxId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }));
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(
        async (_sandboxId: string, input: { command: string }) => {
          if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
            return {
              exitCode: 0,
              stdout: "LITT_PREVIEW_LIVENESS=alive pid=4242\n",
              stderr: "",
              durationMs: 1,
            };
          }
          if (input.command.includes("LITT_PREVIEW_GROUND_TRUTH")) {
            await new Promise<void>((resolve) => {
              groundTruthResolvers.push(resolve);
            });
            return {
              exitCode: 0,
              stdout: "LITT_PREVIEW_GROUND_TRUTH=200\n",
              stderr: "",
              durationMs: 1,
            };
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        },
      ),
      exposePort,
      extendTimeout: vi.fn(async () => true),
    };
    const executor = { ensureSandboxForPreview, destroySandbox, notePreviewPort: vi.fn() };
    const support = {
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    } as SandboxPreviewSupport;

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    const deps = {
      probe: probeByOrigin(new Set([SBX2_ORIGIN])),
      resolveWorkspace: () => WS,
    };

    const roundA = verifySandboxPreviewHealth(support, runtime, deps);
    const roundB = verifySandboxPreviewHealth(support, runtime, deps);

    // Both rounds parked on their ground-truth execs.
    await vi.waitFor(() => expect(groundTruthResolvers.length).toBe(2));
    for (const resolve of groundTruthResolvers) resolve();

    await expect(roundA).resolves.toBe(true);
    await expect(roundB).resolves.toBe(true);

    // Exactly one recreation was launched and booked.
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(runtime.healthRecreationCount).toBe(1);
    const announcements = runtime.logs.filter((l) =>
      l.includes("recreating the sandbox for a fresh address"),
    );
    expect(announcements.length).toBe(1);
    // The production anomaly: the losing round must NOT go on to
    // log the cooldown line against the winner's fresh timestamp.
    expect(
      runtime.logs.some((l) => l.includes("inside the") && l.includes("cooldown")),
    ).toBe(false);

    await previewRecreationPromise(runtime);
  });
});

// ─── 1b. Driver-level: PreviewManager verify is single-flight ───

describe("PreviewManager.verifyPreviewHealth — single-flight (round 16 follow-up)", () => {
  const OWNER = "user_owner_singleflight";
  let volumeParent: string;
  let provider: FakeSandboxProvider;
  let executor: SandboxWorkspaceExecutor;
  let workspaceId: string;

  beforeEach(async () => {
    volumeParent = mkdtempSync(join(tmpdir(), "litt-preview-sf-"));
    provider = new FakeSandboxProvider({
      cloneFiles: {
        "package.json": JSON.stringify({ name: "app", scripts: { dev: "node server.js" } }),
        "server.js": "console.log('app');\n",
      },
    });
    executor = new SandboxWorkspaceExecutor({
      provider,
      gate: new SandboxExecGate({
        providerEnabled: true,
        routingEnabled: true,
        isOwner: (userId) => userId === OWNER,
        isVerified: () => true,
        templateId: "fake-template",
        provider,
      }),
      templateId: "fake-template",
      log: () => {},
    });
    registerSandboxPreviewSupport({ executor, provider });
    const ws = await executor.prepareRepoWorkspace({
      userId: OWNER,
      // A project id unique to this file: the workspace id derives
      // from it and the descriptor registry is durable, so reusing
      // another suite's project id would adopt ITS descriptor
      // (with its owner) instead of registering this one.
      projectId: "proj-preview-singleflight",
      installationId: 7,
      owner: "acme",
      repo: "site",
      branch: "main",
      workspaceRoot: volumeParent,
      githubToken: ["test", "scoped", "token", "0004"].join("-"),
    });
    workspaceId = ws.workspaceId;
  });

  afterEach(async () => {
    await stopPreviewAndWait(workspaceId).catch(() => {});
    registerSandboxPreviewSupport(null);
    vi.unstubAllGlobals();
    rmSync(volumeParent, { recursive: true, force: true });
  });

  it("concurrent callers share one round — one upstream probe, one shared promise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>app</html>", { status: 200 })),
    );
    await startPreview({
      workspaceId,
      userId: OWNER,
      framework: "custom",
      command: "node server.js --port $PORT",
      packageManager: "npx",
    });
    await vi.waitFor(() => expect(getPreviewStatus(workspaceId)?.status).toBe("ready"));

    // Deferred, counting probe: the round cannot finish until the
    // test releases the fetch.
    let fetchCalls = 0;
    let releaseFetch: (() => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        await new Promise<void>((resolve) => {
          releaseFetch = resolve;
        });
        return new Response("<html>app</html>", { status: 200 });
      }),
    );

    const p1 = verifyPreviewHealth(workspaceId);
    const p2 = verifyPreviewHealth(workspaceId);
    // The second caller joined the SAME round instead of starting
    // a parallel one.
    expect(p2).toBe(p1);

    await vi.waitFor(() => expect(fetchCalls).toBe(1));
    releaseFetch!();
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(true);
    // Still one probe: the shared round ran exactly once.
    expect(fetchCalls).toBe(1);

    // After the round settles, the next call starts a fresh round.
    const p3 = verifyPreviewHealth(workspaceId);
    expect(p3).not.toBe(p1);
    await vi.waitFor(() => expect(fetchCalls).toBe(2));
    releaseFetch!();
    await expect(p3).resolves.toBe(true);
  });
});

// ─── 2. Recreation settle watchdog ───────────────────────────────

describe("verifySandboxPreviewHealth — recreation settle watchdog (round 16 follow-up)", () => {
  it("a recreation whose destroy never settles is logged loudly and the in-flight flag is released for a retry", async () => {
    // destroySandbox pends FOREVER (the production shape: the
    // per-workspace mutex or the provider kill never returns).
    const destroySandbox = vi.fn(
      async (_ws: WorkspaceDescriptor) => new Promise<void>(() => {}),
    );
    const ensureSandboxForPreview = vi.fn(async () => ({ sandboxId: "sbx-2" }));
    const exposePort = vi.fn(async (sandboxId: string) => ({
      url: `https://3000-${sandboxId}.e2b.app`,
      previewToken: `tok-${sandboxId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }));
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(
        async (_sandboxId: string, input: { command: string }) => {
          if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
            return {
              exitCode: 0,
              stdout: "LITT_PREVIEW_LIVENESS=alive pid=4242\n",
              stderr: "",
              durationMs: 1,
            };
          }
          if (input.command.includes("LITT_PREVIEW_GROUND_TRUTH")) {
            return {
              exitCode: 0,
              stdout: "LITT_PREVIEW_GROUND_TRUTH=200\n",
              stderr: "",
              durationMs: 1,
            };
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        },
      ),
      exposePort,
      extendTimeout: vi.fn(async () => true),
    };
    const executor = { ensureSandboxForPreview, destroySandbox, notePreviewPort: vi.fn() };
    const support = {
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    } as SandboxPreviewSupport;

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    const deps = {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace: () => WS,
      // A 60 ms watchdog bound stands in for the production
      // 10 minutes so the test does not wait it out.
      recreationSettleWatchdogMs: 60,
    };

    await verifySandboxPreviewHealth(support, runtime, deps);
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(runtime.healthRecreationCount).toBe(1);
    expect(runtime.healthRecreationInFlight).toBe(true);
    // The recreation now has a voice from its first step.
    expect(
      runtime.logs.some((l) => l.includes("Sandbox recreation started")),
    ).toBe(true);
    expect(
      runtime.logs.some((l) => l.includes("Destroying sandbox sbx-1")),
    ).toBe(true);
    // …and no destroy-finish line: the destroy never settled.
    expect(
      runtime.logs.some((l) => l.includes("Destroyed sandbox")),
    ).toBe(false);

    // The watchdog fires: loud log + the flag is released.
    await vi.waitFor(
      () => {
        expect(runtime.healthRecreationInFlight).toBe(false);
        expect(
          runtime.logs.some((l) => l.includes("Recreation watchdog")),
        ).toBe(true);
      },
      { timeout: 2_000 },
    );

    // A later round can now RETRY instead of silently no-oping on
    // the stuck flag. (The wedged attempt left the runtime
    // "starting"; a subsequent start/restart returns it to
    // "ready" — restored here to model that round.)
    runtime.status = "ready";
    seedSustained(runtime);
    runtime.healthLastRecreationAt =
      Date.now() - PREVIEW_RECREATION_COOLDOWN_MS - 1_000;
    await verifySandboxPreviewHealth(support, runtime, deps);
    expect(destroySandbox).toHaveBeenCalledTimes(2);
    expect(runtime.healthRecreationCount).toBe(2);
    expect(runtime.healthRecreationInFlight).toBe(true);
  });
});

// ─── 3. Probe failure classes ────────────────────────────────────

describe("probe failure classes (round 16 follow-up)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifyProbeFailure separates timeout / dns / connect / tls / unknown", () => {
    expect(
      classifyProbeFailure(new DOMException("timed out", "TimeoutError")),
    ).toBe("timeout");
    const dns = new TypeError("fetch failed");
    (dns as { cause?: unknown }).cause = { code: "ENOTFOUND" };
    expect(classifyProbeFailure(dns)).toBe("dns");
    const reset = new TypeError("fetch failed");
    (reset as { cause?: unknown }).cause = { code: "ECONNRESET" };
    expect(classifyProbeFailure(reset)).toBe("connect");
    const tls = new TypeError("fetch failed");
    (tls as { cause?: unknown }).cause = {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    };
    expect(classifyProbeFailure(tls)).toBe("tls");
    expect(classifyProbeFailure(new Error("boom"))).toBe("unknown");
  });

  it("probeUpstream records the class instead of collapsing the throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    const timedOut = await probeUpstream("https://3000-sbx-1.e2b.app", {}, 50);
    expect(timedOut.healthy).toBe(false);
    expect(timedOut.status).toBeNull();
    expect(timedOut.failureClass).toBe("timeout");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("plain failure", { status: 503 })),
    );
    const http = await probeUpstream("https://3000-sbx-1.e2b.app", {}, 50);
    expect(http.status).toBe(503);
    expect(http.failureClass).toBe("http-status");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 })),
    );
    const ok = await probeUpstream("https://3000-sbx-1.e2b.app", {}, 50);
    expect(ok.healthy).toBe(true);
    expect(ok.failureClass).toBeUndefined();
  });

  it("the verify's failure line names the class — 'no response (connect)'", async () => {
    const destroySandbox = vi.fn(async (_ws: WorkspaceDescriptor) => {});
    const ensureSandboxForPreview = vi.fn(async () => ({ sandboxId: "sbx-2" }));
    const exposePort = vi.fn(async (sandboxId: string) => ({
      url: `https://3000-${sandboxId}.e2b.app`,
      previewToken: `tok-${sandboxId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    }));
    const provider = {
      name: "stub",
      fileTransfer: {
        listDir: vi.fn(async () => []),
        makeDir: vi.fn(async () => {}),
        writeFile: vi.fn(async () => {}),
        readFile: vi.fn(async () => new Uint8Array()),
        listTree: vi.fn(async () => []),
        removePath: vi.fn(async () => {}),
        renamePath: vi.fn(async () => {}),
      },
      execute: vi.fn(
        async (_sandboxId: string, input: { command: string }) => {
          if (input.command.includes("LITT_PREVIEW_LIVENESS")) {
            return {
              exitCode: 0,
              stdout: "LITT_PREVIEW_LIVENESS=alive pid=4242\n",
              stderr: "",
              durationMs: 1,
            };
          }
          return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
        },
      ),
      exposePort,
      extendTimeout: vi.fn(async () => true),
    };
    const executor = { ensureSandboxForPreview, destroySandbox, notePreviewPort: vi.fn() };
    const support = {
      executor: executor as unknown as SandboxWorkspaceExecutor,
      provider: provider as unknown as SandboxProvider,
    } as SandboxPreviewSupport;

    const runtime = makeReadyRuntime();
    const connectFailing: SandboxProbeResult = {
      healthy: false,
      authConfigError: false,
      rootRouteMissing: false,
      status: null,
      failureClass: "connect",
    };
    await verifySandboxPreviewHealth(support, runtime, {
      probe: async () => connectFailing,
      resolveWorkspace: () => WS,
    });
    expect(
      runtime.logs.some((l) => l.includes("no response (connect)")),
    ).toBe(true);
  });
});

// ─── 4. exposePort traffic-token source ──────────────────────────

describe("E2bSandboxProvider.exposePort — traffic token source (round 16 follow-up)", () => {
  function fakeHandle(token: string | undefined): E2bSandboxHandle {
    return {
      sandboxId: "sbx-token-source",
      trafficAccessToken: token,
      runCommand: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
      getHost: (port: number) => `${port}-sbx-token-source.e2b.app`,
      setTimeout: vi.fn(async () => {}),
      pause: vi.fn(async () => true),
      kill: vi.fn(async () => true),
      isRunning: vi.fn(async () => true),
      readFileBytes: vi.fn(async () => new Uint8Array()),
      writeFileBytes: vi.fn(async () => {}),
      listDir: vi.fn(async () => []),
      removePath: vi.fn(async () => {}),
      makeDir: vi.fn(async () => {}),
      renamePath: vi.fn(async () => {}),
    };
  }

  function fakeClient(token: string | undefined): E2bClient {
    return {
      create: vi.fn(async () => fakeHandle(token)),
      connect: vi.fn(async () => fakeHandle(token)),
      probe: vi.fn(async () => {}),
    };
  }

  it("logs 'sandbox-handle' when the SDK handle carries the real token — and never the token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const provider = new E2bSandboxProvider({
        apiKey: "test-api-key",
        client: fakeClient("tok-real-secret-value"),
      });
      const instance = await provider.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        env: {},
      });
      const endpoint = await provider.exposePort(instance.sandboxId, 3000);
      expect(endpoint.previewToken).toBe("tok-real-secret-value");
      const lines = info.mock.calls.map((c) => String(c[0]));
      const sourceLine = lines.find((l) => l.includes("trafficTokenSource="));
      expect(sourceLine).toContain("trafficTokenSource=sandbox-handle");
      // The token value appears in NO log line, in whole or part.
      expect(lines.some((l) => l.includes("tok-real-secret-value"))).toBe(false);
    } finally {
      info.mockRestore();
    }
  });

  it("logs 'random-fallback' when the handle carries no token", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const provider = new E2bSandboxProvider({
        apiKey: "test-api-key",
        client: fakeClient(undefined),
      });
      const instance = await provider.create({
        userId: "user-1",
        projectId: "proj-1",
        workspaceId: "ws-1",
        env: {},
      });
      const endpoint = await provider.exposePort(instance.sandboxId, 3000);
      // The fallback is an opaque 16-byte hex correlation token.
      expect(endpoint.previewToken).toMatch(/^[0-9a-f]{32}$/);
      const lines = info.mock.calls.map((c) => String(c[0]));
      const sourceLine = lines.find((l) => l.includes("trafficTokenSource="));
      expect(sourceLine).toContain("trafficTokenSource=random-fallback");
      expect(lines.some((l) => l.includes(endpoint.previewToken))).toBe(false);
    } finally {
      info.mockRestore();
    }
  });
});

// ─── 5. Preview proxy auth-rejection logging ─────────────────────

describe("preview proxy — auth rejection logging (round 16 follow-up)", () => {
  const LEGACY_TOKEN = "the-expected-legacy-token";
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.PREVIEW_ACCESS_TOKEN;
    process.env.PREVIEW_ACCESS_TOKEN = LEGACY_TOKEN;
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.PREVIEW_ACCESS_TOKEN;
    else process.env.PREVIEW_ACCESS_TOKEN = savedToken;
  });

  it("a rejected token is logged with status + errorCode — and never the token", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = express();
      registerPreviewProxyRoute(app);
      const res = await request(app).get(
        "/preview/ws-proxy-auth-test?token=wrong-token-value",
      );
      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("invalid_preview_token");
      const lines = warn.mock.calls.map((c) => String(c[0]));
      const rejection = lines.find((l) => l.includes("auth rejected"));
      expect(rejection).toBeDefined();
      expect(rejection).toContain("workspace=ws-proxy-auth-test");
      expect(rejection).toContain("status=401");
      expect(rejection).toContain("errorCode=invalid_preview_token");
      expect(lines.some((l) => l.includes("wrong-token-value"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
