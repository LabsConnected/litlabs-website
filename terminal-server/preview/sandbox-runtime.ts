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
  buildSandboxPreviewLaunchEnv,
  describeSandboxInstallExit,
  logSandboxInstallMemoryEvidence,
  runSandboxInstallOnce,
} from "../sandbox/install-flight";
import {
  getWorkspace,
  type WorkspaceDescriptor,
} from "../workspace/WorkspaceManager";
import {
  PreviewError,
  extractClerkEnv,
  formatPreviewDiagnostic,
  pushPreviewLog,
  type PreviewRuntime,
  type PreviewUpstream,
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
 * at 2 vCPU / 2048 MB (DEFAULT_SANDBOX_LIMITS), where a Next.js dev
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
  // Recorded so a round-16 (C2) recreation re-runs this start with
  // the same package manager the original start resolved.
  runtime.packageManager = args.packageManager;

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
        // carries its OWN shaping (buildSandboxPreviewLaunchEnv,
        // round 13) — the install env is never reused for it.
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
    // Round 13: memory-shape the launch itself. Unshaped, the dev
    // server inherited the tree .npmrc's 4 GB heap allowance inside
    // the 2048 MB sandbox, so cold-compile heap growth met the
    // cgroup ceiling with no GC backpressure (install-flight.ts has
    // the sizing rationale). Only NODE_OPTIONS — the install env's
    // concurrency keys are install-only semantics. The workspace
    // .npmrc is NOT edited; this overrides it for this exec only,
    // exactly as the install shaping does.
    ...buildSandboxPreviewLaunchEnv(),
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
  // Round 14: the endpoint's expiry is stored WITH the upstream —
  // before this it was minted onto the endpoint object and read by
  // nobody, so the verify could not tell a lapsed address from a
  // live one (see verifySandboxPreviewHealth's repair path).
  const endpoint = await provider.exposePort(sandboxId, SANDBOX_PREVIEW_PORT);
  runtime.upstream = {
    kind: "sandbox",
    sandboxId,
    origin: endpoint.url,
    headers: { [SANDBOX_TRAFFIC_TOKEN_HEADER]: endpoint.previewToken },
    expiresAt: parseEndpointExpiry(endpoint.expiresAt),
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
      runtime.error = withPreviewLogDiagnostic(
        "The preview server is running, but GET / returned 404 (Cannot GET /). " +
          "The detected dev server does not expose the project entry route at /. " +
          "Fix the project's dev command or serve index.html from the root, then restart preview.",
        boundedPreviewLogTail(runtime.logs),
      );
      pushPreviewLog(runtime, `[preview] Root route missing (HTTP ${result.status})`);
    } else if (result.authConfigError) {
      runtime.status = "failed";
      runtime.errorCode = "preview_auth_config_error";
      runtime.error = withPreviewLogDiagnostic(
        `Dev server booted but returned a ${result.status} with an authentication configuration error. ` +
          "The Clerk secret key or publishable key is invalid, stale, or mismatched.",
        boundedPreviewLogTail(runtime.logs),
      );
      pushPreviewLog(runtime, `[preview] Auth config error (HTTP ${result.status})`);
    } else {
      runtime.status = "failed";
      runtime.errorCode = "preview_port_never_ready";
      runtime.error = withPreviewLogDiagnostic(
        `Dev server did not become healthy within ${HEALTH_PROBE_TIMEOUT_MS / 1000}s`,
        boundedPreviewLogTail(runtime.logs),
      );
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
 * Round 13 — the live verify must EARN a "crashed" verdict.
 *
 * Before this fix, ONE probe through the public E2B upstream (3 s
 * abort) returning anything non-healthy — including a mere timeout
 * while the 2 vCPU dev server was busy compiling routes for the
 * panel's own iframe load — permanently flipped a ready runtime to
 * failed with a guessed "may have crashed". The 2026-11-17 proof
 * showed runtimes passing real upstream fetches (healthy verifies
 * extending the session) and then dying on a later single fetch.
 * A single failed probe is therefore treated as what it is: one
 * missed fetch, not a death certificate. A crash verdict now
 * requires BOTH:
 *
 *   - sustained failure: at least PREVIEW_VERIFY_FAILURE_THRESHOLD
 *     consecutive failed probes spanning at least
 *     PREVIEW_VERIFY_FAILURE_WINDOW_MS (~15–30 s window), tracked on
 *     the runtime and reset by any healthy probe; AND
 *   - a dead server: the in-sandbox liveness check (pid file +
 *     kill -0, zombie-aware) reports the preview process gone.
 *
 * Two honest exceptions: a pid confirmed dead convicts on the FIRST
 * check that confirms it (no window to wait out — the evidence is
 * direct), and sustained failure with liveness UNREADABLE (the
 * check itself errored) still convicts — otherwise a broken liveness
 * path would make a genuinely dead server immortal. A live pid
 * always blocks the flip: the runtime stays ready and the miss is
 * logged as the transient it is.
 *
 * Round 15 (C1) — the 2026-11-17 re-proof convicted a runtime under
 * exactly the combination round 13 left open: probes capped at 3 s
 * while the cold-compiling guest answered in 6–12 s, and the
 * liveness exec starving in the same saturated guest and returning
 * UNREADABLE, which the sustained-failure rule then treated as
 * evidence of death. The rules above are therefore amended:
 *
 *   - an UNREADABLE liveness verdict is never evidence: those rounds
 *     do not accumulate toward conviction at all (the window pauses;
 *     after PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS consecutive
 *     unreadable rounds the verify logs that the verdict machinery
 *     itself is degraded);
 *   - conviction requires a READABLE verdict — a confirmed-dead pid —
 *     backed by a patient in-sandbox ground-truth check
 *     (checkSandboxPreviewGroundTruth): if the guest's server
 *     answers a local curl, the state is a data-path failure, never
 *     "dev server failed";
 *   - alive-but-failing rounds RESET the failure accounting instead
 *     of banking it (round 13/14 let early patience accumulate until
 *     a later unreadable round spent it);
 *   - the live verify probes with PREVIEW_VERIFY_PROBE_TIMEOUT_MS
 *     of patience instead of the start loop's 3 s.
 *
 * The threshold/window constants remain exported for the record
 * (and the round-13 tests that reference them), but the
 * sustained-failure conviction path they parameterized is retired:
 * no combination of unreadable verdicts convicts anymore.
 */
export const PREVIEW_VERIFY_FAILURE_THRESHOLD = 3;
export const PREVIEW_VERIFY_FAILURE_WINDOW_MS = 20_000;

/**
 * Round 15 (C1): patience for the LIVE verify's probes. The verify
 * used to share probeUpstream's 3 s abort with the start loop; a
 * cold-compiling 2 vCPU guest answers GET / in 6–12 s, so verify
 * probes read a live server as silence (2026-11-17 re-proof: the
 * guest logged 200s at 6.8–12.3 s while the verify convicted on
 * "no response"). The live verify runs on a ~30 s status cadence —
 * it can afford patience the 1 s start loop cannot. The start loop
 * keeps the 3 s default.
 */
export const PREVIEW_VERIFY_PROBE_TIMEOUT_MS = 15_000;

/** Exec budget for the in-sandbox ground-truth check (round 15, C1). */
export const PREVIEW_GROUND_TRUTH_TIMEOUT_MS = 30_000;

/**
 * Consecutive verify rounds with an UNREADABLE liveness verdict
 * before the verify logs an escalation line (round 15, C1): a
 * broken thermometer cannot convict, but it is worth surfacing.
 */
export const PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS = 5;

/**
 * Round 16 (C2) — gated sandbox recreation for a verifiably dead
 * preview address. The verify's external probe must fail
 * generically for at least this many consecutive rounds, spanning
 * at least PREVIEW_RECREATION_FAILURE_WINDOW_MS, before recreation
 * is even considered: at the panel's ~30 s status cadence that is
 * roughly two minutes of sustained dead-address evidence, never a
 * single bad round.
 */
export const PREVIEW_RECREATION_FAILURE_THRESHOLD = 4;
export const PREVIEW_RECREATION_FAILURE_WINDOW_MS = 90_000;

/**
 * Hard cap on recreations per preview session (runtime lifetime).
 * Recreation is expensive (a full cold provision) and a provider
 * whose ingress is down for EVERY sandbox would otherwise be
 * retried forever; after the cap the runtime stays ready-and-honest
 * under the round-15 (C1) rules and the cap is logged.
 */
export const PREVIEW_RECREATION_MAX_PER_SESSION = 2;

/**
 * Minimum spacing between recreation launches. A fresh sandbox
 * needs minutes to provision and start; a second recreation inside
 * the cooldown could only be chasing the first one's shadow.
 */
export const PREVIEW_RECREATION_COOLDOWN_MS = 120_000;

/** Bounded tail of the preview log carried in a failure diagnostic. */
const PREVIEW_LOG_DIAGNOSTIC_MAX_CHARS = 2_000;

/** The bounded, line-safe tail of a set of preview log lines. */
function boundedPreviewLogTail(lines: readonly string[]): string {
  return formatPreviewDiagnostic(lines).slice(-PREVIEW_LOG_DIAGNOSTIC_MAX_CHARS);
}

/**
 * Append the dev server's own last lines to a failure diagnostic
 * (round 13): the user-facing error used to be a guess ("may have
 * crashed") while the server's actual last words sat unread in the
 * sandbox. No tail available → the base text stands alone.
 */
function withPreviewLogDiagnostic(base: string, tail: string): string {
  if (!tail) return base;
  return `${base}\nLast lines from the dev server log (in-sandbox preview.log):\n${tail}`;
}

/** The last lines of the in-sandbox preview log, read fresh. */
async function readSandboxPreviewLogTail(
  support: SandboxPreviewSupport,
  sandboxId: string,
): Promise<string> {
  try {
    const transfer = requireFileTransfer(support.provider);
    const bytes = await transfer.readFile(sandboxId, LOG_PATH);
    const text = new TextDecoder().decode(bytes);
    return boundedPreviewLogTail(text.split("\n"));
  } catch {
    return ""; // no log (never started / already gone) — diagnostic stands alone
  }
}

export interface SandboxPreviewLiveness {
  /** The pid from the preview pid file, when one could be read. */
  pid: number | null;
  /** true = process alive; false = confirmed gone; null = undetermined. */
  alive: boolean | null;
}

/**
 * In-sandbox liveness of the preview process: read the pid file and
 * test the pid with kill -0, treating a zombie as dead (the launcher
 * `exec`s the dev command, so the pid IS the server process; a
 * zombie is a corpse awaiting reaping, not a server). Any failure
 * of the check itself — unreadable pid file, exec transport error,
 * unparseable output — yields alive: null, never a guessed verdict.
 */
export async function checkSandboxPreviewLiveness(
  support: SandboxPreviewSupport,
  sandboxId: string,
): Promise<SandboxPreviewLiveness> {
  try {
    const command =
      `pid=$(cat ${PID_PATH} 2>/dev/null); ` +
      'if [ -z "$pid" ]; then echo LITT_PREVIEW_LIVENESS=no-pid; exit 0; fi; ' +
      'if ! kill -0 "$pid" 2>/dev/null; then echo "LITT_PREVIEW_LIVENESS=dead pid=$pid"; exit 0; fi; ' +
      'state=$(awk \'{print $3}\' /proc/"$pid"/stat 2>/dev/null); ' +
      'if [ "$state" = "Z" ]; then echo "LITT_PREVIEW_LIVENESS=dead pid=$pid"; ' +
      'else echo "LITT_PREVIEW_LIVENESS=alive pid=$pid"; fi';
    const res = await support.provider.execute(sandboxId, {
      command,
      cwd: SANDBOX_WORKSPACE_ROOT,
      timeoutMs: 10_000,
    });
    const match = /LITT_PREVIEW_LIVENESS=(alive|dead) pid=(\d+)/.exec(res.stdout);
    if (match) {
      return { pid: Number(match[2]), alive: match[1] === "alive" };
    }
    return { pid: null, alive: null };
  } catch {
    return { pid: null, alive: null };
  }
}

export interface SandboxPreviewGroundTruth {
  /** HTTP status the guest's server returned to a local curl, when read. */
  status: number | null;
  /**
   * true = the guest answered locally; false = confirmed not
   * answering (curl completed with no HTTP response); null = the
   * check itself was unreadable (exec error / unparseable output).
   */
  answering: boolean | null;
}

/**
 * Round 15 (C1) — patient ground truth from INSIDE the sandbox:
 * curl the dev server on localhost with a 20 s in-guest budget
 * under a 30 s exec budget. This is the discriminator the round-15
 * diagnosis found missing: a guest answering locally while public
 * probes fail is a DATA-PATH state (dead ingress/token/address),
 * never a dead server — and a pid verdict that disagrees with a
 * locally-answering server is a pid-tracking failure, not a crash.
 * Like the liveness check, any failure of the check itself yields
 * answering: null, never a guessed verdict.
 */
export async function checkSandboxPreviewGroundTruth(
  support: SandboxPreviewSupport,
  sandboxId: string,
): Promise<SandboxPreviewGroundTruth> {
  try {
    const command =
      `code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 ` +
      `http://localhost:${SANDBOX_PREVIEW_PORT}/ 2>/dev/null); ` +
      'echo "LITT_PREVIEW_GROUND_TRUTH=$code"';
    const res = await support.provider.execute(sandboxId, {
      command,
      cwd: SANDBOX_WORKSPACE_ROOT,
      timeoutMs: PREVIEW_GROUND_TRUTH_TIMEOUT_MS,
    });
    const match = /LITT_PREVIEW_GROUND_TRUTH=(\d{3})/.exec(res.stdout);
    if (match) {
      const status = Number(match[1]);
      // curl prints 000 when no HTTP response was received at all
      // (connection refused / no listener): a readable "not
      // answering", distinct from an unreadable check.
      return { status: status === 0 ? null : status, answering: status !== 0 };
    }
    return { status: null, answering: null };
  } catch {
    return { status: null, answering: null };
  }
}

/** PreviewEndpoint.expiresAt is an ISO string; the runtime stores epoch ms. */
function parseEndpointExpiry(expiresAt: string | undefined): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Round 14: an endpoint this close to its recorded expiry (or past
 * it) is grounds for re-exposure on a failed verify round. The
 * endpoint's nominal life is the provider's idle timeout (15 min);
 * the skew keeps a verify round from racing the lapse.
 */
export const PREVIEW_EXPOSURE_REFRESH_SKEW_MS = 60_000;

interface UpstreamRepairOutcome {
  /** The probe result against the FRESH upstream. */
  result: SandboxProbeResult;
  /** The upstream now stored on the runtime. */
  upstream: Extract<PreviewUpstream, { kind: "sandbox" }>;
}

/**
 * Round 14 — repair the data path before judging the server.
 *
 * Re-expose the preview port, swap the runtime's stored upstream to
 * the fresh endpoint (origin + traffic token + expiry), and probe
 * the fresh address once. This is the discriminator the round-14
 * diagnosis named: a fresh address that answers proves the stored
 * one had died; a fresh address that also fails while the guest
 * serves locally proves the provider ingress/token path is down —
 * either way the runtime learns something conviction never could.
 *
 * Returns null when re-exposure itself is unavailable (provider
 * error) — the caller's round-13 rules then decide, exactly as
 * before this repair existed.
 *
 * Round 15 note: against the production E2B provider the "fresh"
 * endpoint is the SAME origin and the SAME token — exposePort
 * derives the host deterministically from (sandboxId, port) and
 * the traffic token is a property of the sandbox, not of the
 * exposure (e2b-provider.ts). The repair's real power is therefore
 * one more probe of the same address (plus a fresh synthetic
 * expiry); a genuinely new address requires a new sandbox — that
 * is round 16's C2 recreation (recreateSandboxPreview below),
 * which the verify escalates to only on sustained dead-address
 * evidence. The round-14 tests that mocked a DIFFERENT origin for
 * the same sandboxId modeled a provider that does not exist and
 * have been corrected to the deterministic contract.
 */
async function repairSandboxPreviewUpstream(
  support: SandboxPreviewSupport,
  runtime: PreviewRuntime,
  probe: (
    origin: string,
    headers: Record<string, string>,
  ) => Promise<SandboxProbeResult>,
): Promise<UpstreamRepairOutcome | null> {
  const upstream = runtime.upstream;
  if (!upstream || upstream.kind !== "sandbox") return null;
  let endpoint;
  try {
    endpoint = await support.provider.exposePort(
      upstream.sandboxId,
      SANDBOX_PREVIEW_PORT,
    );
  } catch {
    return null;
  }
  const fresh: Extract<PreviewUpstream, { kind: "sandbox" }> = {
    kind: "sandbox",
    sandboxId: upstream.sandboxId,
    origin: endpoint.url,
    headers: { [SANDBOX_TRAFFIC_TOKEN_HEADER]: endpoint.previewToken },
    expiresAt: parseEndpointExpiry(endpoint.expiresAt),
  };
  runtime.upstream = fresh;
  pushPreviewLog(
    runtime,
    `[preview] Re-exposed the preview port — fresh address ${endpoint.url} (was ${upstream.origin})`,
  );
  const result = await probe(fresh.origin, fresh.headers).catch(
    (): SandboxProbeResult => ({
      healthy: false,
      authConfigError: false,
      rootRouteMissing: false,
      status: null,
    }),
  );
  return { result, upstream: fresh };
}

/** In-flight recreation promises, keyed by runtime (test/observability handle). */
const recreationPromises = new WeakMap<PreviewRuntime, Promise<void>>();

/**
 * The detached recreation currently running for a runtime, if any.
 * Recreation outlives the verify round that launched it (a cold
 * provision takes minutes); tests await this to observe the
 * outcome deterministically.
 */
export function previewRecreationPromise(
  runtime: PreviewRuntime,
): Promise<void> | null {
  return recreationPromises.get(runtime) ?? null;
}

/**
 * Round 16 (C2) — recreate the sandbox to mint a genuinely new
 * preview address.
 *
 * The round-14 re-exposure repair cannot do this: exposePort
 * derives the host deterministically from (sandboxId, port) and
 * the traffic token belongs to the sandbox, so re-exposing a
 * sandbox whose E2B ingress is dead returns the identical dead
 * address forever (proven live 2026-11-17: the sandbox's dev
 * server healthy inside, every external probe timing out, the
 * "fresh address" log line naming the same URL twice). The only
 * remedy is a NEW sandbox — new id, new host, new token.
 *
 * Mechanics — no new machinery is invented:
 *   1. the executor's existing destroySandbox kills the dead
 *      sandbox and clears its binding (the volume already holds
 *      the workspace up to the last sync — the same durability
 *      contract reconcileBindings relies on when a binding is
 *      lost);
 *   2. startSandboxPreview re-runs the standard provisioning path
 *      (ensureSandboxForPreview provisions a fresh sandbox and
 *      mirrors the workspace from the volume, install, launch,
 *      expose), swapping runtime.upstream to the new endpoint and
 *      resolving the runtime's status through its own background
 *      health loop.
 *
 * Runs DETACHED from the verify round that triggered it: a cold
 * provision takes minutes and a status poll must never block on
 * it. The runtime is marked "starting" for the duration. A failure
 * is logged and degrades honestly — the runtime is restored to
 * ready (the C1 stay-ready posture) rather than wedged in
 * "starting", unless the start itself already recorded a terminal
 * state (e.g. an install failure, which startSandboxPreview marks
 * failed with its own error).
 */
async function recreateSandboxPreview(args: {
  support: SandboxPreviewSupport;
  runtime: PreviewRuntime;
  ws: WorkspaceDescriptor;
  probe?: (
    origin: string,
    headers: Record<string, string>,
  ) => Promise<SandboxProbeResult>;
}): Promise<void> {
  const { support, runtime, ws } = args;
  const upstream = runtime.upstream;
  const oldSandboxId =
    upstream?.kind === "sandbox" ? upstream.sandboxId : "unknown";
  const oldOrigin = upstream?.kind === "sandbox" ? upstream.origin : "unknown";
  runtime.status = "starting";
  runtime.startedAt = Date.now();
  runtime.error = null;
  runtime.errorCode = null;
  try {
    await support.executor.destroySandbox(ws);
    pushPreviewLog(
      runtime,
      `[preview] Destroyed sandbox ${oldSandboxId} (dead address ${oldOrigin}) — ` +
        `provisioning a fresh sandbox through the standard path`,
    );
    const started = await startSandboxPreview({
      support,
      runtime,
      ws,
      framework: runtime.framework,
      command: runtime.command,
      packageManager: runtime.packageManager ?? "pnpm",
      travelingEnv: buildSandboxTravelingEnv(runtime.clerkProjectEnv ?? {}),
      probe: args.probe,
    });
    const fresh = started.upstream;
    pushPreviewLog(
      runtime,
      fresh?.kind === "sandbox"
        ? `[preview] Sandbox recreation complete — new sandbox ${fresh.sandboxId}, ` +
            `new preview address ${fresh.origin} (was ${oldOrigin})`
        : `[preview] Sandbox recreation finished but the runtime has no sandbox ` +
            `upstream — see the start lines above`,
    );
  } catch (err) {
    pushPreviewLog(
      runtime,
      `[preview] Sandbox recreation failed (${err instanceof Error ? err.message : String(err)}) — ` +
        `the runtime keeps reporting its state honestly and no further attempt ` +
        `is made this round`,
    );
    // Never wedge the runtime in "starting" (a stale starting
    // runtime poisons later starts); a start that already recorded
    // its own terminal state keeps it.
    if (runtime.status === "starting") runtime.status = "ready";
  } finally {
    runtime.healthRecreationInFlight = false;
    recreationPromises.delete(runtime);
  }
}

/**
 * Live health verification for a sandbox runtime (the status route's
 * verifyPreviewHealth, sandbox branch): probe through the upstream
 * and flip the runtime truthfully, like the host path. Round 13: the
 * generic non-healthy verdict no longer flips on a single probe —
 * see the round-13 note above for the conviction rules. The
 * definitive verdicts (root route 404, auth-config 500) are
 * unchanged: those responses prove a live server answering wrongly,
 * so they still flip immediately.
 *
 * Round 14: a generic failure with a LIVE pid — or with a stored
 * endpoint at/past its recorded expiry — first tries to repair the
 * data path (re-expose + swap + re-probe, see
 * repairSandboxPreviewUpstream). The 2026-11-17 re-proof showed the
 * state round 13 could not express: guest alive and serving, public
 * address dead, no repair path — the runtime sat failed-but-alive
 * forever. Recovery now precedes conviction; the conviction rules
 * themselves are untouched for a genuinely dead server.
 *
 * Round 15 (C1): the conviction rules themselves ARE amended — see
 * the round-15 note at PREVIEW_VERIFY_FAILURE_THRESHOLD. Probes run
 * with 15 s patience; an unreadable liveness verdict records
 * nothing and convicts nothing; a confirmed-dead pid must be backed
 * by the in-sandbox ground-truth check before it convicts; and
 * alive-but-failing rounds reset the failure accounting.
 *
 * Round 16 (C2): the stay-ready outcomes above are honest but, for
 * a sandbox whose E2B ingress is genuinely dead, permanent — the
 * server serves locally forever while no browser can ever reach
 * it, and re-exposure returns the identical dead address. The
 * verify therefore ALSO tracks consecutive external probe failures
 * (healthExternalFailureCount/Since — reset only by a genuinely
 * healthy probe, never by a verdict round). When that failure is
 * sustained (PREVIEW_RECREATION_FAILURE_THRESHOLD rounds spanning
 * PREVIEW_RECREATION_FAILURE_WINDOW_MS) and the ground-truth check
 * says the guest answers locally — or the in-sandbox verdicts are
 * themselves unreadable while the address keeps failing — the
 * verify escalates to gated sandbox recreation
 * (recreateSandboxPreview): destroy the dead sandbox, provision a
 * fresh one, surface its new address. Ground truth saying the
 * server does NOT answer locally blocks recreation outright (the
 * server is the problem, not the address — the existing rules
 * govern), and the confirmed-dead-pid conviction path is never
 * preempted. Gates: at most PREVIEW_RECREATION_MAX_PER_SESSION
 * recreations per session, spaced by
 * PREVIEW_RECREATION_COOLDOWN_MS; after the cap the runtime stays
 * ready-and-honest and the cap is logged.
 */
export async function verifySandboxPreviewHealth(
  support: SandboxPreviewSupport,
  runtime: PreviewRuntime,
  deps: {
    /** Upstream probe override (tests). Defaults to a real fetch. */
    probe?: (
      origin: string,
      headers: Record<string, string>,
      timeoutMs?: number,
    ) => Promise<SandboxProbeResult>;
    /**
     * Workspace descriptor resolver for a recreation (round 16,
     * C2). Defaults to the workspace registry; tests inject the
     * descriptor directly.
     */
    resolveWorkspace?: (
      workspaceId: string,
    ) => WorkspaceDescriptor | undefined;
  } = {},
): Promise<boolean> {
  const upstream = runtime.upstream;
  if (!upstream || upstream.kind !== "sandbox" || runtime.status !== "ready") return false;
  await tailSandboxPreviewLogs(support, runtime).catch(() => {});
  const probe = deps.probe ?? probeUpstream;

  const flipRootRouteMissing = (): false => {
    runtime.status = "failed";
    runtime.errorCode = "preview_root_route_missing";
    runtime.error = withPreviewLogDiagnostic(
      "The preview server is running, but GET / returned 404 (Cannot GET /). Fix the project's root entry route and restart preview.",
      boundedPreviewLogTail(runtime.logs),
    );
    pushPreviewLog(runtime, "[preview] Root route missing during live health check (HTTP 404)");
    return false;
  };
  const flipAuthConfigError = (status: number | null): false => {
    runtime.status = "failed";
    runtime.errorCode = "preview_auth_config_error";
    runtime.error = withPreviewLogDiagnostic(
      `Health check detected an authentication configuration error (HTTP ${status}). ` +
        "The Clerk secret key or publishable key is invalid, stale, or mismatched.",
      boundedPreviewLogTail(runtime.logs),
    );
    pushPreviewLog(runtime, `[preview] Auth config error detected during health check (HTTP ${status})`);
    return false;
  };
  const markHealthy = async (): Promise<true> => {
    runtime.healthFailureCount = 0;
    runtime.healthFailureSince = null;
    runtime.healthLivenessUnreadableCount = 0;
    // Round 16 (C2): a genuinely healthy probe is the ONLY verdict
    // that clears the external-failure accounting — the address
    // demonstrably works, so the recreation evidence is gone.
    runtime.healthExternalFailureCount = 0;
    runtime.healthExternalFailureSince = null;
    runtime.lastHealthCheck = Date.now();
    // Traffic is flowing: keep the sandbox alive (§3.3).
    if (support.provider.extendTimeout) {
      await support.provider
        .extendTimeout(upstream.sandboxId, PREVIEW_SESSION_EXTENSION_MS)
        .catch(() => {});
    }
    return true;
  };

  // Round 15 (C1): the live verify probes with patience (15 s) —
  // a cold-compiling guest answering in 6–12 s is slow, not dead.
  // The probe's duration and outcome class ride the failure lines
  // below: "no response" no longer conflates an abort with a
  // network death.
  const probeStartedAt = Date.now();
  const result = await probe(
    upstream.origin,
    upstream.headers,
    PREVIEW_VERIFY_PROBE_TIMEOUT_MS,
  ).catch(
    (): SandboxProbeResult => ({
      healthy: false,
      authConfigError: false,
      rootRouteMissing: false,
      status: null,
    }),
  );
  const probeMs = Date.now() - probeStartedAt;
  if (result.healthy) return markHealthy();
  if (result.rootRouteMissing) return flipRootRouteMissing();
  if (result.authConfigError) return flipAuthConfigError(result.status);

  // Generic non-healthy (a 500 without auth text, a 3xx, a refused
  // connection, a probe timeout): evidence of a missed fetch, not
  // yet of a crash. Ask the sandbox whether the server process
  // still exists BEFORE recording anything (round 15, C1).
  const now = Date.now();
  const probeNote = `HTTP ${result.status ?? "no response"} after ${probeMs}ms`;

  // Round 16 (C2): EVERY generic external failure counts toward
  // the recreation evidence, whatever this round's liveness
  // verdict turns out to be — a dead address fails under alive,
  // dead-pid and unreadable verdicts alike. Only a genuinely
  // healthy probe (markHealthy) clears this accounting.
  runtime.healthExternalFailureCount =
    (runtime.healthExternalFailureCount ?? 0) + 1;
  if (!runtime.healthExternalFailureSince) {
    runtime.healthExternalFailureSince = now;
  }

  const liveness = await checkSandboxPreviewLiveness(support, upstream.sandboxId);

  // Round 14 repair: the pid lives (the address, not the server, is
  // the suspect) or the stored endpoint has lapsed — re-expose and
  // re-probe BEFORE any conviction. A confirmed-dead pid with an
  // unexpired endpoint skips repair entirely: re-exposure cannot
  // resurrect a process. The re-probe runs with the same patience
  // as the round's own probe (round 15). The probed origin rides
  // every failure line below — one line per verify round — so the
  // next diagnosis can see WHICH address died instead of
  // reconstructing it.
  const endpointExpired =
    upstream.expiresAt != null &&
    now >= upstream.expiresAt - PREVIEW_EXPOSURE_REFRESH_SKEW_MS;
  if (liveness.alive === true || endpointExpired) {
    const repair = await repairSandboxPreviewUpstream(
      support,
      runtime,
      (origin, headers) => probe(origin, headers, PREVIEW_VERIFY_PROBE_TIMEOUT_MS),
    );
    if (repair) {
      if (repair.result.healthy) {
        pushPreviewLog(
          runtime,
          `[preview] Preview address recovered — the re-exposed address is answering; ` +
            `the dev server (pid ${liveness.pid ?? "unknown"}) never died`,
        );
        return markHealthy();
      }
      if (repair.result.rootRouteMissing) return flipRootRouteMissing();
      if (repair.result.authConfigError) return flipAuthConfigError(repair.result.status);
      // The fresh address fails generically too. With a live pid
      // that is the provider-ingress signature, not a crash — the
      // verdict rules below still govern (stay ready). Note what
      // the round-15 diagnosis proved about this repair: for the
      // same sandbox the re-exposure returns the SAME address and
      // token (the provider derives both deterministically), so a
      // generic failure here is one more patient probe of the same
      // address, not a new endpoint — the tests now model exactly
      // that.
    }
  }

  /**
   * Round 16 (C2) — the recreation gate, evaluated at this round's
   * stay-ready outcomes. Sustained external failure is necessary
   * but not sufficient: the ground-truth discriminator decides
   * whether the ADDRESS or the SERVER is the problem. A guest that
   * does not answer locally blocks recreation (the existing rules
   * govern a dead server); a guest answering locally, or verdicts
   * too degraded to read while the address keeps failing, warrant
   * a fresh sandbox — subject to the session cap and cooldown.
   * Launching resets the external accounting, so the fresh address
   * earns its own evidence window. `knownGroundTruth` carries the
   * verdict the conviction path already computed, when it ran.
   */
  const maybeRecreate = async (
    knownGroundTruth: SandboxPreviewGroundTruth | null,
  ): Promise<void> => {
    if (runtime.healthRecreationInFlight) return;
    const failures = runtime.healthExternalFailureCount ?? 0;
    const since = runtime.healthExternalFailureSince ?? null;
    if (
      failures < PREVIEW_RECREATION_FAILURE_THRESHOLD ||
      since === null ||
      now - since < PREVIEW_RECREATION_FAILURE_WINDOW_MS
    ) {
      return;
    }
    const groundTruth =
      knownGroundTruth ??
      (await checkSandboxPreviewGroundTruth(support, upstream.sandboxId));
    if (groundTruth.answering === false) {
      pushPreviewLog(
        runtime,
        `[preview] Live health probe failed (${probeNote}) — the preview address has ` +
          `failed ${failures} consecutive probes over ${now - since}ms, but the dev ` +
          `server does not answer inside the sandbox either, so the server itself ` +
          `is the problem and sandbox recreation is not the remedy — staying ready ` +
          `(probed ${upstream.origin})`,
      );
      return;
    }
    const recreations = runtime.healthRecreationCount ?? 0;
    if (recreations >= PREVIEW_RECREATION_MAX_PER_SESSION) {
      pushPreviewLog(
        runtime,
        `[preview] Live health probe failed (${probeNote}) — the preview address is ` +
          `still dead after ${recreations} sandbox recreations this session; the ` +
          `recreation cap (${PREVIEW_RECREATION_MAX_PER_SESSION}) is reached, so no ` +
          `further recreation is attempted — staying ready and reporting the ` +
          `data-path state honestly (probed ${upstream.origin})`,
      );
      return;
    }
    const lastRecreationAt = runtime.healthLastRecreationAt ?? null;
    if (
      lastRecreationAt !== null &&
      now - lastRecreationAt < PREVIEW_RECREATION_COOLDOWN_MS
    ) {
      pushPreviewLog(
        runtime,
        `[preview] Live health probe failed (${probeNote}) — the preview address has ` +
          `failed ${failures} consecutive probes over ${now - since}ms, but the last ` +
          `sandbox recreation was ${now - lastRecreationAt}ms ago, inside the ` +
          `${PREVIEW_RECREATION_COOLDOWN_MS}ms cooldown — not recreating yet ` +
          `(probed ${upstream.origin})`,
      );
      return;
    }
    const ws = (deps.resolveWorkspace ?? getWorkspace)(runtime.workspaceId);
    if (!ws) {
      pushPreviewLog(
        runtime,
        `[preview] Live health probe failed (${probeNote}) — the preview address is ` +
          `dead across ${failures} consecutive probes over ${now - since}ms and ` +
          `recreation is warranted, but the workspace descriptor no longer exists, ` +
          `so there is nothing to recreate against — staying ready ` +
          `(probed ${upstream.origin})`,
      );
      return;
    }
    runtime.healthRecreationCount = recreations + 1;
    runtime.healthLastRecreationAt = now;
    runtime.healthRecreationInFlight = true;
    runtime.healthExternalFailureCount = 0;
    runtime.healthExternalFailureSince = null;
    pushPreviewLog(
      runtime,
      `[preview] Preview address dead across ${failures} consecutive probes over ` +
        `${now - since}ms while ${
          groundTruth.answering === true
            ? `the dev server answers inside the sandbox (local HTTP ${groundTruth.status})`
            : "the in-sandbox verdicts are unreadable"
        } — recreating the sandbox for a fresh address (attempt ${recreations + 1} of ` +
        `${PREVIEW_RECREATION_MAX_PER_SESSION}); old sandbox ${upstream.sandboxId}, ` +
        `old address ${upstream.origin}`,
    );
    const promise = recreateSandboxPreview({
      support,
      runtime,
      ws,
      probe: (origin, headers) => probe(origin, headers),
    });
    recreationPromises.set(runtime, promise);
    void promise;
  };

  if (liveness.alive === null) {
    // Round 15 (C1): an unreadable liveness verdict is not evidence
    // of anything about the server — the round records NO failure
    // and the conviction window does not advance. (Round 13/14 let
    // these rounds accumulate until they convicted a guest whose
    // only fault was being too busy to answer the liveness exec.)
    // Sustained unreadability is escalated in the log: the verdict
    // machinery being degraded is itself worth surfacing.
    runtime.healthLivenessUnreadableCount =
      (runtime.healthLivenessUnreadableCount ?? 0) + 1;
    const unreadable = runtime.healthLivenessUnreadableCount;
    pushPreviewLog(
      runtime,
      unreadable >= PREVIEW_LIVENESS_UNREADABLE_ESCALATION_ROUNDS
        ? `[preview] Live health probe failed (${probeNote}) and the liveness check itself ` +
            `has been unreadable for ${unreadable} consecutive rounds — the verdict machinery ` +
            `is degraded, not the server; staying ready (probed ${upstream.origin})`
        : `[preview] Live health probe failed (${probeNote}) but the liveness verdict is ` +
            `unreadable — no failure recorded, staying ready (probed ${upstream.origin})`,
    );
    // Round 16 (C2): unreadable verdicts plus a SUSTAINED dead
    // address is itself the recreation signature (the verdict
    // machinery and the ingress share the degraded channel).
    await maybeRecreate(null);
    return true;
  }
  runtime.healthLivenessUnreadableCount = 0;

  if (liveness.alive === true) {
    // The server process exists — the probe missed a busy or slow
    // upstream. Stay ready, and RESET the failure accounting
    // (round 15, C1): round 13/14 banked these failures, so the
    // patience spent on alive rounds stayed on the books until a
    // later bad round spent it on a conviction.
    runtime.healthFailureCount = 0;
    runtime.healthFailureSince = null;
    pushPreviewLog(
      runtime,
      `[preview] Live health probe failed (${probeNote}) but the dev server process ` +
        `(pid ${liveness.pid}) is alive in the sandbox — staying ready (probed ${upstream.origin})`,
    );
    // Round 16 (C2): a live pid under a sustained dead address is
    // the dead-ingress signature — escalate if ground truth agrees
    // the server serves locally.
    await maybeRecreate(null);
    return true;
  }

  // liveness.alive === false: the pid is confirmed dead. Record the
  // failure, then back the verdict with the patient ground-truth
  // check before convicting (round 15, C1).
  if (!runtime.healthFailureSince) runtime.healthFailureSince = now;
  runtime.healthFailureCount = (runtime.healthFailureCount ?? 0) + 1;
  const groundTruth = await checkSandboxPreviewGroundTruth(support, upstream.sandboxId);
  if (groundTruth.answering === true) {
    // The guest's server answers a local curl while its pid file
    // names a dead process: the pid tracking and the serving
    // reality disagree. That is a data-path / pid-tracking state —
    // never "dev server failed". Stay ready; reset the accounting.
    runtime.healthFailureCount = 0;
    runtime.healthFailureSince = null;
    pushPreviewLog(
      runtime,
      `[preview] Live health probe failed (${probeNote}) and the pid file's process ` +
        `(pid ${liveness.pid}) is gone, but the dev server answers inside the sandbox ` +
        `(local HTTP ${groundTruth.status}) — the public preview address is unreachable, ` +
        `the server is not; staying ready (probed ${upstream.origin})`,
    );
    // Round 16 (C2): the ground truth is already in hand and it
    // says the server serves locally — a sustained external
    // failure on top of that is the dead-ingress signature.
    await maybeRecreate(groundTruth);
    return true;
  }

  // Conviction earned: the pid is confirmed dead AND the guest does
  // not answer locally (a ground-truth check that is itself
  // unreadable leaves the confirmed-dead pid standing alone — the
  // strongest single verdict the machinery can produce). The
  // diagnostic carries the server's own last lines, not a guess.
  const tail = await readSandboxPreviewLogTail(support, upstream.sandboxId);
  runtime.status = "failed";
  runtime.errorCode = "preview_dev_server_failed";
  runtime.error = withPreviewLogDiagnostic(
    `Health check failed — the sandbox dev server process (pid ${liveness.pid}) is no longer running`,
    tail,
  );
  pushPreviewLog(
    runtime,
    `[preview] Health check failed — dev server process (pid ${liveness.pid}) is dead`,
  );
  return false;
}

/**
 * One upstream health probe (mirrors PreviewManager.probeHealth's
 * verdicts). The timeout defaults to the start loop's snappy 3 s;
 * the live verify passes PREVIEW_VERIFY_PROBE_TIMEOUT_MS (round 15,
 * C1) — patience is a property of the caller, not of the probe.
 */
export async function probeUpstream(
  origin: string,
  headers: Record<string, string>,
  timeoutMs = 3000,
): Promise<SandboxProbeResult> {
  const resp = await fetch(`${origin}/`, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
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
