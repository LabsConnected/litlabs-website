"use client";

import { useEffect, useState, useCallback } from "react";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import type { RunEvent } from "@/lib/litt-intelligence/run-events";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { AcceptanceEvidence } from "@/lib/litt-intelligence/acceptance-evidence";
import type { ReviewCheckpoint } from "@/lib/litt-intelligence/review-checkpoint";

interface EvidenceResponse {
  evidence: MutationEvidence[];
  events: RunEvent[];
  checks: CheckEvidence[];
  acceptance: AcceptanceEvidence[];
  reviewCheckpoints: ReviewCheckpoint[];
}

interface UseRunEvidenceOptions {
  projectId: string | null;
  runId?: string | null;
  /** Auto-refresh interval in ms (0 = disabled) */
  pollIntervalMs?: number;
}

interface UseRunEvidenceResult {
  evidence: MutationEvidence[];
  events: RunEvent[];
  checks: CheckEvidence[];
  acceptance: AcceptanceEvidence[];
  reviewCheckpoints: ReviewCheckpoint[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * useRunEvidence — fetches mutation evidence + run events from
 * /api/studio/evidence. One API call, two data sets.
 *
 * The Changes panel reads `evidence`; the Activity panel reads `events`.
 * Both panels share the same data source — no competing state systems.
 *
 * Phase 7 — Studio Control Plane V1
 */
export function useRunEvidence({
  projectId,
  runId,
  pollIntervalMs = 0,
}: UseRunEvidenceOptions): UseRunEvidenceResult {
  const [evidence, setEvidence] = useState<MutationEvidence[]>([]);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [checks, setChecks] = useState<CheckEvidence[]>([]);
  const [acceptance, setAcceptance] = useState<AcceptanceEvidence[]>([]);
  const [reviewCheckpoints, setReviewCheckpoints] = useState<ReviewCheckpoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setEvidence([]);
      setEvents([]);
      setChecks([]);
      setAcceptance([]);
      setReviewCheckpoints([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ projectId });
      if (runId) params.set("runId", runId);

      const res = await fetch(`/api/studio/evidence?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch evidence: ${res.status}`);
      }

      const data: EvidenceResponse = await res.json();
      setEvidence(data.evidence ?? []);
      setEvents(data.events ?? []);
      setChecks(data.checks ?? []);
      setAcceptance(data.acceptance ?? []);
      setReviewCheckpoints(data.reviewCheckpoints ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }, [projectId, runId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Optional polling
  useEffect(() => {
    if (pollIntervalMs <= 0) return;
    const interval = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(interval);
  }, [refresh, pollIntervalMs]);

  return { evidence, events, checks, acceptance, reviewCheckpoints, loading, error, refresh };
}
