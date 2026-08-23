"use client";

import { useEffect, useState } from "react";

type HealthState = "loading" | "ok" | "degraded" | "down";

/**
 * FooterSystemStatus — shows real system status derived from /api/health.
 * Replaces the previous hardcoded "System status: Operational" text.
 * Never claims "Operational" without verifying.
 */
export function FooterSystemStatus() {
  const [state, setState] = useState<HealthState>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { status?: string }) => {
        if (cancelled) return;
        if (data.status === "ok") setState("ok");
        else if (data.status === "degraded") setState("degraded");
        else setState("down");
      })
      .catch(() => {
        if (!cancelled) setState("down");
      });
    return () => { cancelled = true; };
  }, []);

  const dotColor =
    state === "ok" ? "bg-emerald-400" :
    state === "degraded" ? "bg-amber-400" :
    state === "down" ? "bg-red-400" :
    "bg-neutral-600";

  const label =
    state === "ok" ? "All systems operational" :
    state === "degraded" ? "Some systems degraded" :
    state === "down" ? "Systems offline" :
    "Checking status…";

  return (
    <div className="flex items-center gap-2 font-mono text-neutral-600">
      <span className={`h-1.5 w-1.5 rounded-full ${dotColor} ${state === "loading" ? "animate-pulse" : ""}`} />
      {label}
    </div>
  );
}
