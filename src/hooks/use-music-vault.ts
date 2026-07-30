// src/hooks/use-music-vault.ts
"use client";

import { useState, useEffect, useCallback } from "react";

export interface VaultTrack {
  id: string;
  title: string;
  version_label: string;
  audio_storage_key: string;
  audioUrl: string | null;
  duration: number | null;
  bpm: number | null;
  musical_key: string | null;
  visibility: "private" | "unlisted" | "public";
  blueprint: {
    genre?: string[];
    mood?: string[];
    instrumental?: boolean;
  } | null;
  provider: string;
  lbc_charged: number;
  created_at: string;
}

export function useMusicVault() {
  const [tracks, setTracks] = useState<VaultTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTracks = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/music/tracks", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch tracks");
      setTracks(data.tracks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tracks");
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTrack = useCallback(
    async (trackId: string, updates: { title?: string; visibility?: string }) => {
      try {
        const res = await fetch(`/api/music/tracks/${trackId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Update failed");
        }
        const { track } = await res.json();
        setTracks((prev) =>
          prev.map((t) => (t.id === trackId ? { ...t, ...track } : t)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Update failed");
      }
    },
    [],
  );

  const deleteTrack = useCallback(async (trackId: string) => {
    try {
      const res = await fetch(`/api/music/tracks/${trackId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  }, []);

  useEffect(() => {
    void fetchTracks();
  }, [fetchTracks]);

  return {
    tracks,
    loading,
    error,
    updateTrack,
    deleteTrack,
    refresh: fetchTracks,
  };
}
