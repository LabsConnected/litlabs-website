/**
 * motion — single source of truth for "should the TUI animate?".
 *
 * Android text selection (long-press Copy/Share) is cancelled whenever
 * the terminal repaints, so every periodic Ink redraw (cursor blink,
 * spinners, pulses, per-second clocks) fights the selection handles.
 *
 * Resolution order:
 *   1. LITT_REDUCED_MOTION=1|true|yes|on   -> reduced
 *   2. LITT_REDUCED_MOTION=0|false|no|off  -> full motion (even on Termux)
 *   3. otherwise reduced on Termux/Android, full motion elsewhere
 *
 * Desktop terminals are unaffected unless the env var is set.
 */

import { useMemo } from "react";

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/** Tick period (ms) for status clocks while motion is reduced. */
export const REDUCED_CLOCK_MS = 5000;

function detectTermux(env: NodeJS.ProcessEnv): boolean {
  return !!env.TERMUX_VERSION || (env.PREFIX?.includes("/com.termux/") ?? false);
}

export function isReducedMotion(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.LITT_REDUCED_MOTION?.trim().toLowerCase();
  if (raw && TRUTHY.has(raw)) return true;
  if (raw && FALSY.has(raw)) return false;
  return detectTermux(env);
}

/** Clock tick period: normal cadence, or a slow one when motion is reduced. */
export function clockIntervalMs(normalMs: number, env: NodeJS.ProcessEnv = process.env): number {
  return isReducedMotion(env) ? Math.max(normalMs, REDUCED_CLOCK_MS) : normalMs;
}

export function useReducedMotion(): boolean {
  return useMemo(() => isReducedMotion(), []);
}
