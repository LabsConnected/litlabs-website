/**
 * Honest health states for LiTTree LabStudios services.
 *
 * `healthy`   — service is reachable and working.
 * `degraded`  — service is reachable but impaired (e.g. fallback only).
 * `offline`   — service should be running but is not reachable.
 * `misconfigured` — required configuration/env vars are missing.
 */

export type ServiceStatus =
  | "healthy"
  | "degraded"
  | "offline"
  | "misconfigured";

export type HealthCheck = {
  name: string;
  status: ServiceStatus;
  message: string;
  latencyMs?: number;
};

export type StudioHealthResponse = {
  status: ServiceStatus;
  ready: boolean;
  checks: HealthCheck[];
  timestamp: string;
};

export type WorkerHeartbeat = {
  worker_id: string;
  status: ServiceStatus;
  current_task_id?: string | null;
  last_seen_at: string;
  metadata: Record<string, unknown>;
};
