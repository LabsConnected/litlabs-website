"use client";

import { useCallback, useEffect, useState } from "react";
import { latestRunCheckpoints, type CheckpointLike } from "@/lib/studio/checkpoint-pairs";
import { useExecutionStore } from "../stores/useExecutionStore";

interface ApiCheckpoint {
  id: string;
  label: string;
  gitSha: string;
  createdAt: string;
}

export interface RunCheckpoints {
  before: CheckpointLike | null;
  after: CheckpointLike | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * The latest run's persisted checkpoints (before/after), loaded from the
 * server so they survive a refresh. Also hydrates the execution store so
 * the Mission card's Restore works after a reload, not only mid-session.
 */
export function useRunCheckpoints(projectId: string | null, refreshKey: unknown): RunCheckpoints {
  const [state, setState] = useState<Omit<RunCheckpoints, "reload">>({
    before: null,
    after: null,
    loading: false,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setState({ before: null, after: null, loading: false, error: null });
      return;
    }
    if (typeof fetch !== "function") return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checkpoints`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Checkpoints unavailable (${res.status})`);
        const data = (await res.json()) as { checkpoints?: ApiCheckpoint[] };
        const pair = latestRunCheckpoints(data.checkpoints ?? []);
        if (cancelled) return;
        setState({ ...pair, loading: false, error: null });
        useExecutionStore.getState().hydrateCheckpoints({
          before: pair.before ? { label: pair.before.label, gitSha: pair.before.gitSha } : null,
          after: pair.after ? { label: pair.after.label, gitSha: pair.after.gitSha } : null,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Checkpoints unavailable" }));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, nonce]);

  return { ...state, reload };
}
