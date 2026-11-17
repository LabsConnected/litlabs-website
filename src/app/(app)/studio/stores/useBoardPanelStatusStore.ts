"use client";

/**
 * Board panel status store (Kimi wiring item 2, 2026-11-15).
 *
 * Kimmy's PanelFrame carried a live status dot in every panel header,
 * each dot derived from that panel's OWN status source (preview stage,
 * terminal connection, checks result, deploy state). The real board's
 * panels each own their real status state locally, so this store is the
 * narrow bridge: a bound panel PUBLISHES the status it already computes
 * (no new data, no blended aggregate), and StudioBoard reads it to
 * render the header dot on BoardPanel's chrome.
 *
 * Statuses stay separate per panel on purpose — the finish spec demands
 * specific states, never one vague READY. A panel that has published
 * nothing renders no dot (unknown is shown as unknown, not as ok).
 */

import { create } from "zustand";
import type { BoardPanelId } from "../components/board/board-types";

export type BoardPanelStatusTone = "ready" | "working" | "error" | "live" | "idle";

export interface BoardPanelStatus {
  tone: BoardPanelStatusTone;
  /** Plain-language state, e.g. "Preview ready", "2 checks failed". */
  label: string;
  /** Pulse the dot — in-progress states only. */
  pulse?: boolean;
  /**
   * Optional count badge (Kimi wiring item 11): the panel's own real
   * count — failed checks on Checks, changed files on Files — shown
   * beside the status dot in the board toolbar. Absent = no badge;
   * publishers only set it from data they actually hold.
   */
  badge?: number;
}

/** Dot color per tone — the same status palette the Preview panel's
 *  STATUS_DOT_COLOR already uses (green ready, amber working, red
 *  failed, gray idle), so the board reads consistently everywhere. */
export const BOARD_PANEL_STATUS_COLORS: Record<BoardPanelStatusTone, string> = {
  ready: "#48EE38",
  live: "#48EE38",
  working: "#e3b341",
  error: "#EF4444",
  idle: "#6b7280",
};

interface BoardPanelStatusState {
  statuses: Partial<Record<BoardPanelId, BoardPanelStatus>>;
  /** Publish (or clear, with null) one panel's status. No-ops when the
   *  status is unchanged so publishers can call it from effects without
   *  render-looping the board. */
  setPanelStatus: (id: BoardPanelId, status: BoardPanelStatus | null) => void;
}

export const useBoardPanelStatusStore = create<BoardPanelStatusState>((set, get) => ({
  statuses: {},
  setPanelStatus: (id, status) => {
    const current = get().statuses[id] ?? null;
    if (
      current === status ||
      (current !== null &&
        status !== null &&
        current.tone === status.tone &&
        current.label === status.label &&
        current.badge === status.badge &&
        Boolean(current.pulse) === Boolean(status.pulse))
    ) {
      return;
    }
    set((state) => {
      const next = { ...state.statuses };
      if (status === null) delete next[id];
      else next[id] = status;
      return { statuses: next };
    });
  },
}));
