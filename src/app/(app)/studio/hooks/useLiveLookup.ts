"use client";

/**
 * useLiveLookup — posts a query to /api/studio/lookup and exposes the
 * real, sourced result (or an honest error) to the Browser panel.
 * Request/response, not polling — there is no job to track.
 *
 * Cancellation: a new search aborts any in-flight one (the common
 * "latest wins" pattern), and `cancel()` lets the user abort explicitly.
 * Either way the abort is not a provider failure — it must never surface
 * as "That lookup failed.". The requestIdRef guard discards any response
 * (success or error) that arrives after a newer search has already
 * started, so a slow aborted request can't clobber fresher state.
 */
import { useCallback, useRef, useState } from "react";

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
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const search = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const resp = await fetch("/api/studio/lookup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
        signal: controller.signal,
      });
      // Parse defensively: a non-JSON error response (e.g. a 502 HTML
      // page) must not leak a raw parser error into the UI.
      const data = (await resp.json().catch(() => null)) as LookupApiResponse | null;
      if (requestIdRef.current !== requestId) return; // superseded — discard

      if (!resp.ok || !data || !data.success) {
        setError(data?.error ?? "That lookup failed.");
        return;
      }

      setResult({ formatted: data.formatted ?? "", source: data.source ?? null });
    } catch (err) {
      if (requestIdRef.current !== requestId) return; // superseded — discard
      if (err instanceof DOMException && err.name === "AbortError") {
        // Cancelled — honest silence, never a fabricated provider error.
        return;
      }
      setError("That lookup failed.");
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, []);

  const cancel = useCallback(() => {
    // Invalidate the in-flight request unconditionally — some runtimes
    // (and Playwright's network mocking) can resolve a fetch even after
    // its AbortSignal fires, so the requestId guard is the one thing
    // that reliably stops a cancelled response from ever rendering.
    requestIdRef.current += 1;
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  return { result, loading, error, search, cancel };
}
