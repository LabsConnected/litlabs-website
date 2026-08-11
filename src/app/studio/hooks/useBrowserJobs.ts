"use client";

/**
 * useBrowserJobs — polls the browser jobs API and exposes
 * live job state to Studio components.
 *
 * Polling strategy:
 *   - When active jobs exist (queued/running/awaiting_approval): poll every 2s
 *   - When only terminal jobs exist: poll every 15s (catch new jobs)
 *   - Selected job: poll every 1.5s for fine-grained progress
 *   - Auto-stops when unmounted
 *
 * The hook also exposes cancel and approve actions that hit the
 * existing /api/browser/jobs/[id] endpoints.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface BrowserJobStep {
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  detail?: string;
}

export interface BrowserJobProgress {
  step: number;
  totalSteps: number;
  steps: BrowserJobStep[];
}

export interface BrowserJob {
  jobId: string;
  jobType: string;
  goal: string | null;
  riskLevel: "low" | "medium" | "high";
  requestedBy: "vapi" | "studio" | "cron" | "admin";
  status: "queued" | "running" | "awaiting_approval" | "approved" | "completed" | "failed" | "cancelled";
  params: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  progress: BrowserJobProgress;
  browserSessionId: string | null;
  liveViewUrl: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const ACTIVE_STATUSES = new Set(["queued", "running", "awaiting_approval", "approved"]);
const LIST_POLL_ACTIVE_MS = 2000;
const LIST_POLL_IDLE_MS = 15000;
const DETAIL_POLL_MS = 1500;

function hasActiveJobs(jobs: BrowserJob[]): boolean {
  return jobs.some((j) => ACTIVE_STATUSES.has(j.status));
}

export interface UseBrowserJobsResult {
  jobs: BrowserJob[];
  selectedJob: BrowserJob | null;
  selectedJobId: string | null;
  loading: boolean;
  error: string | null;
  activeCount: number;
  selectJob: (jobId: string | null) => void;
  refresh: () => void;
  cancelJob: (jobId: string) => Promise<boolean>;
  approveJob: (jobId: string) => Promise<boolean>;
}

export function useBrowserJobs(): UseBrowserJobsResult {
  const [jobs, setJobs] = useState<BrowserJob[]>([]);
  const [selectedJob, setSelectedJob] = useState<BrowserJob | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef(0);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/browser/jobs?limit=20", { credentials: "same-origin" });
      if (!res.ok) {
        if (res.status === 401) {
          setError("Unauthorized");
        } else {
          setError(`Failed to load jobs (${res.status})`);
        }
        return;
      }
      const data = await res.json() as { jobs: BrowserJob[] };
      setJobs(data.jobs ?? []);
      setError(null);
    } catch {
      setError("Network error loading browser jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSelectedJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/browser/jobs/${jobId}`, { credentials: "same-origin" });
      if (!res.ok) return;
      const data = await res.json() as { job: BrowserJob };
      if (data.job) setSelectedJob(data.job);
    } catch {
      // Silent — polling will retry
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // List polling — adaptive interval based on active jobs
  useEffect(() => {
    const active = hasActiveJobs(jobs);
    const interval = active ? LIST_POLL_ACTIVE_MS : LIST_POLL_IDLE_MS;
    const timer = setInterval(() => {
      fetchJobs();
      // Also bump the refresh counter to trigger selected-job polling
      refreshRef.current++;
    }, interval);
    return () => clearInterval(timer);
  }, [jobs, fetchJobs]);

  // Selected job polling — faster interval for fine-grained progress
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }

    // Fetch immediately on selection
    fetchSelectedJob(selectedJobId);

    const timer = setInterval(() => {
      fetchSelectedJob(selectedJobId);
    }, DETAIL_POLL_MS);

    return () => clearInterval(timer);
  }, [selectedJobId, fetchSelectedJob]);

  // Auto-select the most recent active job if nothing is selected
  useEffect(() => {
    if (!selectedJobId && jobs.length > 0) {
      const active = jobs.find((j) => ACTIVE_STATUSES.has(j.status));
      if (active) {
        setSelectedJobId(active.jobId);
      }
    }
  }, [jobs, selectedJobId]);

  // When the selected job becomes terminal, we keep showing it (no auto-deselect).
  // The selected-job polling effect continues at idle rate, which is fine.

  const selectJob = useCallback((jobId: string | null) => {
    setSelectedJobId(jobId);
    if (!jobId) setSelectedJob(null);
  }, []);

  const refresh = useCallback(() => {
    fetchJobs();
    if (selectedJobId) fetchSelectedJob(selectedJobId);
  }, [fetchJobs, fetchSelectedJob, selectedJobId]);

  const cancelJob = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/browser/jobs/${jobId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      await fetchJobs();
      if (selectedJobId === jobId) await fetchSelectedJob(jobId);
      return true;
    } catch {
      return false;
    }
  }, [fetchJobs, fetchSelectedJob, selectedJobId]);

  const approveJob = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/browser/jobs/${jobId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      await fetchJobs();
      if (selectedJobId === jobId) await fetchSelectedJob(jobId);
      return true;
    } catch {
      return false;
    }
  }, [fetchJobs, fetchSelectedJob, selectedJobId]);

  const activeCount = jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length;

  return {
    jobs,
    selectedJob,
    selectedJobId,
    loading,
    error,
    activeCount,
    selectJob,
    refresh,
    cancelJob,
    approveJob,
  };
}
