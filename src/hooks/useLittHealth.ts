"use client";

/**
 * useLittHealth — truthful LiTT runtime health status.
 *
 * Replaces the hardcoded "LiTT Online" indicator with a real health
 * check. Polls /api/health every 60s and derives one of:
 *   - "ready"    : runtime is reachable and healthy
 *   - "working"  : runtime is reachable but degraded (some providers down)
 *   - "degraded" : runtime is reachable but multiple providers down
 *   - "offline"  : runtime is unreachable
 *   - "unknown"  : haven't checked yet (initial state)
 *
 * Never fakes "online". If the health check fails, shows "offline".
 */

import { useEffect, useState } from "react";

export type LittHealthStatus = "ready" | "working" | "degraded" | "offline" | "unknown";

export interface LittHealth {
  status: LittHealthStatus;
  label: string;
  color: string;
  pulse: boolean;
}

const HEALTH_MAP: Record<LittHealthStatus, Omit<LittHealth, "status">> = {
  ready: { label: "LiTT Ready", color: "#34d399", pulse: false },
  working: { label: "LiTT Working", color: "#60a5fa", pulse: true },
  degraded: { label: "LiTT Degraded", color: "#fbbf24", pulse: true },
  offline: { label: "LiTT Offline", color: "#f87171", pulse: false },
  unknown: { label: "LiTT…", color: "#9ca3af", pulse: false },
};

export function useLittHealth(): LittHealth {
  const [status, setStatus] = useState<LittHealthStatus>("unknown");

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const check = async () => {
      try {
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!active) return;
        if (!res.ok) {
          setStatus("offline");
          return;
        }
        const data = await res.json().catch(() => ({}));
        // Derive status from health response
        // If the API reports a status field, use it
        if (data.status === "ok" || data.status === "healthy") {
          setStatus("ready");
        } else if (data.status === "degraded") {
          setStatus("degraded");
        } else if (data.status === "working") {
          setStatus("working");
        } else if (data.healthy === false) {
          setStatus("offline");
        } else {
          // Default to ready if the endpoint responded OK
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("offline");
      }
    };

    void check();
    timer = setInterval(check, 60_000);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  return { status, ...HEALTH_MAP[status] };
}
