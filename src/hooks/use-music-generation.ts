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
  cancelRequestedAt: string | null;
  tracks: GenerationTrackPreview[];
}

const PROGRESS_MAP: Record<GenerationStatus, number> = {
  idle: 0,
  queued: 5,
  claimed: 10,
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
    status: "idle",
    progress: 0,
    error: null,
    lbcCharged: 0,
    lbcRefunded: false,
    cancelRequestedAt: null,
    tracks: [],
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queuedSinceRef = useRef<number | null>(null);
  const workerTriggeredRef = useRef(false);

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
          cancelRequestedAt: data.cancelRequestedAt ?? null,
        }));

        // Stale-job detection: if the job has been in a non-terminal state
        // for >30s without progress, trigger the worker endpoint to resume.
        // This handles the case where the original serverless function was
        // frozen/killed after returning 202. We check both 'queued' AND
        // 'preparing'/'generating'/'processing' because the void processGeneration
        // may have started but been killed mid-execution.
        const activeStaleStates = ["queued", "preparing", "generating", "processing"];
        if (activeStaleStates.includes(status)) {
          if (queuedSinceRef.current === null) {
            queuedSinceRef.current = Date.now();
          } else if (
            Date.now() - queuedSinceRef.current > 30_000 &&
            !workerTriggeredRef.current
          ) {
            workerTriggeredRef.current = true;
            void fetch("/api/music/worker", { method: "POST" }).catch(() => {});
          }
        } else {
          queuedSinceRef.current = null;
          workerTriggeredRef.current = false;
        }

        if (TERMINAL.includes(status)) {
          clearPoll();
          setIsGenerating(false);
          queuedSinceRef.current = null;
          workerTriggeredRef.current = false;
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
      queuedSinceRef.current = null;
      workerTriggeredRef.current = false;
      setState({
        generationId: null,
        status: "queued",
        progress: 0,
        error: null,
        lbcCharged: 0,
        lbcRefunded: false,
        cancelRequestedAt: null,
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

  const [isCancelling, setIsCancelling] = useState(false);

  const cancelGeneration = useCallback(async () => {
    const genId = state.generationId;
    if (!genId) return;

    setIsCancelling(true);
    // Show "Cancelling..." state but do NOT mark as cancelled yet —
    // wait for backend confirmation. The comment below originally said
    // not to mark cancelled, but the very next line DID set status to
    // "cancelled". This is now fixed — we keep the current status
    // and only show the "Cancelling..." UI via isCancelling.

    try {
      const res = await fetch(
        `/api/music/generations/${genId}/cancel`,
        { method: "POST", credentials: "include" },
      );
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        clearPoll();
        setIsGenerating(false);
        setState((prev) => ({
          ...prev,
          status: "cancelled",
          lbcRefunded: data.refunded ?? false,
        }));
      } else {
        // Backend rejected cancel — revert to previous status by re-polling
        await pollStatus(genId);
      }
    } catch {
      // Network error — re-poll to get actual status
      await pollStatus(genId);
    } finally {
      setIsCancelling(false);
      try {
        sessionStorage.removeItem("littree:music:active-generation");
      } catch {
        // ignore
      }
    }
  }, [state.generationId, clearPoll, pollStatus]);

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
    isCancelling,
    startGeneration,
    cancelGeneration,
  };
}
