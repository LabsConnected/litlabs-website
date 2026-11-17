"use client";

/**
 * Terminal log store (Kimi wiring items 9 + 12) — the one home for the
 * terminal surface's connection/session log lines.
 *
 * The real TerminalPanel emits plain-string log entries through its
 * onLog callback ("[WS] …", "[SESSION] …", "[ERROR] …", "[AUTH] …",
 * "[WORKSPACE] …"). The terminal drawer captures them here so BOTH
 * consumers read the same truth: the drawer's Logs tab and the phone
 * terminal peek strip (the last line, visible while the narrow stack
 * is scrolled elsewhere). Nothing is synthesized — an empty store
 * means the terminal has emitted nothing yet.
 */

import { create } from "zustand";

export type TerminalLogKind = "ws" | "session" | "error" | "auth" | "workspace" | "info";

export interface TerminalLogEntry {
  id: number;
  /** HH:MM:SS, stamped at capture time. */
  time: string;
  kind: TerminalLogKind;
  /** The entry text with its "[KIND]" prefix stripped. */
  text: string;
}

const MAX_ENTRIES = 200;
let nextId = 1;

/** Parse the TerminalPanel's bracket prefix into a display kind. */
export function parseTerminalLogEntry(raw: string, time: string): TerminalLogEntry {
  const match = /^\[(WS|SESSION|ERROR|AUTH|WORKSPACE)\]\s*(.*)$/.exec(raw);
  const kind: TerminalLogKind = match
    ? (match[1].toLowerCase() as TerminalLogKind)
    : "info";
  return { id: nextId++, time, kind, text: match ? match[2] : raw };
}

interface TerminalLogState {
  entries: TerminalLogEntry[];
  append: (raw: string) => void;
  clear: () => void;
}

export const useTerminalLogStore = create<TerminalLogState>((set) => ({
  entries: [],
  append: (raw) =>
    set((state) => {
      const time = new Date().toLocaleTimeString("en-GB");
      const entry = parseTerminalLogEntry(raw, time);
      const entries = [...state.entries, entry];
      return { entries: entries.length > MAX_ENTRIES ? entries.slice(entries.length - MAX_ENTRIES) : entries };
    }),
  clear: () => set({ entries: [] }),
}));

/** Display color per log kind (board palette; error red is a status color). */
export const TERMINAL_LOG_KIND_COLORS: Record<TerminalLogKind, string> = {
  error: "#EF4444",
  session: "#48EE38",
  workspace: "#e3b341",
  ws: "#8a8f98",
  auth: "#8a8f98",
  info: "#8a8f98",
};
