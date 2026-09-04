/**
 * First-party funnel analytics — consent-aware.
 *
 * Tracks key customer journey events without any third-party scripts.
 * Events are queued in memory and sent to /api/analytics/event via
 * sendBeacon (non-blocking, survives page unload).
 *
 * GDPR: No events are sent until the user consents to "analytics".
 * If no consent record exists, events are silently dropped.
 */

import { hasConsent } from "@/lib/cookie-consent";

export type FunnelEvent =
  | "homepage_view"
  | "signup_started"
  | "signup_completed"
  | "project_created"
  | "project_selected"
  | "studio_opened"
  | "first_successful_prompt"
  | "pricing_viewed"
  | "checkout_started"
  | "checkout_completed"
  | "plan_activated"
  | "returning_user";

interface AnalyticsEvent {
  event: FunnelEvent;
  ts: number;
  path: string;
  referrer?: string;
  [key: string]: unknown;
}

const QUEUE: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, 2000);
}

async function flush(): Promise<void> {
  if (QUEUE.length === 0) return;
  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify({ events: batch })], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/analytics/event", blob);
    } else if (typeof fetch !== "undefined") {
      await fetch("/api/analytics/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
    }
  } catch {
    // Non-fatal — analytics is best-effort
  }
}

/**
 * Track a funnel event. Respects consent: if the user has not consented
 * to "analytics", the event is silently dropped.
 *
 * Never pass sensitive data (prompt contents, API keys, PII) as properties.
 */
export function track(event: FunnelEvent, properties?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  if (!hasConsent("analytics")) return;

  const entry: AnalyticsEvent = {
    event,
    ts: Date.now(),
    path: window.location.pathname,
    referrer: document.referrer || undefined,
    ...properties,
  };

  QUEUE.push(entry);
  scheduleFlush();
}

/**
 * Flush pending events immediately (e.g., on page unload).
 */
export function flushAnalytics(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  void flush();
}

/**
 * Track a page view. Called by the PageView component on route changes.
 */
export function trackPageView(path?: string): void {
  track("homepage_view", { path: path ?? (typeof window !== "undefined" ? window.location.pathname : "/") });
}
