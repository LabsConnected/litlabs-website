/**
 * Dependency-install single-flight — round 10 (2026-11-16).
 *
 * Two code paths install dependencies inside a workspace's sandbox:
 * prepare's background install (workspace-executor.ts, fired on a
 * timer after the prepare response) and preview start's inline
 * install (preview/sandbox-runtime.ts, when it finds the sandbox's
 * deps stale). They run the SAME package-manager install in the SAME
 * sandbox working directory against the SAME store — and until now
 * nothing stopped them running CONCURRENTLY: prepare's long phase is
 * deliberately unlocked, the web preview route re-prepares on every
 * POST and immediately starts a preview, and a stale stamp (the
 * background install hasn't finished — or failed silently) makes
 * preview launch its own install on top of the background one.
 *
 * In the 2026-11-16 live proof that duplicate is the leading
 * amplifier for the preview install dying mid-flight with exit -1:
 * two pnpm installs resolving 1,620 packages in one sandbox at
 * 1 vCPU / 1024 MB, until envd reported one of them killed by a
 * signal. One install per sandbox is the correct concurrency: the
 * second caller ADOPTS the in-flight install's outcome (the command,
 * cwd, and env are identical at both sites by construction — the
 * shared budget in install-stamp.ts exists for the same reason) and
 * then re-validates against the freshness stamp, which stays the
 * ground truth for "are these deps usable".
 *
 * The flight registry is keyed by sandboxId (not workspaceId): a
 * destroyed-and-recreated sandbox is a different install target and
 * must never adopt its predecessor's outcome. Entries are removed
 * when the install settles, so a later caller starts a fresh flight
 * — this is deduplication of CONCURRENT installs, not caching.
 */

import type { ExecuteCommandResult, SandboxProvider } from "./provider";

export interface SandboxInstallFlight {
  /** The single install's outcome, whoever launched it. */
  result: ExecuteCommandResult;
  /**
   * True when this caller adopted another caller's in-flight install
   * instead of launching its own. Adopters re-check the freshness
   * stamp before trusting the outcome (see sandbox-runtime.ts).
   */
  adopted: boolean;
}

const inFlightInstalls = new Map<string, Promise<ExecuteCommandResult>>();

/**
 * Run `runInstall` as THE install for `sandboxId`, or adopt the one
 * already in flight. The returned promise rejects exactly when the
 * single install's execution rejects (provider timeout/transport) —
 * for the owner and for every adopter alike, matching what each
 * caller's own install would have done.
 */
export function runSandboxInstallOnce(
  sandboxId: string,
  runInstall: () => Promise<ExecuteCommandResult>,
): Promise<SandboxInstallFlight> {
  const existing = inFlightInstalls.get(sandboxId);
  if (existing) {
    return existing.then((result) => ({ result, adopted: true }));
  }
  // Assigned synchronously below, before the finally can ever run
  // (the install cannot settle within this tick) — the definite-
  // assignment assertion states exactly that.
  let flight!: Promise<ExecuteCommandResult>;
  flight = (async () => {
    try {
      return await runInstall();
    } finally {
      // Clear only our own entry, and clear it as the flight settles
      // (before waiters resume), so the next caller starts fresh.
      if (inFlightInstalls.get(sandboxId) === flight) {
        inFlightInstalls.delete(sandboxId);
      }
    }
  })();
  inFlightInstalls.set(sandboxId, flight);
  return flight.then((result) => ({ result, adopted: false }));
}

/**
 * Explain a negative install exit code, or return null for a normal
 * (non-)exit. envd reports a process that did not exit on its own —
 * killed by a signal (OOM-killer / process-manager kill) — with a
 * negative code (-1 in the 2026-11-16 proof); a package-manager
 * failure is a positive exit, and a command timeout never returns a
 * code at all (the provider throws for it). Naming the mechanism in
 * the logs makes the next -1 self-explaining instead of a mystery
 * exit code. This is a log/diagnostic string only — callers keep
 * surfacing the raw exit code to users exactly as before.
 */
export function describeSandboxInstallExit(result: ExecuteCommandResult): string | null {
  if (result.exitCode >= 0) return null;
  return (
    `install process was killed by a signal (exit ${result.exitCode}) — ` +
    `envd reported no normal exit; at the sandbox's 1 vCPU / 1024 MB ` +
    `limits the in-sandbox OOM killer is the leading cause`
  );
}

/**
 * Install memory shaping — round 12 (2026-11-16).
 *
 * The install is the heaviest workload the sandbox ever runs, and it
 * ran UNSHAPED: both sites passed a bare `<pm> install
 * --prefer-offline` with an env of only NODE_ENV / the workspace-root
 * check / HOME, and the workspace tree's own .npmrc ships
 * `node-options=--max-old-space-size=4096` — a 4 GB Node heap
 * allowance inside a 1 GB sandbox. A Node process honoring that
 * allowance applies no GC backpressure until ~4 GB of heap, so
 * growth runs straight into the cgroup ceiling and the guest
 * kernel's OOM killer decides (the standing explanation for the
 * exit -1 install deaths; ROUND12-PREVIEW-DIAGNOSIS-2026-11-16.md).
 * pnpm's defaults are tuned for developer machines, not 1 vCPU:
 * network-concurrency 16, child-concurrency 5.
 *
 * buildSandboxInstallEnv is the ONE place the install env is built,
 * so the two sites cannot drift apart (the same reason the budget
 * lives in install-stamp.ts). It is used ONLY for the install exec:
 * the dev-server launch and user command execs never see it.
 */

/** The sandbox's enforced memory ceiling (template-built, 2048 MB). */
export const SANDBOX_MEMORY_LIMIT_BYTES = 2048 * 1024 * 1024;

/**
 * Node heap cap for the install process. 768 MB leaves 256 MB of the
 * 1024 MB cgroup for everything else resident in the box (envd, the
 * shell, pnpm's non-heap RSS — binary, stacks, download buffers,
 * mmap'd store files) while making V8 shed memory at a survivable
 * bound instead of growing to the ceiling. Deliberately above the
 * diagnosis's 512 MB example: resolving/linking a ~1,620-package
 * monorepo at 512 MB risks GC thrash inside the 900 s budget, and
 * 768 MB still guarantees the heap alone can never reach the limit.
 */
export const SANDBOX_INSTALL_NODE_HEAP_MB = 768;

/**
 * pnpm fetch parallelism for installs. Default is 16 concurrent
 * downloads, each holding TLS state and buffers the single vCPU
 * cannot service anyway; 4 keeps the fetch pipeline saturated at a
 * quarter of the connection memory.
 */
export const SANDBOX_INSTALL_NETWORK_CONCURRENCY = 4;

/**
 * pnpm child-process parallelism for installs. Default is 5; every
 * child is a Node process carrying its own heap allowance, so on
 * 1 vCPU / 1024 MB the bound is 2.
 */
export const SANDBOX_INSTALL_CHILD_CONCURRENCY = 2;

/**
 * The full environment for ONE sandbox dependency install, shared by
 * prepare's background install and preview start's inline install.
 *
 * NODE_OPTIONS is set in the exec env — not via the tree's .npmrc —
 * because Node reads it at process start: it caps pnpm's own heap
 * (the resolve/link peak lives in the main process) and is inherited
 * by every child pnpm spawns. The workspace .npmrc file itself is
 * NOT edited: its 4096 allowance is the project's choice for its own
 * machines, and the override applies to the install exec only.
 *
 * The concurrency bounds travel as npm_config_* env vars, the
 * channel pnpm reads config from; for npm/yarn installs the extra
 * keys are inert and NODE_OPTIONS still applies (both are Node).
 */
export function buildSandboxInstallEnv(homeDir: string): Record<string, string> {
  return {
    NODE_ENV: "development",
    NPM_CONFIG_IGNORE_WORKSPACE_ROOT_CHECK: "true",
    HOME: homeDir,
    NODE_OPTIONS: `--max-old-space-size=${SANDBOX_INSTALL_NODE_HEAP_MB}`,
    npm_config_network_concurrency: String(SANDBOX_INSTALL_NETWORK_CONCURRENCY),
    npm_config_child_concurrency: String(SANDBOX_INSTALL_CHILD_CONCURRENCY),
  };
}

/**
 * Dev-server launch memory shaping — round 13 (2026-11-17).
 *
 * Until now the launch was the ONLY heavy sandbox workload still
 * unshaped: sandbox-runtime passed no NODE_OPTIONS, so the dev
 * server inherited the workspace tree .npmrc's
 * `--max-old-space-size=4096` — a 4 GB heap allowance inside the
 * 2048 MB template. `next dev` cold-compiling this monorepo is the
 * heaviest thing the server ever does, and it happens exactly in
 * the health-probe window; with no GC backpressure before 4 GB,
 * heap growth runs into the cgroup ceiling and the guest OOM killer
 * can take the whole process group after the server first answered
 * (the leading hypothesis of ROUND13-PREVIEW-DIAGNOSIS-2026-11-17.md
 * for the "ready, then flipped to crashed" failures).
 *
 * The bound is the launch's OWN, not the install env reused: the
 * install's 768 MB caps a resolve/link workload whose peak lives in
 * one main process, while a dev server additionally holds the
 * module graph and compiled routes in heap — 768 MB risks GC thrash
 * mid-compile. 1280 MB gives compile headroom while still
 * guaranteeing the heap alone can never reach the 2048 MB ceiling:
 * ~768 MB stays for envd, the launch shell, and the server's
 * non-heap RSS (binary, stacks, mmap'd files, native compiler
 * buffers, which live outside the V8 heap). And when V8 does hit
 * the bound it prints a "JavaScript heap out of memory" line into
 * preview.log — which the round-13 failure diagnostics now surface —
 * instead of dying as a silent cgroup kill.
 *
 * Deliberately ONLY NODE_OPTIONS: the install env's npm_config_*
 * concurrency keys are install-only semantics (fetch/child
 * parallelism for a package manager run) and mean nothing to a dev
 * server; the launch site composes this over its own env.
 */
export const SANDBOX_PREVIEW_NODE_HEAP_MB = 1280;

/** The memory-shaping subset of the sandbox dev-server launch env. */
export function buildSandboxPreviewLaunchEnv(): Record<string, string> {
  return {
    NODE_OPTIONS: `--max-old-space-size=${SANDBOX_PREVIEW_NODE_HEAP_MB}`,
  };
}

/**
 * Install memory evidence — round 12 (2026-11-16).
 *
 * The provider adapter returns only an exit code for an install, so
 * no log the code wrote could distinguish an OOM kill from any other
 * signal — every exit -1 cost a diagnosis round. After each install
 * attempt this reads the two settlers back out of the (surviving)
 * sandbox and logs them through the sandbox-lifecycle logger:
 *
 *   - the sandbox cgroup's memory.peak — the attempt's high-water
 *     mark against the 2147483648 limit. Round 13: the cgroup
 *     directory is resolved from /proc/self/cgroup FIRST (the v2
 *     unified line `0::/<scope>`), because in the E2B guest the
 *     sandbox's accounting lives under a scoped subpath and BOTH
 *     hardcoded paths below were absent — every live evidence line
 *     read memory.peak=unknown while the install half worked fine
 *     (ROUND13-PREVIEW-DIAGNOSIS-2026-11-17.md, Q6). The canonical
 *     v2 path and the v1 memory.max_usage_in_bytes remain as
 *     fallbacks, and when no path yields a number the read's first
 *     stderr line is logged alongside — the evidence can never
 *     again fail silently. Peak ≈ limit proves the box hit the
 *     ceiling; a peak well below it exonerates memory entirely.
 *   - on a signal-killed install (negative exit), the tail of the
 *     kernel's OOM lines from dmesg, which names the victim process
 *     and its RSS when the kill was a cgroup OOM.
 *
 * STRICTLY best-effort: a short timeout, every error swallowed, and
 * the install's outcome, stamp, and control flow are exactly what
 * they would have been without it. It only ever writes log lines.
 */

/** Budget for the evidence read — a cat and maybe a dmesg tail. */
export const SANDBOX_INSTALL_EVIDENCE_TIMEOUT_MS = 10_000;

export async function logSandboxInstallMemoryEvidence(args: {
  provider: SandboxProvider;
  sandboxId: string;
  install: ExecuteCommandResult;
  log: (message: string) => void;
}): Promise<void> {
  const { provider, sandboxId, install, log } = args;
  try {
    const signalKilled = install.exitCode < 0;
    // Resolve the cgroup directory from /proc/self/cgroup (round
    // 13): the v2 unified line is `0::/<scope>` and the peak file is
    // /sys/fs/cgroup<scope>/memory.peak. In the E2B guest the scope
    // is not `/`, so the two hardcoded paths this command used to
    // try do not exist and the peak silently read "unknown". Each
    // attempt's stderr is captured (last try wins) and reported when
    // no path yields a number, so a future layout change is
    // diagnosable from the log line alone.
    const command =
      'errf=/tmp/litt-memory-evidence.err; peak=""; err=""; ' +
      "cg=$(awk -F: '$1==0 {print $3; exit}' /proc/self/cgroup 2>/dev/null); " +
      'if [ -n "$cg" ] && [ "$cg" != "/" ]; then ' +
      'peak=$(cat "/sys/fs/cgroup${cg}/memory.peak" 2>"$errf"); ' +
      '[ -s "$errf" ] && err=$(head -n 1 "$errf"); fi; ' +
      'if [ -z "$peak" ]; then ' +
      'peak=$(cat /sys/fs/cgroup/memory.peak 2>"$errf"); ' +
      '[ -s "$errf" ] && err=$(head -n 1 "$errf"); fi; ' +
      'if [ -z "$peak" ]; then ' +
      'peak=$(cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>"$errf"); ' +
      '[ -s "$errf" ] && err=$(head -n 1 "$errf"); fi; ' +
      "printf 'LITT_MEMORY_PEAK=%s\\n' \"${peak:-unknown}\"; " +
      "printf 'LITT_MEMORY_PEAK_ERR=%s\\n' \"$err\"" +
      (signalKilled
        ? "; dmesg 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -n 5"
        : "");
    const evidence = await provider.execute(sandboxId, {
      command,
      timeoutMs: SANDBOX_INSTALL_EVIDENCE_TIMEOUT_MS,
    });
    const lines = evidence.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const peakLine = lines.find((line) => line.startsWith("LITT_MEMORY_PEAK="));
    const peakRaw = peakLine?.slice("LITT_MEMORY_PEAK=".length) ?? "unknown";
    const peak = /^\d+$/.test(peakRaw) ? peakRaw : "unknown";
    log(
      `[sandbox-lifecycle] install memory evidence sandbox=${sandboxId} ` +
        `exit=${install.exitCode} memory.peak=${peak} limit=${SANDBOX_MEMORY_LIMIT_BYTES}`,
    );
    if (peak === "unknown") {
      const errLine = lines.find((line) => line.startsWith("LITT_MEMORY_PEAK_ERR="));
      const peakErr = errLine?.slice("LITT_MEMORY_PEAK_ERR=".length).trim() ?? "";
      if (peakErr) {
        log(
          `[sandbox-lifecycle] install memory evidence sandbox=${sandboxId} ` +
            `peak read failed: ${peakErr.slice(0, 200)}`,
        );
      }
    }
    if (signalKilled) {
      for (const line of lines) {
        if (line.startsWith("LITT_MEMORY_PEAK=")) continue;
        log(
          `[sandbox-lifecycle] install memory evidence sandbox=${sandboxId} kernel: ${line}`,
        );
      }
    }
  } catch {
    // Best effort — see docstring. A failed evidence read (sandbox
    // already gone, provider transport error) changes nothing.
  }
}
