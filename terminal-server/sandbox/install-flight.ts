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

import type { ExecuteCommandResult } from "./provider";

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
