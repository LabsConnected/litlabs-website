// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  resolveLiveViewAvailability,
  LIVE_VIEW_STALE_AFTER_MS,
  type ResolveLiveViewAvailabilityInput,
} from "./browser-live-view";

/**
 * Agent Browser Phase 6 — the deterministic live-view availability rule.
 *
 * The rule must never show a "live" frame on an assumed basis: every
 * branch below pins an explicit reason so the panel can label its
 * fallback honestly.
 */

const NOW = Date.now();
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - LIVE_VIEW_STALE_AFTER_MS - 60_000).toISOString();

function base(overrides: Partial<ResolveLiveViewAvailabilityInput> = {}) {
  return {
    url: "https://debug.browserbase.com/sessions/abc?fullscreen=1&navbar=false",
    embedUrlKnown: true,
    jobStatus: "running" as const,
    sessionStatus: "active" as const,
    sessionUpdatedAt: FRESH,
    nowMs: NOW,
    ...overrides,
  };
}

describe("resolveLiveViewAvailability", () => {
  it("is live when the embed URL is known, the job runs, and the session is fresh + active", () => {
    expect(resolveLiveViewAvailability(base())).toEqual({
      available: true,
      reason: "live",
    });
  });

  it("is live for paused / human_control sessions (the browser is still running)", () => {
    for (const sessionStatus of ["paused", "human_control", "agent_control"] as const) {
      const r = resolveLiveViewAvailability(base({ sessionStatus }));
      expect(r).toEqual({ available: true, reason: "live" });
    }
  });

  it("is live without a job context (e.g. the chat session chip)", () => {
    const r = resolveLiveViewAvailability(base({ jobStatus: null }));
    expect(r).toEqual({ available: true, reason: "live" });
  });

  it("refuses when there is no URL at all", () => {
    expect(resolveLiveViewAvailability(base({ url: null }))).toEqual({
      available: false,
      reason: "no_live_view_url",
    });
  });

  it("refuses to iframe the dashboard page when the embed URL is unknown", () => {
    // The dashboard page can render a login wall — a broken frame.
    const r = resolveLiveViewAvailability(
      base({ url: "https://www.browserbase.com/sessions/abc", embedUrlKnown: false }),
    );
    expect(r).toEqual({ available: false, reason: "embed_unavailable" });
  });

  it("refuses terminal jobs (completed / failed / cancelled)", () => {
    for (const jobStatus of ["completed", "failed", "cancelled"] as const) {
      const r = resolveLiveViewAvailability(base({ jobStatus }));
      expect(r).toEqual({ available: false, reason: "job_finished" });
    }
  });

  it("refuses when the session row is missing", () => {
    expect(resolveLiveViewAvailability(base({ sessionStatus: null }))).toEqual({
      available: false,
      reason: "session_not_found",
    });
  });

  it("refuses closed / error sessions", () => {
    for (const sessionStatus of ["closed", "error"] as const) {
      const r = resolveLiveViewAvailability(base({ sessionStatus }));
      expect(r).toEqual({ available: false, reason: "session_closed" });
    }
  });

  it("fails closed on an unknown session status — never assumes live", () => {
    const r = resolveLiveViewAvailability(
      base({ sessionStatus: "mystery" as never }),
    );
    expect(r.available).toBe(false);
    expect(r.reason).toBe("session_closed");
  });

  it("refuses stale session rows (past the idle TTL)", () => {
    expect(resolveLiveViewAvailability(base({ sessionUpdatedAt: STALE }))).toEqual({
      available: false,
      reason: "session_stale",
    });
  });

  it("treats a missing or unparsable updatedAt as stale", () => {
    expect(resolveLiveViewAvailability(base({ sessionUpdatedAt: null })).reason).toBe(
      "session_stale",
    );
    expect(
      resolveLiveViewAvailability(base({ sessionUpdatedAt: "not-a-date" })).reason,
    ).toBe("session_stale");
  });
});
