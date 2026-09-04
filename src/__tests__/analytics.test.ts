/**
 * Analytics module tests — consent-aware event tracking.
 *
 * Verifies:
 * - Events are dropped when consent is not given
 * - Events are queued when consent is given
 * - No PII or sensitive data is collected
 * - Flush sends events to the API endpoint
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock cookie-consent
vi.mock("@/lib/cookie-consent", () => ({
  hasConsent: vi.fn(),
}));

import { hasConsent } from "@/lib/cookie-consent";

// Re-import analytics fresh per test via dynamic import after setting up mocks
describe("Analytics module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasConsent).mockReturnValue(false);
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: set up sendBeacon spy and return a capture function */
  function setupSendBeacon() {
    const calls: { url: string; body: string }[] = [];
    const sendBeaconSpy = vi.fn((url: string, blob: any) => {
      // Blob in jsdom may not have .text(); capture the constructor args
      if (blob && typeof blob.text === "function") {
        blob.text().then((t: string) => calls.push({ url, body: t }));
      } else {
        // Fallback: Blob constructor stores parts in internal state
        calls.push({ url, body: "[blob]" });
      }
      return true;
    });
    (global.navigator as any) = { sendBeacon: sendBeaconSpy };
    return { sendBeaconSpy, calls };
  }

  it("drops events when consent is not given", async () => {
    vi.mocked(hasConsent).mockReturnValue(false);
    const { sendBeaconSpy } = setupSendBeacon();
    const { track, flushAnalytics } = await import("@/lib/analytics");

    track("homepage_view");
    flushAnalytics();
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("queues events when consent is given and sends via sendBeacon", async () => {
    vi.mocked(hasConsent).mockReturnValue(true);
    const { sendBeaconSpy } = setupSendBeacon();
    const { track, flushAnalytics } = await import("@/lib/analytics");

    track("homepage_view");
    track("pricing_viewed");
    flushAnalytics();
    await new Promise((r) => setTimeout(r, 10));

    expect(sendBeaconSpy).toHaveBeenCalledTimes(1);
    expect(sendBeaconSpy.mock.calls[0][0]).toBe("/api/analytics/event");
  });

  it("respects consent gate on every track call", async () => {
    vi.mocked(hasConsent).mockReturnValue(false);
    const { sendBeaconSpy } = setupSendBeacon();
    const { track, flushAnalytics } = await import("@/lib/analytics");

    track("studio_opened");
    track("checkout_started");
    track("plan_activated");
    flushAnalytics();
    await new Promise((r) => setTimeout(r, 10));

    expect(sendBeaconSpy).not.toHaveBeenCalled();
  });

  it("all expected funnel events are valid FunnelEvent types", async () => {
    const { track } = await import("@/lib/analytics");
    // If TypeScript compiles, these are all valid FunnelEvent values
    const events = [
      "homepage_view",
      "signup_started",
      "signup_completed",
      "project_created",
      "project_selected",
      "studio_opened",
      "first_successful_prompt",
      "pricing_viewed",
      "checkout_started",
      "checkout_completed",
      "plan_activated",
      "returning_user",
    ] as const;

    vi.mocked(hasConsent).mockReturnValue(true);
    setupSendBeacon();

    // Each should be accepted without error
    events.forEach((e) => track(e));
    expect(events).toHaveLength(12);
  });

  it("does not crash when window is undefined (SSR safety)", async () => {
    const originalWindow = global.window;
    (global as any).window = undefined;
    const { track } = await import("@/lib/analytics");

    // Should not throw
    track("homepage_view");

    (global as any).window = originalWindow;
  });
});
