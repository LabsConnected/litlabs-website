/**
 * Dex emergency stop — independent of the HTTP listener.
 *
 * A `STOP` sentinel file under ~/.litt/dex/ halts the agent: checked on
 * EVERY request and on a timer, so it works even when the loop is wedged.
 * `litt dex stop` writes the sentinel; the agent deletes it on clean
 * startup only — a stale sentinel from a previous kill stays honored
 * until an explicit fresh start removes it.
 */

import { closeSync, existsSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dexHome } from "./dex-home.js";

const SENTINEL = "STOP";

export function stopSentinelPath(): string {
  return join(dexHome(), SENTINEL);
}

export function isStopRequested(): boolean {
  return existsSync(stopSentinelPath());
}

/** External stop — called by `litt dex stop`, no HTTP involved. */
export function requestStop(): void {
  closeSync(openSync(stopSentinelPath(), "a"));
}

/** Clear the sentinel — only on explicit `litt dex serve` startup. */
export function clearStop(): void {
  rmSync(stopSentinelPath(), { force: true });
}
