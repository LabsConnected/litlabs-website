/**
 * Sandbox branch of preview start / stop / health / logs —
 * Phase 2 lifecycle (design note §3.3).
 *
 * When the sandbox executor is available for the workspace owner,
 * the dev server runs INSIDE the workspace's sandbox instead of as
 * a host child process:
 *
 *   - Project facts are still read from the VOLUME (framework
 *     detection, .env loading, Clerk validation) — the volume is
 *     current by the sync rules, and PreviewManager resolves them
 *     before dispatching here.
 *   - Host concerns are skipped: no resolvePackageManager, no
 *     buildChildPath, no allocateFreePort, no bind-host policy. One
 *     sandbox serves one project, so the dev server uses a fixed
 *     port bound to 0.0.0.0 inside the sandbox.
 *   - Dependencies install inside the sandbox when node_modules is
 *     absent there, with the §4.4 env (no GitHub token, allowlisted
 *     base env, NODE_ENV=development).
 *   - The dev server starts DETACHED through execute (setsid/nohup,
 *     output to a log file, pid to a pid file, both under /tmp —
 *     outside the synced tree), so it survives a terminal restart.
 *     Logs are tailed into the runtime's log ring on probe/status
 *     calls.
 *   - The proxy's upstream comes from exposePort: an origin + the
 *     provider traffic-token header, held in memory only on the
 *     runtime — never persisted, never in any response (§3.2/§3.5).
 *   - Health is probed THROUGH the upstream, not 127.0.0.1.
 *
 * Runtime files (run script, log, pid) live under /tmp/litt-preview
 * inside the sandbox: outside /workspace, so sync never carries them
 * to the volume — the run script must never hold secrets, and it
 * doesn't: the project env travels as per-command env on the launch
 * execute call and is inherited by the detached child.
 */

import type { SandboxProvider } from "../sandbox/provider";
import {
  ensureSandboxWorkspaceWritable,
  SANDBOX_HOME_DIR,
  SANDBOX_WORKSPACE_ROOT,
  type SandboxWorkspaceExecutor,
} from "../sandbox/workspace-executor";
import { buildShellCommand, requireFileTransfer } from "../sandbox/sync";
import {
  readVolumeInstallStamp,
  SANDBOX_INSTALL_TIMEOUT_MS,
  sandboxInstallIsFresh,
  writeSandboxInstallStamp,
} from "../sandbox/install-stamp";
import {
  buildSandboxInstallEnv,
  describeSandboxInstallExit,
  logSandboxInstallMemoryEvidence,
  runSandboxInstallOnce,
} from "../sandbox/install-flight";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";
import {
  PreviewError,
  extractClerkEnv,
  pushPreviewLog,
  type PreviewRuntime,
} from "./PreviewManager";

/** Fixed dev-server port inside the sandbox (one project per sandbox). */
export const SANDBOX_PREVIEW_PORT = 3000;

/** Header that carries the provider traffic token to a private sandbox URL. */
export const SANDBOX_TRAFFIC_TOKEN_HEADER = "e2b-traffic-access-token";

const PREVIEW_TMP_DIR = "/tmp/litt-preview";
const RUN_SCRIPT_PATH = `${PREVIEW_TMP_DIR}/run.sh`;
const LOG_PATH = `${PREVIEW_TMP_DIR}/preview.log`;
const PID_PATH = `${PREVIEW_TMP_DIR}/preview.pid`;

const HEALTH_PROBE_INTERVAL_MS = 1000;
/**
 * Readiness window for a cold sandbox dev server. Was 60s; the
 * production preview failures of 2026-11-14 showed the system's own
 * budgets are the binding constraint — the web grants a preview
 * start 120s (TERMINAL_TIMEOUTS.startPreview) and the sandbox runs
 * at 1 vCPU / 1024 MB (DEFAULT_SANDBOX_LIMITS), where a Next.js dev
 * server's cold boot plus first-route compilation has to fit. The
 * probe runs in the background after the start response, so a wider
 * window costs the user nothing but truth: a slow-but-alive server
 * now reaches "ready" instead of a false "did not become healthy".
 */
export const HEALTH_PROBE_TIMEOUT_MS = 120_000;
/** Session extension granted while a sandbox preview is in use. */
const PREVIEW_SESSION_EXTENSION_MS = 120 * 60_000;

export interface SandboxPreviewSupport {
  executor: SandboxWorkspaceExecutor;
  provider: SandboxProvider;
}

export interface SandboxPreviewStartArgs {
  support: SandboxPreviewSupport;
  runtime: PreviewRuntime;
  ws: WorkspaceDescriptor;
  /** Framework/command/packageManager as detected from the volume. */
  framework: string;
  command: string;
  packageManager: string;
  /** Project-secret subset that travels as per-command env (§3.4). */
  travelingEnv: Record<string, string>;
  /** Health probe override (tests). Defaults to a real upstream fetch. */
  probe?: (origin: string, headers: Record<string, string>) => Promise<SandboxProbeResult>;
}

export interface SandboxProbeResult {
  healthy: boolean;
  authConfigError: boolean;
  rootRouteMissing: boolean;
  status: number | null;
}

/** Byte offsets into the sandbox preview log, per workspace. */
const logOffsets = new Map<string, number>();

/**
 * Start the dev server inside the sandbox and wire the runtime's
 * upstream. Throws PreviewError (after recording a failed runtime)
 * on the same conditions the host path reports. Health probing runs
 * in the background, exactly like the host path.
 */
export async function startSandboxPreview(args: SandboxPreviewStartArgs): Promise<PreviewRuntime> {
  const { support, runtime, ws } = args;
  const { executor, provider } = support;

  const ensured = await executor.ensureSandboxForPreview(ws);
  if (!ensured) {
    throw new PreviewError(
      "preview_dev_server_failed",
      "Sandbox preview became unavailable before start",
      { cwd: ws.root },
    );
  }
  const sandboxId = ensured.sandboxId;
  const transfer = requireFileTransfer(provider);

  // Install inside the sandbox when its dependencies are not FRESH
  // there: node_modules absent, or present but installed against a
  // different lockfile than the tree now carries (install-stamp.ts).
  // The volume's own node_modules, if any, is sandbox-only and never
  // synced, so it proves nothing either way. A fresh stamp skips the
  // install outright; a stale one re-runs it — pnpm's incremental
  // machinery (existing node_modules + store) keeps that cheap. When
  // no stamp can be computed (no package.json on the volume), fall
  // back to the pre-stamp rule: node_modules presence decides.
  const rootEntries = await transfer.listDir(sandboxId, SANDBOX_WORKSPACE_ROOT);
  const hasNodeModules = rootEntries.some((e) => e.path === "node_modules" && e.type === "dir");
  const installStamp = readVolumeInstallStamp(ws.root);
  const depsFresh =
    hasNodeModules &&
    (installStamp === null || (await sandboxInstallIsFresh(provider, sandboxId, installStamp)));
  if (depsFresh) {
    pushPreviewLog(runtime, `[preview] Dependencies in sandbox are fresh — skipping install`);
  }
  if (!depsFresh && args.packageManager !== "npx") {
    pushPreviewLog(runtime, `[preview] Installing dependencies in sandbox (${args.packageManager})`);
    // The install runs as the non-root command user but must write
    // into the tree (pnpm's `_tmp_<pid>_<hash>` store probe in the
    // project root, node_modules, the lockfile) — and /workspace is
    // root-owned 755 in the template. Open the tree up first, or the
    // install dies EACCES before it starts (live failure 2026-11-15;
    // see ensureSandboxWorkspaceWritable).
    await ensureSandboxWorkspaceWritable(provider, sandboxId);
    // Single-flight (round 10, install-flight.ts): prepare fires a
    // background install into this same sandbox on every provision,
    // and this start usually races it — the stamp check above ran
    // while that install was still in flight (no stamp yet), so this
    // path launched a SECOND pnpm install against the same store on
    // 1 vCPU / 1024 MB, and envd signal-killed one of them mid-flight
    // (exit -1, 2026-11-16 proof). Adopt the in-flight install
    // instead; the freshness stamp stays the ground truth below.
    const flight = await runSandboxInstallOnce(sandboxId, () =>
      provider.execute(sandboxId, {
        command: buildShellCommand([args.packageManager, "install", "--prefer-offline"]),
        cwd: SANDBOX_WORKSPACE_ROOT,
        // Shared install budget (install-stamp.ts): 300 s could never
        // fit a cold install of this repo, so every cold preview
        // failed and retried the whole install (2026-11-16 proof).
        timeoutMs: SANDBOX_INSTALL_TIMEOUT_MS,
        // Shared SHAPED install env (install-flight.ts, round 12) —
        // the same builder the executor's background install uses, so
        // the sites cannot drift: heap cap overriding the tree
        // .npmrc's 4 GB allowance for this exec only, pnpm
        // concurrency bounds for 1 vCPU / 1024 MB, and the HOME pin:
        // this call goes through provider.execute directly, so
        // without the pin the composed base env's Phase 1 default
        // (HOME=/workspace) applies — and the pnpm corepack shim then
        // tries to create /workspace/.cache/node/corepack, which the
        // non-root command user cannot do in the root-owned,
        // 755 workspace root (EACCES, live failure 2026-11-14).
        // /home/litt is the template's writable home (chmod 777,
        // outside the synced tree). The dev-server launch env below
        // is deliberately NOT shaped — shaping is install-only.
        env: buildSandboxInstallEnv(SANDBOX_HOME_DIR),
      }),
    );
    const install = flight.result;
    // Round 12: log the sandbox's peak memory for this install
    // through the sandbox-lifecycle logger (plus kernel OOM lines on
    // a signal kill) so the next failure is self-settling. Runs
    // BEFORE the failure handling below throws — a signal-killed
    // install is exactly the case the evidence exists for.
    // Best-effort: never changes the outcome (install-flight.ts).
    await logSandboxInstallMemoryEvidence({
      provider,
      sandboxId,
      install,
      log: (m) => console.info(m),
    });
    let installFailed = install.exitCode !== 0;
    if (installFailed && flight.adopted) {
      // The adopted install failed — but freshness is the ground
      // truth, not another caller's exit code: if the sandbox's deps
      // are fresh for the volume's current lockfile anyway (a stamp
      // landed from an earlier attempt), proceed; otherwise surface
      // the failure exactly as an own-install failure below.
      if (await sandboxInstallIsFresh(provider, sandboxId, installStamp)) {
        installFailed = false;
        pushPreviewLog(
          runtime,
          `[preview] Adopted install exited ${install.exitCode}, but dependencies are fresh — continuing`,
        );
      }
    }
    if (installFailed) {
      const killNote = describeSandboxInstallExit(install);
      if (killNote) pushPreviewLog(runtime, `[preview] ${killNote}`);
      runtime.status = "failed";
      runtime.errorCode = "preview_dependency_install_failed";
      runtime.error =
        `Dependency install failed in sandbox (exit ${install.exitCode}): ` +
        (install.stderr || install.stdout).slice(0, 2000);
      pushPreviewLog(runtime, `[preview] Install failed (exit ${install.exitCode})`);
      throw new PreviewError("preview_dependency_install_failed", runtime.error, {
        cwd: ws.root,
        packageManager: args.packageManager,
        exitCode: install.exitCode,
      });
    }
    // Record what this install resolved, so the next start can skip
    // straight past it while the lockfile is unchanged (best effort —
    // a failed write only costs a redundant re-check next time).
    await writeSandboxInstallStamp(provider, sandboxId, installStamp);
  }

  // The run script carries the command ONLY — no env, no secrets.
  // $PORT was already replaced by PreviewManager's dispatch with the
  // fixed sandbox port.
  const script =
    "#!/bin/bash\n" +
    `cd ${SANDBOX_WORKSPACE_ROOT}\n` +
    `exec ${args.command}\n`;
  await transfer.makeDir(sandboxId, PREVIEW_TMP_DIR);
  await transfer.writeFile(sandboxId, RUN_SCRIPT_PATH, new TextEncoder().encode(script));
  logOffsets.set(runtime.workspaceId, 0);

  const launchEnv: Record<string, string> = {
    ...args.travelingEnv,
    PORT: String(SANDBOX_PREVIEW_PORT),
    HOSTNAME: "0.0.0.0",
    NODE_ENV: "development",
    NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
    // Same HOME pin as the install above: the detached dev server
    // (and any package-manager shim it invokes) inherits this env,
    // and its caches must land in the writable home, not /workspace.
    // Set after travelingEnv so a project env can never re-point
    // HOME at the root-owned workspace root.
    HOME: SANDBOX_HOME_DIR,
  };
  const launch = await provider.execute(sandboxId, {
    command:
      `setsid nohup bash ${RUN_SCRIPT_PATH} >> ${LOG_PATH} 2>&1 < /dev/null & ` +
      `echo $! > ${PID_PATH}`,
    cwd: SANDBOX_WORKSPACE_ROOT,
    timeoutMs: 30_000,
    env: launchEnv,
  });
  if (launch.exitCode !== 0) {
    runtime.status = "failed";
    runtime.errorCode = "preview_spawn_error";
    runtime.error = `Failed to launch dev server in sandbox (exit ${launch.exitCode}): ${launch.stderr.slice(0, 500)}`;
    throw new PreviewError("preview_spawn_error", runtime.error, { cwd: ws.root });
  }

  // The upstream: origin + traffic-token header, memory only (§3.2).
  const endpoint = await provider.exposePort(sandboxId, SANDBOX_PREVIEW_PORT);
  runtime.upstream = {
    kind: "sandbox",
    sandboxId,
    origin: endpoint.url,
    headers: { [SANDBOX_TRAFFIC_TOKEN_HEADER]: endpoint.previewToken },
  };
  runtime.port = SANDBOX_PREVIEW_PORT;
  executor.notePreviewPort(ws, SANDBOX_PREVIEW_PORT);
  if (provider.extendTimeout) {
    await provider.extendTimeout(sandboxId, PREVIEW_SESSION_EXTENSION_MS).catch(() => {});
  }

  pushPreviewLog(
    runtime,
    `[preview] Starting ${args.framework} in sandbox on port ${SANDBOX_PREVIEW_PORT}: ${args.command}`,
  );

  // Background health probe through the upstream — don't block the
  // response, mirroring the host path.
  const probe = args.probe ?? probeUpstream;
  const upstreamHeaders = { ...runtime.upstream.headers };
  void (async () => {
    const deadline = Date.now() + HEALTH_PROBE_TIMEOUT_MS;
    let result: SandboxProbeResult = {
      healthy: false,
      authConfigError: false,
      rootRouteMissing: false,
      status: null,
    };
    while (Date.now() < deadline) {
      result = await probe(endpoint.url, upstreamHeaders).catch(() => result);
      if (result.healthy || result.authConfigError || result.rootRouteMissing) break;
      await new Promise((r) => setTimeout(r, HEALTH_PROBE_INTERVAL_MS));
    }
    runtime.lastHealthCheck = Date.now();
    await tailSandboxPreviewLogs(support, runtime).catch(() => {});
    if (runtime.status !== "starting") return;
    if (result.healthy) {
      runtime.status = "ready";
      pushPreviewLog(runtime, `[preview] Health check passed — ready (sandbox)`);
    } else if (result.rootRouteMissing) {
      runtime.status = "failed";
      runtime.errorCode = "preview_root_route_missing";
      runtime.error =
        "The preview server is running, but GET / returned 404 (Cannot GET /). " +
        "The detected dev server does not expose the project entry route at /. " +
        "Fix the project's dev command or serve index.html from the root, then restart preview.";
      pushPreviewLog(runtime, `[preview] Root route missing (HTTP ${result.status})`);
    } else if (result.authConfigError) {
      runtime.status = "failed";
      runtime.errorCode = "preview_auth_config_error";
      runtime.error =
        `Dev server booted but returned a ${result.status} with an authentication configuration error. ` +
        "The Clerk secret key or publishable key is invalid, stale, or mismatched.";
      pushPreviewLog(runtime, `[preview] Auth config error (HTTP ${result.status})`);
    } else {
      runtime.status = "failed";
      runtime.errorCode = "preview_port_never_ready";
      runtime.error = `Dev server did not become healthy within ${HEALTH_PROBE_TIMEOUT_MS / 1000}s`;
      pushPreviewLog(runtime, `[preview] Health check failed — timeout`);
    }
  })();

  return runtime;
}

/** Stop the sandbox dev server (pid from the pid file; group kill). */
export async function stopSandboxPreview(
  support: SandboxPreviewSupport,
  runtime: PreviewRuntime,
): Promise<void> {
  const upstream = runtime.upstream;
  if (!upstream || upstream.kind !== "sandbox") return;
  const { provider } = support;
  try {
    const transfer = requireFileTransfer(provider);
    const pidBytes = await transfer.readFile(upstream.sandboxId, PID_PATH);
    const pid = Number(new TextDecoder().decode(pidBytes).trim());
    if (Number.isFinite(pid) && pid > 0) {
      // The launcher used setsid, so the pid is a process-group
      // leader: kill the group so pnpm → next dev children die too,
      // mirroring the host path's group kill.
      await provider.execute(upstream.sandboxId, {
        command: buildShellCommand(["kill", "-TERM", `-${pid}`]),
        cwd: SANDBOX_WORKSPACE_ROOT,
        timeoutMs: 15_000,
      }).catch(() => {});
    }
  } catch {
    // No pid file (never started / already gone) — nothing to kill.
  }
  runtime.status = "stopped";
  pushPreviewLog(runtime, "[preview] Stopped (sandbox)");
}

/** Append not-yet-seen sandbox preview log lines to the runtime ring. */
export async function tailSandboxPreviewLogs(
  support: SandboxPreviewSupport,
  runtime: PreviewRuntime,
): Promise<void> {
  const upstream = runtime.upstream;
  if (!upstream || upstream.kind !== "sandbox") return;
  const transfer = requireFileTransfer(support.provider);
  let bytes: Uint8Array;
  try {
    bytes = await transfer.readFile(upstream.sandboxId, LOG_PATH);
  } catch {
    return; // no log yet
  }
  const offset = logOffsets.get(runtime.workspaceId) ?? 0;
  if (bytes.length <= offset) return;
  const fresh = new TextDecoder().decode(bytes.slice(offset));
  logOffsets.set(runtime.workspaceId, bytes.length);
  for (const line of fresh.split("\n")) {
    if (line) pushPreviewLog(runtime, line);
  }
}

/**
 * Live health verification for a sandbox runtime (the status route's
 * verifyPreviewHealth, sandbox branch): probe through the upstream
 * and flip the runtime truthfully, like the host path.
 */
export async function verifySandboxPreviewHealth(
  support: SandboxPreviewSupport,
  runtime: PreviewRuntime,
): Promise<boolean> {
  const upstream = runtime.upstream;
  if (!upstream || upstream.kind !== "sandbox" || runtime.status !== "ready") return false;
  await tailSandboxPreviewLogs(support, runtime).catch(() => {});
  const result = await probeUpstream(upstream.origin, upstream.headers).catch(
    (): SandboxProbeResult => ({
      healthy: false,
      authConfigError: false,
      rootRouteMissing: false,
      status: null,
    }),
  );
  if (result.healthy) {
    runtime.lastHealthCheck = Date.now();
    // Traffic is flowing: keep the sandbox alive (§3.3).
    if (support.provider.extendTimeout) {
      await support.provider
        .extendTimeout(upstream.sandboxId, PREVIEW_SESSION_EXTENSION_MS)
        .catch(() => {});
    }
    return true;
  }
  if (result.rootRouteMissing) {
    runtime.status = "failed";
    runtime.errorCode = "preview_root_route_missing";
    runtime.error = "The preview server is running, but GET / returned 404 (Cannot GET /). Fix the project's root entry route and restart preview.";
    pushPreviewLog(runtime, "[preview] Root route missing during live health check (HTTP 404)");
    return false;
  }
  if (result.authConfigError) {
    runtime.status = "failed";
    runtime.errorCode = "preview_auth_config_error";
    runtime.error =
      `Health check detected an authentication configuration error (HTTP ${result.status}). ` +
      "The Clerk secret key or publishable key is invalid, stale, or mismatched.";
    pushPreviewLog(runtime, `[preview] Auth config error detected during health check (HTTP ${result.status})`);
    return false;
  }
  runtime.status = "failed";
  runtime.errorCode = "preview_dev_server_failed";
  runtime.error = "Health check failed — the sandbox dev server may have crashed";
  return false;
}

/** One upstream health probe (mirrors PreviewManager.probeHealth's verdicts). */
export async function probeUpstream(
  origin: string,
  headers: Record<string, string>,
): Promise<SandboxProbeResult> {
  const resp = await fetch(`${origin}/`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  if (resp.ok) {
    return { healthy: true, authConfigError: false, rootRouteMissing: false, status: resp.status };
  }
  if (resp.status === 404) {
    return { healthy: false, authConfigError: false, rootRouteMissing: true, status: 404 };
  }
  if (resp.status >= 500) {
    const body = await resp.text().catch(() => "");
    if (detectAuthConfigErrorText(body)) {
      return { healthy: false, authConfigError: true, rootRouteMissing: false, status: resp.status };
    }
  }
  return { healthy: false, authConfigError: false, rootRouteMissing: false, status: resp.status };
}

/**
 * Auth-config error detection on a response body. Mirrors
 * PreviewManager's detectAuthConfigError patterns (kept in sync —
 * the sandbox probe must reach the same verdicts as the host probe).
 */
export function detectAuthConfigErrorText(body: string): boolean {
  const lower = body.toLowerCase();
  if (lower.includes("clerk") && lower.includes("secret")) return true;
  if (lower.includes("secret-key-invalid")) return true;
  if (lower.includes("handshake token verification failed")) return true;
  if (lower.includes("clerk_secret_key")) return true;
  if (lower.includes("publishable key") && lower.includes("clerk")) return true;
  if (lower.includes("auth") && lower.includes("config")) return true;
  if (lower.includes("missing") && lower.includes("secret") && lower.includes("key")) return true;
  return false;
}

/** The env subset that travels into the sandbox for a preview (§3.4). */
export function buildSandboxTravelingEnv(
  projectEnv: Record<string, string> | undefined,
): Record<string, string> {
  const env = { ...extractClerkEnv(projectEnv ?? {}) };
  // Same normalization the host path applies: the app expects the
  // NEXT_PUBLIC_ name; values are cleaned of copy-paste debris.
  if (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_PUBLISHABLE_KEY) {
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = env.CLERK_PUBLISHABLE_KEY;
  }
  for (const key of Object.keys(env)) {
    env[key] = env[key].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}
