"use client";

import { useCallback, useEffect, useState } from "react";
import type { CapabilitySummary, CapabilityStatus } from "@/lib/capabilities/types";

const EMPTY_SUMMARY: CapabilitySummary = {
  capabilities: [],
  readiness: [],
};

export function useCapabilities() {
  const [summary, setSummary] = useState<CapabilitySummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/capabilities", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as CapabilitySummary;
        setSummary(data);
      }
    } catch {
      // non-fatal — leave previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { summary, loading, refresh };
}

export type { CapabilityStatus };
