"use client";

/**
 * useStudioLayoutMode — the crossbreed switch's brain (spec
 * Amendment 8, Larry 2026-11-17): Studio offers BOTH layouts — the
 * board (flagship, default) and the regular (classic) layout — with a
 * real, visible toggle, "in case other people don't like it."
 *
 * Resolution order for the effective mode:
 *   1. The explicit choice persisted in useBoardSettingsStore
 *      (`layoutMode`), set by the header switch or the Board Settings
 *      menu. Once a user flips the switch, this always wins.
 *   2. The pre-switch escape hatch: localStorage
 *      `litt:studio:layout-mode` === "classic" (PR #988's hidden pref,
 *      read once at mount — the exact read CommandStudio always did,
 *      so existing users and tests keep their behavior).
 *   3. "board".
 *
 * Flipping the switch writes BOTH stores: the settings store (the
 * durable explicit choice) and the legacy key (kept in sync so the
 * two can never disagree for any other reader).
 */

import { useCallback, useState } from "react";
import {
  useBoardSettingsStore,
  type StudioLayoutMode,
} from "./useBoardSettingsStore";

export const STUDIO_LAYOUT_MODE_LEGACY_KEY = "litt:studio:layout-mode";

/** The pre-switch escape-hatch read — true only for an explicit
 *  "classic" value; anything else (missing, "board", garbage) is not
 *  an override. Storage failures read as no override. */
export function readLegacyClassicOverride(): boolean {
  try {
    return window.localStorage.getItem(STUDIO_LAYOUT_MODE_LEGACY_KEY) === "classic";
  } catch {
    return false;
  }
}

/** Pure resolution, exported for tests and hook-free readers. */
export function resolveStudioLayoutMode(
  chosen: StudioLayoutMode | null,
  legacyClassic: boolean,
): StudioLayoutMode {
  if (chosen === "board" || chosen === "classic") return chosen;
  return legacyClassic ? "classic" : "board";
}

export interface StudioLayoutModeState {
  /** The effective mode to render. */
  layoutMode: StudioLayoutMode;
  /** The persisted explicit choice (null = the user never flipped
   *  the switch; the effective mode came from the legacy key or the
   *  board default). */
  layoutModeChosen: StudioLayoutMode | null;
  /** Flip the switch: persists the explicit choice and keeps the
   *  legacy key in sync. */
  setLayoutMode: (mode: StudioLayoutMode) => void;
}

export function useStudioLayoutMode(): StudioLayoutModeState {
  const chosen = useBoardSettingsStore((s) => s.layoutMode);
  const setChosen = useBoardSettingsStore((s) => s.setLayoutMode);
  // Read once at mount, exactly like the escape hatch always was —
  // a mid-session external write to the legacy key does not yank the
  // layout out from under the user.
  const [legacyClassic] = useState(readLegacyClassicOverride);

  const setLayoutMode = useCallback(
    (mode: StudioLayoutMode) => {
      setChosen(mode);
      try {
        if (mode === "classic") {
          window.localStorage.setItem(STUDIO_LAYOUT_MODE_LEGACY_KEY, "classic");
        } else {
          window.localStorage.removeItem(STUDIO_LAYOUT_MODE_LEGACY_KEY);
        }
      } catch {
        // Storage unavailable — the settings store still holds the
        // choice for this session and persists when it can.
      }
    },
    [setChosen],
  );

  return {
    layoutMode: resolveStudioLayoutMode(chosen, legacyClassic),
    layoutModeChosen: chosen,
    setLayoutMode,
  };
}
