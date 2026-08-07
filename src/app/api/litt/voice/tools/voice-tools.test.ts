/**
 * Voice tools webhook — summarization tests.
 *
 * Verifies the summarizeForVoice logic that converts tool results into
 * short, speakable text for voice providers.
 *
 * Run: npx vitest run src/app/api/litt/voice/tools/voice-tools.test.ts
 */

import { describe, it, expect } from "vitest";

// Mirror the route's summarizeForVoice logic for unit testing
function summarizeForVoice(data: unknown): string {
  if (Array.isArray(data)) {
    return `Found ${data.length} item${data.length === 1 ? "" : "s"}.`;
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (obj.id && obj.status === "pending") return "Booking created. It's pending confirmation.";
    if (obj.id && obj.status === "confirmed") return "Booking confirmed.";
    if (obj.id && obj.status === "cancelled") return "Booking cancelled.";
    if (obj.id && obj.status === "rescheduled") return "Booking rescheduled.";
    if (obj.id && obj.duration_minutes) return `Service created: ${obj.name}.`;
    if (obj.id) return "Done. The record has been updated.";
    if (typeof obj.services === "number") {
      return `You have ${obj.services} services, ${obj.activeBookings} active bookings, and ${obj.pendingLeads} pending leads.`;
    }
  }
  return "Done.";
}

describe("summarizeForVoice", () => {
  it("summarizes arrays by count", () => {
    expect(summarizeForVoice([1, 2, 3])).toBe("Found 3 items.");
    expect(summarizeForVoice([1])).toBe("Found 1 item.");
    expect(summarizeForVoice([])).toBe("Found 0 items.");
  });

  it("summarizes pending bookings", () => {
    expect(summarizeForVoice({ id: "b1", status: "pending" })).toBe("Booking created. It's pending confirmation.");
  });

  it("summarizes confirmed bookings", () => {
    expect(summarizeForVoice({ id: "b1", status: "confirmed" })).toBe("Booking confirmed.");
  });

  it("summarizes cancelled bookings", () => {
    expect(summarizeForVoice({ id: "b1", status: "cancelled" })).toBe("Booking cancelled.");
  });

  it("summarizes rescheduled bookings", () => {
    expect(summarizeForVoice({ id: "b1", status: "rescheduled" })).toBe("Booking rescheduled.");
  });

  it("summarizes service creation", () => {
    expect(summarizeForVoice({ id: "s1", name: "Consultation", duration_minutes: 30 })).toBe("Service created: Consultation.");
  });

  it("summarizes generic records with an id", () => {
    expect(summarizeForVoice({ id: "x1", name: "Lead" })).toBe("Done. The record has been updated.");
  });

  it("summarizes dashboard data", () => {
    expect(summarizeForVoice({ services: 5, activeBookings: 3, pendingLeads: 2 })).toBe(
      "You have 5 services, 3 active bookings, and 2 pending leads.",
    );
  });

  it("returns Done. for unknown shapes", () => {
    expect(summarizeForVoice(null)).toBe("Done.");
    expect(summarizeForVoice("string")).toBe("Done.");
    expect(summarizeForVoice(42)).toBe("Done.");
    expect(summarizeForVoice({})).toBe("Done.");
  });
});
