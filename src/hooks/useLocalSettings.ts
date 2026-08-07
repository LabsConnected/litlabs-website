"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * Persistent localStorage-backed settings hook.
 *
 * Same pattern the Workspace and Agents sections already use, but
 * generalised so every settings section can have real, working toggles
 * instead of no-op placeholders.
 *
 * Usage:
 *   const [settings, update, reset] = useLocalSettings("automation", defaults);
 *   <ToggleRow checked={settings.autoRunTests} onChange={(v) => update("autoRunTests", v)} />
 */

const STORAGE_PREFIX = "litlabs:settings:";

export function useLocalSettings<T extends Record<string, unknown>>(
  namespace: string,
  defaults: T,
): [T, <K extends keyof T>(key: K, value: T[K]) => void, () => void] {
  const storageKey = STORAGE_PREFIX + namespace;

  const [settings, setSettings] = useState<T>(defaults);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<T>;
        setSettings({ ...defaults, ...parsed });
      }
    } catch {
      // ignore parse errors
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist on every change
  const update = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // non-fatal
        }
        return next;
      });
    },
    [storageKey],
  );

  const reset = useCallback(() => {
    setSettings(defaults);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // non-fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  return [settings, update, reset];
}
