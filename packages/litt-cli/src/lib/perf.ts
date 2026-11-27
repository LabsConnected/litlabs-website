/**
 * Startup timing instrumentation — gated by LITT_PERF=1.
 *
 * Emits `t+<ms>ms <label>` lines on stderr so cold/warm launch latency
 * can be measured without a profiler. Zero cost when unset: the check
 * is a single env lookup per mark, and marks are placed on paths that
 * already matter (entry, cockpit stages, first render).
 *
 * The clock starts at process start (perf_hooks `timeOrigin`) so marks
 * reflect true elapsed wall time since `node` began, not since main().
 */

import { performance } from "node:perf_hooks";

const enabled = process.env.LITT_PERF === "1";

export function perfMark(label: string): void {
  if (!enabled) return;
  const ms = Math.round(performance.now());
  process.stderr.write(`[perf] t+${ms}ms ${label}\n`);
}
