"use client";

/**
 * LiTT Base Station — `useStationLayout` hook.
 *
 * Hydrates the station store from Supabase (if signed in) and from
 * localStorage (as a fallback / offline cache), and saves changes back to
 * both. The Supabase row lives in `agent_station_layouts` (RLS scoped to
 * the Clerk user_id). Phase 2 created the table; this hook is the client-
 * side reader/writer.
 *
 * On `sign-in` change, the layout is refetched. On every `patchStation`
 * call the localStorage mirror is updated; the Supabase write is debounced
 * (every 1.5s of inactivity) to avoid spamming the table while dragging
 * agents around the canvas.
 */

import { useEffect, useRef, useState } from "react";
import {
  getStationSnapshot,
  loadFromLocalStorage,
  patchStation,
  saveToLocalStorage,
  useStationStore,
  type StationLayout,
} from "../store/stationStore";

const SUPABASE_SAVE_DEBOUNCE_MS = 1500;
const SUPABASE_ENDPOINT = "/api/agents/station-layout";

interface PersistResponse {
  layout: StationLayout;
  serverVersion: number;
}

async function fetchRemoteLayout(): Promise<StationLayout | null> {
  try {
    const res = await fetch(SUPABASE_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as PersistResponse;
    return data.layout ?? null;
  } catch {
    return null;
  }
}

async function pushRemoteLayout(layout: StationLayout): Promise<number | null> {
  try {
    const res = await fetch(SUPABASE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ layout, version: layout.version }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PersistResponse;
    return data.serverVersion ?? null;
  } catch {
    return null;
  }
}

export function useStationLayout() {
  const layout = useStationStore();
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedVersion = useRef<number>(layout.version);

  // Initial hydration: localStorage first (fast), then Supabase (authoritative).
  useEffect(() => {
    loadFromLocalStorage();
    let cancelled = false;
    void (async () => {
      const remote = await fetchRemoteLayout();
      if (!cancelled && remote) {
        // Optimistic-concurrency: only accept the remote version if the local
        // layout is still at the version we left it (i.e. user hasn't dragged
        // anything in the meantime). For now, we trust the remote.
        patchStation(remote);
        lastSavedVersion.current = remote.version;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced remote write on every change. Also drives the `saving` state
  // that consumers render (a "Saving…" pill in the StationSettings panel).
  useEffect(() => {
    if (layout.version === lastSavedVersion.current) return;
    // Always write to localStorage immediately (cheap).
    saveToLocalStorage();
    setSaving(true);
    // Debounce the Supabase round-trip.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        const snapshot = getStationSnapshot();
        const serverVersion = await pushRemoteLayout(snapshot);
        if (serverVersion !== null) {
          lastSavedVersion.current = serverVersion;
        }
        setSaving(false);
      })();
    }, SUPABASE_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [layout.version, layout]);

  return { layout, saving };
}
