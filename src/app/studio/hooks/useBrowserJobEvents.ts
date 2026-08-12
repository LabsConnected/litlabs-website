"use client";

/**
 * useBrowserJobEvents — subscribes to the SSE event stream for a
 * browser job and exposes a live event log to Studio components.
 *
 * Uses the native EventSource API. Automatically reconnects on
 * disconnection with a cursor (last event ID) so no events are
 * lost. Closes the connection when the job reaches a terminal state
 * or the component unmounts.
 *
 * Fallback: if EventSource is not available (older browsers, SSR),
 * the hook falls back to polling GET /api/browser/jobs/[id]/events.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface AgentJobEvent {
  id: string;
  jobId: string;
  type:
    | "job.started"
    | "step.started"
    | "observation"
    | "action"
    | "verification"
    | "step.completed"
    | "retry"
    | "approval.required"
    | "job.completed"
    | "job.failed";
  step: number | null;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const TERMINAL_EVENT_TYPES = new Set(["job.completed", "job.failed"]);

export interface UseBrowserJobEventsResult {
  events: AgentJobEvent[];
  connected: boolean;
  error: string | null;
}

export function useBrowserJobEvents(jobId: string | null): UseBrowserJobEventsResult {
  const [events, setEvents] = useState<AgentJobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastEventIdRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setEvents([]);
      setConnected(false);
      setError(null);
      lastEventIdRef.current = null;
      return;
    }

    // Reset state when job changes
    setEvents([]);
    setError(null);
    lastEventIdRef.current = null;

    // Check if EventSource is available
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      // Fallback: no streaming available
      setError("EventSource not supported");
      return;
    }

    // Build SSE URL with cursor if we have one
    const buildUrl = () => {
      const base = `/api/browser/jobs/${jobId}/events`;
      if (lastEventIdRef.current) {
        return `${base}?since=${encodeURIComponent(lastEventIdRef.current)}`;
      }
      return base;
    };

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;
    let closed = false;

    const connect = () => {
      if (closed) return;

      const es = new EventSource(buildUrl());
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
        reconnectDelay = 1000; // reset backoff
      };

      // Listen for all event types we care about
      const eventTypes = [
        "job.started",
        "step.started",
        "observation",
        "action",
        "verification",
        "step.completed",
        "retry",
        "approval.required",
        "job.completed",
        "job.failed",
      ];

      for (const type of eventTypes) {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            const event = JSON.parse(e.data) as AgentJobEvent;
            lastEventIdRef.current = event.id;
            setEvents((prev) => {
              // Deduplicate by event ID
              if (prev.some((p) => p.id === event.id)) return prev;
              return [...prev, event];
            });

            // Close on terminal events
            if (TERMINAL_EVENT_TYPES.has(event.type)) {
              es.close();
              setConnected(false);
            }
          } catch {
            // Ignore parse errors
          }
        });
      }

      // Stream end event (server closes the connection)
      es.addEventListener("stream.end", () => {
        es.close();
        setConnected(false);
      });

      es.onerror = () => {
        setConnected(false);
        es.close();

        if (closed) return;

        // Exponential backoff reconnect (max 10s)
        reconnectDelay = Math.min(reconnectDelay * 2, 10000);
        reconnectTimer = setTimeout(connect, reconnectDelay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setConnected(false);
    };
  }, [jobId]);

  return { events, connected, error };
}
