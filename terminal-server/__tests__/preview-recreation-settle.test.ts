/**
 * Round 16 settle follow-up — per-call settle bounds inside a
 * launched recreation (2026-11-18).
 *
 * The #1045 lane gave a launched recreation a settle watchdog:
 * if the whole recreation has not settled in 600 s the watchdog
 * logs loudly and clears the in-flight flag. The live proof that
 * followed showed the watchdog's limit: at 12:30 ET the sweeper
 * declared a preview address dead and launched recreation
 * attempt 1 of 2; the destroy of the old sandbox started and
 * NEVER settled — no destroyed/created line ever followed — and
 * when the watchdog fired at +600 s it could only clear the flag
 * and leave the attempt running forever behind a provider call
 * that never returns.
 *
 * This lane bounds the recreation's own provider calls instead:
 * destroySandbox gets PREVIEW_RECREATION_DESTROY_TIMEOUT_MS and
 * the fresh start gets PREVIEW_RECREATION_CREATE_TIMEOUT_MS. A
 * destroy that times out is abandoned (the provider expires the
 * old sandbox on its own lifetime cap) and the recreation
 * proceeds to provision the fresh sandbox; a start that times
 * out fails the attempt through the recreation's existing
 * failure path — counted, logged, in-flight flag freed by the
 * attempt itself, not by the watchdog. The watchdog, the
 * single-flight verify, and C2's thresholds (4 rounds / 90 s /
 * cap 2 / 120 s cooldown) are untouched.
 */

import { describe, it, expect, vi } from "vitest";
import {
  previewRecreationPromise,
  verifySandboxPreviewHealth,
  PREVIEW_RECREATION_FAILURE_THRESHOLD,
  PREVIEW_RECREATION_FAILURE_WINDOW_MS,
  type SandboxPreviewSupport,
  type SandboxProbeResult,
} from "../preview/sandbox-runtime";
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

/**
 * The recreation-fix lane's proven stub shape: the provider
 * answers liveness "alive" and ground truth "200" (the
 * dead-ingress signature that warrants recreation), and every
 * other exec succeeds silently so a start can run its course.
 * Only the executor's two recreation calls vary per test.
 */
function makeSupport(args: {
  destroySandbox: (
    ws: WorkspaceDescriptor,
  ) => Promise<void>;
  ensureSandboxForPreview: () => Promise<{ sandboxId: string } | null>;
}): {
  support: SandboxPreviewSupport;
  destroySandbox: ReturnType<typeof vi.fn>;
  ensureSandboxForPreview: ReturnType<typeof vi.fn>;
} {
  const destroySandbox = vi.fn(args.destroySandbox);
  const ensureSandboxForPreview = vi.fn(args.ensureSandboxForPreview);
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
  const executor = {
    ensureSandboxForPreview,
    destroySandbox,
    notePreviewPort: vi.fn(),
  };
  const support = {
    executor: executor as unknown as SandboxWorkspaceExecutor,
    provider: provider as unknown as SandboxProvider,
  } as SandboxPreviewSupport;
  return { support, destroySandbox, ensureSandboxForPreview };
}

describe("verifySandboxPreviewHealth — recreation settle bounds (round 16 settle follow-up)", () => {
  it("a destroy that never settles times out, is abandoned, and the recreation still provisions the fresh sandbox", async () => {
    // The 2026-11-18 12:30 production shape: destroySandbox
    // pends FOREVER (the per-workspace mutex or the provider
    // kill never returns).
    const { support, destroySandbox, ensureSandboxForPreview } =
      makeSupport({
        destroySandbox: async () => new Promise<void>(() => {}),
        ensureSandboxForPreview: async () => ({ sandboxId: "sbx-2" }),
      });

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set([SBX2_ORIGIN])),
      resolveWorkspace: () => WS,
      // A 60 ms destroy bound stands in for the production
      // 120 s; the create bound stays generous and the watchdog
      // stays far away, so the settle bound — not the watchdog —
      // is what moves this recreation forward.
      recreationDestroyTimeoutMs: 60,
      recreationCreateTimeoutMs: 5_000,
      recreationSettleWatchdogMs: 60_000,
    });
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(runtime.healthRecreationCount).toBe(1);
    expect(runtime.healthRecreationInFlight).toBe(true);

    // The recreation completes end to end despite the destroy
    // never settling.
    await previewRecreationPromise(runtime);

    expect(ensureSandboxForPreview).toHaveBeenCalledTimes(1);
    // The timeout is logged explicitly, naming the sandbox and
    // the bound, and the abandonment is stated.
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Destroy of sandbox sbx-1 did not settle within 60ms") &&
          l.includes("abandoning the old sandbox"),
      ),
    ).toBe(true);
    // No destroy-finish line: the destroy truly never settled.
    expect(
      runtime.logs.some((l) => l.includes("Destroyed sandbox sbx-1")),
    ).toBe(false);
    // …and the fresh sandbox still arrived, with the completion
    // line naming it.
    expect(runtime.upstream?.kind).toBe("sandbox");
    expect(
      runtime.upstream?.kind === "sandbox" && runtime.upstream.sandboxId,
    ).toBe("sbx-2");
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation complete") &&
          l.includes("new sandbox sbx-2"),
      ),
    ).toBe(true);
    // The attempt settled on its own: flag freed, no watchdog.
    expect(runtime.healthRecreationInFlight).toBe(false);
    expect(
      runtime.logs.some((l) => l.includes("Recreation watchdog")),
    ).toBe(false);
  });

  it("a hung create fails the attempt cleanly — counted, logged, flag freed without the watchdog", async () => {
    const { support, destroySandbox } = makeSupport({
      destroySandbox: async () => {},
      // ensureSandboxForPreview pends FOREVER: the fresh start
      // hangs at its first provider call.
      ensureSandboxForPreview: async () =>
        new Promise<{ sandboxId: string }>(() => {}),
    });

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    const startedAt = Date.now();
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set<string>()),
      resolveWorkspace: () => WS,
      recreationDestroyTimeoutMs: 5_000,
      // A 60 ms create bound stands in for the production
      // 480 s; the watchdog is set a thousand times higher, so
      // a freed flag at the end can only be the attempt's own
      // doing.
      recreationCreateTimeoutMs: 60,
      recreationSettleWatchdogMs: 60_000,
    });
    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(runtime.healthRecreationInFlight).toBe(true);

    await previewRecreationPromise(runtime);
    const elapsedMs = Date.now() - startedAt;

    // The destroy settled normally on the way in.
    expect(
      runtime.logs.some((l) => l.includes("Destroyed sandbox sbx-1")),
    ).toBe(true);
    // The attempt failed through the recreation's own failure
    // path, naming the create bound.
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation failed") &&
          l.includes("did not settle within 60ms"),
      ),
    ).toBe(true);
    // Counted (the launch bookkeeping stands), flag freed by the
    // attempt itself, watchdog never involved, and the runtime
    // restored to ready instead of wedged in "starting".
    expect(runtime.healthRecreationCount).toBe(1);
    expect(runtime.healthRecreationInFlight).toBe(false);
    expect(
      runtime.logs.some((l) => l.includes("Recreation watchdog")),
    ).toBe(false);
    expect(elapsedMs).toBeLessThan(10_000);
    expect(runtime.status).toBe("ready");
    // No fresh upstream was installed by the failed attempt.
    expect(
      runtime.upstream?.kind === "sandbox" && runtime.upstream.sandboxId,
    ).toBe("sbx-1");
  });

  it("the happy path is unchanged — destroy settles, fresh sandbox provisions, no timeout lines", async () => {
    const { support, destroySandbox, ensureSandboxForPreview } =
      makeSupport({
        destroySandbox: async () => {},
        ensureSandboxForPreview: async () => ({ sandboxId: "sbx-2" }),
      });

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    // No settle bounds injected: the production defaults apply,
    // and every call settles long before any of them.
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set([SBX2_ORIGIN])),
      resolveWorkspace: () => WS,
    });
    await previewRecreationPromise(runtime);

    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(ensureSandboxForPreview).toHaveBeenCalledTimes(1);
    expect(
      runtime.logs.some((l) => l.includes("Destroyed sandbox sbx-1")),
    ).toBe(true);
    expect(
      runtime.logs.some((l) => l.includes("did not settle")),
    ).toBe(false);
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation complete") &&
          l.includes("new sandbox sbx-2"),
      ),
    ).toBe(true);
    expect(
      runtime.upstream?.kind === "sandbox" && runtime.upstream.sandboxId,
    ).toBe("sbx-2");
    expect(runtime.healthRecreationCount).toBe(1);
    expect(runtime.healthRecreationInFlight).toBe(false);
  });

  it("a destroy REJECTION still fails the attempt — only a timeout proceeds to create", async () => {
    const { support, ensureSandboxForPreview } = makeSupport({
      destroySandbox: async () => {
        throw new Error("provider kill refused");
      },
      ensureSandboxForPreview: async () => ({ sandboxId: "sbx-2" }),
    });

    const runtime = makeReadyRuntime();
    seedSustained(runtime);
    await verifySandboxPreviewHealth(support, runtime, {
      probe: probeByOrigin(new Set([SBX2_ORIGIN])),
      resolveWorkspace: () => WS,
      recreationDestroyTimeoutMs: 5_000,
      recreationCreateTimeoutMs: 5_000,
      recreationSettleWatchdogMs: 60_000,
    });
    await previewRecreationPromise(runtime);

    // A call that FAILED is not a call that never answered: the
    // pre-existing failure path governs, and no create is
    // attempted on the back of a refused destroy.
    expect(ensureSandboxForPreview).not.toHaveBeenCalled();
    expect(
      runtime.logs.some(
        (l) =>
          l.includes("Sandbox recreation failed") &&
          l.includes("provider kill refused"),
      ),
    ).toBe(true);
    expect(runtime.healthRecreationInFlight).toBe(false);
    expect(runtime.status).toBe("ready");
  });
});
