// src/hooks/use-music-generation.ts
"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { GenerationStatus } from "@/types/music";

interface GenerationTrackPreview {
  id: string;
  title: string;
  versionLabel: string;
  duration: number;
  visibility: "private" | "unlisted" | "public";
}

interface GenerationState {
  generationId: string | null;
  status: GenerationStatus;
  progress: number;
  error: string | null;
  lbcCharged: number;
  lbcRefunded: boolean;
  tracks: GenerationTrackPreview[];
}

const PROGRESS_MAP: Record<GenerationStatus, number> = {
  queued: 5,
  preparing: 15,
  generating: 50,
  processing: 80,
  completed: 100,
  failed: 0,
  cancelled: 0,
};

const TERMINAL: GenerationStatus[] = ["completed", "failed", "cancelled"];

export interface StartParams {
  prompt: string;
  instrumental: boolean;
  duration: "concept" | "full";
  vocalType?: string;
  explicit?: boolean;
  lyrics?: string;
  energy?: number;
}

export function useMusicGeneration() {
  const [state, setState] = useState<GenerationState>({
    generationId: null,
    status: "queued",
    progress: 0,
    error: null,
    lbcCharged: 0,
    lbcRefunded: false,
    tracks: [],
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(
    async (generationId: string, { silent = false } = {}) => {
      try {
        const res = await fetch(`/api/music/generations/${generationId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!silent) {
            const data = await res.json().catch(() => ({}));
            setState((prev) => ({
              ...prev,
              error: data.error || "Failed to fetch status",
            }));
          }
          return;
        }
        const data = await res.json();
        const status = data.status as GenerationStatus;
        setState((prev) => ({
          ...prev,
          generationId,
          status,
          progress: PROGRESS_MAP[status] ?? prev.progress,
          error: data.error || null,
          lbcCharged: data.lbcCharged ?? prev.lbcCharged,
          lbcRefunded: data.lbcRefunded ?? prev.lbcRefunded,
          tracks: data.tracks ?? prev.tracks,
        }));

        if (TERMINAL.includes(status)) {
          clearPoll();
          setIsGenerating(false);
        }
      } catch {
        // network error — keep polling, don't surface noise
      }
    },
    [clearPoll],
  );

  const startGeneration = useCallback(
    async (params: StartParams) => {
      clearPoll();
      setIsGenerating(true);
      setState({
        generationId: null,
        status: "queued",
        progress: 0,
        error: null,
        lbcCharged: 0,
        lbcRefunded: false,
        tracks: [],
      });

      const idempotencyKey = `gen-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      try {
        const res = await fetch("/api/music/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ...params, idempotencyKey }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Generation failed");
        }

        setState((prev) => ({
          ...prev,
          generationId: data.generationId,
          status: data.status,
          lbcCharged: data.lbcCharged ?? 0,
        }));

        // Persist so a page refresh can resume polling.
        try {
          sessionStorage.setItem(
            "littree:music:active-generation",
            data.generationId,
          );
        } catch {
          // sessionStorage unavailable
        }

        pollRef.current = setInterval(() => {
          void pollStatus(data.generationId);
        }, 3000);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Generation failed",
          status: "failed",
        }));
        setIsGenerating(false);
      }
    },
    [clearPoll, pollStatus],
  );

  const cancelGeneration = useCallback(async () => {
    setState((prev) => {
      if (!prev.generationId) return prev;
      void fetch(
        `/api/music/generations/${prev.generationId}/cancel`,
        { method: "POST", credentials: "include" },
      ).catch(() => {});
      return { ...prev, status: "cancelled", progress: 0 };
    });
    clearPoll();
    setIsGenerating(false);
    try {
      sessionStorage.removeItem("littree:music:active-generation");
    } catch {
      // ignore
    }
  }, [clearPoll]);

  // ── Persistent recovery: resume polling an active generation after refresh ──
  useEffect(() => {
    let activeId: string | null = null;
    try {
      activeId = sessionStorage.getItem("littree:music:active-generation");
    } catch {
      return;
    }
    if (!activeId) return;

    setIsGenerating(true);
    // Immediate poll to sync state, then start interval if still active.
    void pollStatus(activeId, { silent: true }).then(() => {
      setState((prev) => {
        if (prev.generationId === activeId && !TERMINAL.includes(prev.status)) {
          pollRef.current = setInterval(() => {
            void pollStatus(activeId!, { silent: true });
          }, 3000);
        } else if (prev.generationId === activeId && TERMINAL.includes(prev.status)) {
          setIsGenerating(false);
          try {
            sessionStorage.removeItem("littree:music:active-generation");
          } catch {
            // ignore
          }
        }
        return prev;
      });
    });

    return () => clearPoll();
  }, [pollStatus, clearPoll]);

  useEffect(() => () => clearPoll(), [clearPoll]);

  return {
    ...state,
    isGenerating,
    startGeneration,
    cancelGeneration,
  };
}
