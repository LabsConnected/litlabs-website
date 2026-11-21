/**
 * Sandbox preview serve mode — dev server vs production build.
 *
 * The sandbox preview has always run a project's dev server
 * (`next dev` for Next.js). That is the right default for small
 * projects: it boots fast and hot-reloads edits. It is the wrong
 * default for LARGE Next.js projects on the sandbox's 4 vCPU /
 * 4096 MB: the dev server's compile/watch load starves the box —
 * the live proof of 2026-11-19 showed the flagship litlabs-website
 * project (4,028 files on the volume, ~1,620 installed packages)
 * render, then go unreachable at +2–3 minutes while the dev
 * process was still alive inside: outside probes timed out, the
 * sandbox liveness signal went unreadable, the box was killed, and
 * recreation died the same way. A production build front-loads the
 * compile cost into one bounded step, and `next start` then serves
 * the built output with a fraction of the dev server's footprint —
 * light and steady for the whole session.
 *
 * The trade-off is deliberate and user-visible: on the
 * production-build path, edits do NOT hot-appear — the preview
 * must be restarted to pick up changes (the start path logs this
 * where the user can see it). Small projects keep `next dev` and
 * its hot reload.
 *
 * The size signal is the project's file count on the VOLUME,
 * measured by PreviewManager at start time (the volume is the
 * project tree the sandbox syncs and the dev server would watch —
 * node_modules and build output excluded, since they are not the
 * project's own weight). Framework and command detection stay in
 * PreviewManager.detectFramework; this module holds only the rule,
 * the counter, and the production commands, so the rule is unit
 * testable without a sandbox.
 */

import { readdirSync } from "fs";
import { join } from "path";

/** How a sandbox preview serves its project. */
export type PreviewServeMode = "dev" | "production-build";

/**
 * File-count threshold above which a Next.js project is served
 * from a production build instead of `next dev`.
 *
 * Calibration, from the two live data points of 2026-11-19: the
 * scaffolded small Next.js project that renders and holds on dev
 * has ~10 files; the litlabs-website project whose dev server
 * chokes the sandbox has 4,028 files (2,224 under src/ alone).
 * 250 sits far above anything a small site grows to by accident
 * and far below the monorepo class that provably starves the box,
 * so the boundary does not need to be precise to be safe: below
 * it, dev's hot reload wins; above it, stability wins.
 */
export const PREVIEW_PROD_BUILD_FILE_THRESHOLD = 250;

/**
 * TOTAL wall-clock budget for the in-sandbox production build.
 *
 * This used to be 900 s and was passed as the timeoutMs of ONE
 * blocking provider.execute — which made it a hard ceiling no
 * large build could beat: live proof 2026-11-20 (build d04fb354)
 * showed the litlabs-website build still running when the
 * request died at the cap with [deadline_exceeded], on three
 * attempts, never reaching the serve step. A local measurement
 * of this repo's `next build` (PREVIEW-BUILD-TIMEOUT-DIAGNOSIS-
 * 2026-11-20) took 908 s on a throttled ~1.5-CPU VM with ~8 GB
 * RAM — right at the 900 s cap even uncontended-by-design and
 * with 4× the sandbox's memory — and its peak RSS was 3,179 MB,
 * more than the sandbox's entire 2048 MB. On the sandbox's
 * 2 vCPU the same build is slower still, so a 15-minute cap is
 * not a slow-build guard, it is a guarantee the flagship
 * project can never preview.
 *
 * The build now runs DETACHED in the sandbox (sandbox-runtime.ts)
 * and this constant is only the poll loop's total budget: no
 * single request is ever outstanding longer than the launch /
 * poll executes (30 s), and every poll re-arms the sandbox's
 * session lifetime through provider.execute, so a build inside
 * this budget cannot outlive its sandbox the way the blocking
 * request could ([unavailable] sandbox-EOL failure, same proof).
 * 45 minutes covers the measured build with headroom while
 * still failing a genuinely wedged build honestly, with its
 * output tail, inside one start.
 */
export const SANDBOX_PREVIEW_BUILD_TIMEOUT_MS = 2_700_000;

/**
 * Health-probe budget for the production-build path. The dev path
 * keeps the sandbox runtime's 120 s window (HEALTH_PROBE_TIMEOUT_MS
 * in sandbox-runtime.ts): a dev server that will ever answer does
 * so quickly once listening. A production build is different — the
 * probe clock starts when the detached launch returns, but on a
 * just-build-saturated 2 vCPU box `next start` still has to load
 * the built server and its first GET / render can be slow, so the
 * 120 s dev window convicted a healthy start (live proof
 * 2026-11-19: the process was still alive after the window expired
 * and the start failed "did not become healthy"). 300 s covers the
 * observed spawn-to-listening-plus-first-render tail with room,
 * while staying far below the install/build budgets it follows.
 */
export const PREVIEW_PROD_HEALTH_PROBE_TIMEOUT_MS = 300_000;

/**
 * Resolve the health-probe budget for a serve mode. The dev budget
 * is passed in by the caller (it lives in sandbox-runtime.ts, which
 * imports this module — passing it in keeps the dependency one-way).
 */
export function resolvePreviewHealthProbeTimeoutMs(
  serveMode: PreviewServeMode,
  devTimeoutMs: number,
): number {
  return serveMode === "production-build"
    ? PREVIEW_PROD_HEALTH_PROBE_TIMEOUT_MS
    : devTimeoutMs;
}

/**
 * Directories that never count toward a project's size: installed
 * dependencies (present on the volume for some projects, and pure
 * weight the project's own code did not create) and generated
 * output (a stale .next must not flip a small project into the
 * production path — and the production path itself writes .next
 * inside the sandbox, never on the volume).
 */
const NON_PROJECT_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", ".cache"]);

/**
 * Count a project tree's files on the volume, excluding
 * NON_PROJECT_DIRS. Stops early once `limit` is reached — callers
 * deciding against PREVIEW_PROD_BUILD_FILE_THRESHOLD only need to
 * know which side of it the tree is on, so counting a 4,000-file
 * tree costs a 251-file walk. Unreadable directories are skipped:
 * a partially readable tree still yields a usable lower bound.
 */
export function countProjectFiles(
  root: string,
  limit: number = PREVIEW_PROD_BUILD_FILE_THRESHOLD + 1,
): number {
  let count = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!NON_PROJECT_DIRS.has(entry.name)) stack.push(join(dir, entry.name));
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        count += 1;
        if (count >= limit) return count;
      }
    }
  }
  return count;
}

/**
 * The serve-mode rule: production-build ONLY for Next.js projects
 * above the file threshold. Every other framework — and every
 * small Next.js project — keeps exactly the serve path it has
 * today.
 */
export function resolvePreviewServeMode(framework: string, fileCount: number): PreviewServeMode {
  return framework === "nextjs" && fileCount > PREVIEW_PROD_BUILD_FILE_THRESHOLD
    ? "production-build"
    : "dev";
}

/**
 * The production build command, mirroring detectFramework's dev
 * command shape (`<pm> exec next …` — the project's own dev script
 * is bypassed for the same reason: it may hardcode ports or flags
 * that belong to the project's machines, not the preview).
 */
export function nextProductionBuildCommand(packageManager: string): string {
  return `${packageManager} exec next build`;
}

/**
 * The production serve command. Carries the same `$PORT`
 * placeholder and hostname argument as the dev command;
 * PreviewManager performs the `$PORT` substitution for the sandbox
 * exactly as it does for dev.
 */
export function nextProductionStartCommand(packageManager: string, hostname: string): string {
  return `${packageManager} exec next start --port $PORT --hostname ${hostname}`;
}
