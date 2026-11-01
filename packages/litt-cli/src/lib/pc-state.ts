/**
 * PC performance-mode state — persisted in ~/.litt/pc-mode.json.
 *
 * The state file makes `litt pc perf` reversible: it records the mode,
 * when it was applied, the previous mode, and the settings needed to
 * restore the prior state (e.g. the power scheme that was active before
 * LIGHT mode switched to Balanced).
 *
 * `preferredModel` is advisory only — surfaces that want to honor the
 * performance tier (local model routing, agent prompts) may read it.
 * The `pc` command never rewrites model-prefs.json or provider logic.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PcMode = "light" | "dev" | "max";

export const PC_MODES: PcMode[] = ["light", "dev", "max"];

export interface PcModeState {
  version: 1;
  mode: PcMode;
  appliedAt: string;
  previousMode: PcMode | null;
  /** Advisory preferred model for this tier (read-only for other surfaces). */
  preferredModel: string;
  /** Saved settings required to undo the mode's system changes. */
  restore: {
    powerSchemeGuid?: string;
    powerSchemeName?: string;
  };
  /** Human-readable record of what was applied. */
  actions: string[];
}

export function pcStatePath(): string {
  return join(homedir(), ".litt", "pc-mode.json");
}

export function readPcState(): PcModeState | null {
  try {
    const p = pcStatePath();
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, "utf-8")) as Partial<PcModeState>;
    if (j.version !== 1 || !j.mode || !PC_MODES.includes(j.mode)) return null;
    return {
      version: 1,
      mode: j.mode,
      appliedAt: j.appliedAt ?? "",
      previousMode: j.previousMode ?? null,
      preferredModel: j.preferredModel ?? "",
      restore: j.restore ?? {},
      actions: j.actions ?? [],
    };
  } catch {
    return null;
  }
}

export function writePcState(state: PcModeState): void {
  const p = pcStatePath();
  mkdirSync(join(homedir(), ".litt"), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf-8");
}
