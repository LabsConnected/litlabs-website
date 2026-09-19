/**
 * Per-user agent visibility (hide/disable built-in agents).
 *
 * Spark is a hidden legacy core personality (studioVisible: false) — it never
 * appears in Studio surfaces, so hiding is a no-op for it now. This module
 * stores a per-user `hiddenAgents` list (agent ids) kept for backward
 * compatibility with stored settings; it applies to any agents that support
 * hiding.
 *
 * Storage: localStorage is the source of truth (same key the Settings page
 * uses for agent settings); the value is also POSTed best-effort to
 * /api/settings/agents so it can sync server-side once supported.
 */

import { useCallback, useEffect, useState } from "react";

export const AGENT_SETTINGS_STORAGE_KEY = "litlabs:agent-settings";

const CHANGED_EVENT = "litlabs:hidden-agents-changed";

export function readHiddenAgents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { hiddenAgents?: unknown };
    return Array.isArray(parsed.hiddenAgents)
      ? parsed.hiddenAgents.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function persistHiddenAgents(hiddenAgents: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(AGENT_SETTINGS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(
      AGENT_SETTINGS_STORAGE_KEY,
      JSON.stringify({ ...parsed, hiddenAgents }),
    );
  } catch {
    // Storage failures are non-fatal — the toggle just won't stick.
  }
  // Best-effort server sync (fire-and-forget).
  try {
    void fetch("/api/settings/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hiddenAgents }),
    }).catch(() => {});
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function isAgentHidden(hiddenAgents: string[], agentId: string): boolean {
  return hiddenAgents.includes(agentId);
}

/** Filter a list of items with an `id` field down to the visible ones. */
export function visibleAgents<T extends { id: string }>(
  agents: T[],
  hiddenAgents: string[],
): T[] {
  if (hiddenAgents.length === 0) return agents;
  return agents.filter((a) => !hiddenAgents.includes(a.id));
}

/**
 * React hook for the per-user hidden-agent list.
 * Returns the list plus hide/unhide helpers; stays in sync across components
 * and tabs via a custom event + the native storage event.
 */
export function useHiddenAgents(): {
  hiddenAgents: string[];
  hideAgent: (agentId: string) => void;
  unhideAgent: (agentId: string) => void;
  isHidden: (agentId: string) => boolean;
} {
  const [hiddenAgents, setHiddenAgents] = useState<string[]>(() =>
    readHiddenAgents(),
  );

  useEffect(() => {
    const sync = () => setHiddenAgents(readHiddenAgents());
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    // Re-read on mount in case another component wrote before us.
    sync();
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const hideAgent = useCallback((agentId: string) => {
    setHiddenAgents((prev) => {
      if (prev.includes(agentId)) return prev;
      const next = [...prev, agentId];
      persistHiddenAgents(next);
      return next;
    });
  }, []);

  const unhideAgent = useCallback((agentId: string) => {
    setHiddenAgents((prev) => {
      if (!prev.includes(agentId)) return prev;
      const next = prev.filter((id) => id !== agentId);
      persistHiddenAgents(next);
      return next;
    });
  }, []);

  const isHidden = useCallback(
    (agentId: string) => hiddenAgents.includes(agentId),
    [hiddenAgents],
  );

  return { hiddenAgents, hideAgent, unhideAgent, isHidden };
}
