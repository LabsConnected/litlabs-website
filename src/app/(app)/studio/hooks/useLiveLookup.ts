"use client";

/**
 * useLiveLookup — posts a query to /api/studio/lookup and exposes the
 * real, sourced result (or an honest error) to the Browser panel.
 * Request/response, not polling — there is no job to track.
 */
import { useCallback, useState } from "react";

export interface LiveLookupResult {
  formatted: string;
  source: string | null;
}

interface LookupApiResponse {
  success: boolean;
  formatted?: string;
  source?: string | null;
  error?: string;
}

export function useLiveLookup() {
  const [result, setResult] = useState<LiveLookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch("/api/studio/lookup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });
      // Parse defensively: a non-JSON error response (e.g. a 502 HTML
      // page) must not leak a raw parser error into the UI.
      const data = (await resp.json().catch(() => null)) as LookupApiResponse | null;

      if (!resp.ok || !data || !data.success) {
        setError(data?.error ?? "That lookup failed.");
        return;
      }

      setResult({ formatted: data.formatted ?? "", source: data.source ?? null });
    } catch {
      setError("That lookup failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, search };
}
