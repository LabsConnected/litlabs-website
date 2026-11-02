/**
 * PC performance-mode plan builder — pure functions.
 *
 * Given the desired mode and a snapshot of current system state, produce
 * the ordered list of actions to apply. Pure and side-effect free so the
 * whole contract is unit-testable; the command layer executes the plan.
 *
 * Action kinds:
 *   power-scheme   — switch the active Windows power plan (reversible via
 *                    the scheme GUID recorded in pc-mode.json)
 *   ollama-unload  — `ollama stop <model>`; model reloads on next request
 *   ollama-preload — warm-load a model via /api/generate keep_alive
 *   state          — write ~/.litt/pc-mode.json (always applied last)
 *   note           — advisory line shown to the user (never executed)
 */

import type { PcMode } from "./pc-state.js";

export const BALANCED_GUID = "381b4222-f694-41f0-9685-ff5bb260df2e";
export const HIGH_PERF_GUID = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";

export interface ModeMeta {
  title: string;
  purpose: string;
  preferredModel: string;
  preferredCtx: string;
}

export const MODE_META: Record<PcMode, ModeMeta> = {
  light: {
    title: "LIGHT",
    purpose: "Browsing, everyday work, lightweight development",
    preferredModel: "litt-hermes-fast:8k",
    preferredCtx: "8K",
  },
  dev: {
    title: "AI DEVELOPMENT",
    purpose: "LiTT Studio + local AI + development agents (default)",
    preferredModel: "litt-hermes:32k",
    preferredCtx: "32K",
  },
  max: {
    title: "MAX PERFORMANCE",
    purpose: "Intensive inference, builds, large-context workloads",
    preferredModel: "litt-hermes:64k",
    preferredCtx: "64K",
  },
};

export interface PlanInput {
  /** Active power scheme GUID (null if undetectable). */
  powerSchemeGuid: string | null;
  /** Names of currently loaded Ollama models. */
  loadedModels: string[];
  /** Scheme GUID saved by a previous LIGHT transition (restore target). */
  savedPerfSchemeGuid: string | null;
  /** Whether --preload was requested (max mode only). */
  preload: boolean;
}

export interface PlannedAction {
  kind: "power-scheme" | "ollama-unload" | "ollama-preload" | "state" | "note";
  label: string;
  /** Disruptive actions require confirmation (or --yes). */
  disruptive: boolean;
  /** Kind-specific payload (scheme GUID, model name). */
  target?: string;
}

export interface PerfPlan {
  mode: PcMode;
  actions: PlannedAction[];
  notes: string[];
}

export function buildPerfPlan(mode: PcMode, input: PlanInput): PerfPlan {
  const meta = MODE_META[mode];
  const actions: PlannedAction[] = [];
  const notes: string[] = [];

  // ── Power scheme ─────────────────────────────────────────────────
  if (mode === "light") {
    if (input.powerSchemeGuid && input.powerSchemeGuid.toLowerCase() !== BALANCED_GUID) {
      actions.push({
        kind: "power-scheme",
        label: `Power scheme → Balanced (current GUID ${input.powerSchemeGuid} is saved for restore)`,
        disruptive: false,
        target: BALANCED_GUID,
      });
    } else {
      notes.push(input.powerSchemeGuid ? "Power scheme already Balanced" : "Power scheme undetectable — skipped");
    }
  } else {
    // dev / max — only intervene when the current scheme is Balanced
    // (i.e. LIGHT was applied). Any other active scheme is already
    // performance-class: restore the exact scheme LIGHT saved, or fall
    // back to stock High Performance.
    const onBalanced = input.powerSchemeGuid?.toLowerCase() === BALANCED_GUID;
    if (onBalanced) {
      const restoreGuid = input.savedPerfSchemeGuid ?? HIGH_PERF_GUID;
      actions.push({
        kind: "power-scheme",
        label: `Power scheme → performance plan (GUID ${restoreGuid})`,
        disruptive: false,
        target: restoreGuid,
      });
    } else {
      notes.push(
        input.powerSchemeGuid
          ? "Power scheme already performance-class — unchanged"
          : "Power scheme undetectable — skipped",
      );
    }
  }

  // ── Ollama ───────────────────────────────────────────────────────
  if (mode === "light") {
    for (const m of input.loadedModels) {
      actions.push({
        kind: "ollama-unload",
        label: `Unload Ollama model '${m}' (reloads automatically on next request)`,
        disruptive: true,
        target: m,
      });
    }
    if (input.loadedModels.length === 0) notes.push("No Ollama model currently loaded");
    notes.push("Keep-alive (5m) continues to auto-unload idle models");
  }

  if (mode === "max") {
    if (input.preload) {
      if (input.loadedModels.includes(meta.preferredModel)) {
        notes.push(`${meta.preferredModel} already loaded`);
      } else {
        actions.push({
          kind: "ollama-preload",
          label: `Preload ${meta.preferredModel} (keep_alive 30m — expect ~8.5GB RAM, ~2GB VRAM)`,
          disruptive: false,
          target: meta.preferredModel,
        });
      }
    } else {
      notes.push("Model loads on first request — pass --preload to warm it now");
    }
  }

  if (mode === "dev") {
    notes.push("Loaded models are left alone — keep-alive manages idle unload");
  }

  // ── Advisory + state ─────────────────────────────────────────────
  notes.push(`Preferred AI tier: ${meta.preferredCtx} (${meta.preferredModel}) — advisory, recorded in pc-mode.json`);
  actions.push({
    kind: "state",
    label: `Record mode '${mode}' in ~/.litt/pc-mode.json`,
    disruptive: false,
  });

  return { mode, actions, notes };
}
