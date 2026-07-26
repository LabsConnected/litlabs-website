"use client";

import { useCallback, useEffect, useState } from "react";
import type { IntegrationStatusResponse } from "@/lib/integrations/types";

const FALLBACK: IntegrationStatusResponse = {
  integrations: [],
  summary: {
    platformReady: 0,
    platformNeedsConfig: 0,
    optional: 0,
    userConnected: 0,
    userNotConnected: 0,
    workspaceReady: 0,
  },
};

export function useIntegrationStatus() {
  const [status, setStatus] = useState<IntegrationStatusResponse>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/status", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: IntegrationStatusResponse = await res.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load status";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { status, loading, error, refresh };
}
