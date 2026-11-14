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
  SANDBOX_WORKSPACE_ROOT,
  type SandboxWorkspaceExecutor,
} from "../sandbox/workspace-executor";
import { buildShellCommand, requireFileTransfer } from "../sandbox/sync";
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
const HEALTH_PROBE_TIMEOUT_MS = 60_000;
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

  // Install inside the sandbox when node_modules is absent THERE
  // (the volume's copy, if any, is sandbox-only and never synced).
  const rootEntries = await transfer.listDir(sandboxId, SANDBOX_WORKSPACE_ROOT);
  const hasNodeModules = rootEntries.some((e) => e.path === "node_modules" && e.type === "dir");
  if (!hasNodeModules && args.packageManager !== "npx") {
    pushPreviewLog(runtime, `[preview] Installing dependencies in sandbox (${args.packageManager})`);
    const install = await provider.execute(sandboxId, {
      command: buildShellCommand([args.packageManager, "install", "--prefer-offline"]),
      cwd: SANDBOX_WORKSPACE_ROOT,
      timeoutMs: 300_000,
      env: {
        NODE_ENV: "development",
        NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
      },
    });
    if (install.exitCode !== 0) {
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
