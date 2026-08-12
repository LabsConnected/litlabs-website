import { describe, it, expect } from "vitest";
import {
  hasCapability,
  hasLocation,
  formatTemperature,
  type UserContext,
} from "@/lib/litt-intelligence/user-context";
import type { CapabilityId, CapabilityStatus } from "@/lib/connectors/provider-registry";

// ── Helpers ────────────────────────────────────────────────────────────

function makeCtx(
  caps: Partial<Record<CapabilityId, CapabilityStatus>> = {},
  overrides: Partial<UserContext> = {},
): UserContext {
  return {
    userId: "test-user",
    displayName: null,
    email: null,
    timezone: null,
    locale: null,
    temperatureUnit: "fahrenheit",
    distanceUnit: "imperial",
    location: {
      city: null,
      region: null,
      country: null,
      latitude: null,
      longitude: null,
      source: "none",
    },
    newsInterests: [],
    dailyBriefingEnabled: false,
    dailyBriefingTime: null,
    capabilities: caps,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("hasCapability — fail closed for private data", () => {
  it("returns true when status is 'ready' for any capability", () => {
    const ctx = makeCtx({ "gmail_read": "ready" });
    expect(hasCapability(ctx, "gmail_read")).toBe(true);
  });

  it("returns false when status is 'needs_permission' for private data", () => {
    const ctx = makeCtx({ "gmail_read": "needs_permission" });
    expect(hasCapability(ctx, "gmail_read")).toBe(false);
  });

  it("returns false when status is 'needs_connection' for private data", () => {
    const ctx = makeCtx({ "gmail_send": "needs_connection" });
    expect(hasCapability(ctx, "gmail_send")).toBe(false);
  });

  it("returns false when status is 'disabled' for private data", () => {
    const ctx = makeCtx({ "google_calendar_write": "disabled" });
    expect(hasCapability(ctx, "google_calendar_write")).toBe(false);
  });

  it("returns false when status is 'unavailable' for private data", () => {
    const ctx = makeCtx({ "contacts_read": "unavailable" });
    expect(hasCapability(ctx, "contacts_read")).toBe(false);
  });

  // ── CRITICAL: 'unknown' must NOT grant access to private data ──────

  it("returns false when status is 'unknown' for gmail_read (sensitive)", () => {
    const ctx = makeCtx({ "gmail_read": "unknown" });
    expect(hasCapability(ctx, "gmail_read")).toBe(false);
  });

  it("returns false when status is 'unknown' for gmail_send (explicit approval)", () => {
    const ctx = makeCtx({ "gmail_send": "unknown" });
    expect(hasCapability(ctx, "gmail_send")).toBe(false);
  });

  it("returns false when status is 'unknown' for contacts_read (connection consent)", () => {
    const ctx = makeCtx({ "contacts_read": "unknown" });
    expect(hasCapability(ctx, "contacts_read")).toBe(false);
  });

  it("returns false when status is 'unknown' for google_calendar_write (explicit approval)", () => {
    const ctx = makeCtx({ "google_calendar_write": "unknown" });
    expect(hasCapability(ctx, "google_calendar_write")).toBe(false);
  });

  it("returns false when status is 'unknown' for microsoft_mail_read (sensitive)", () => {
    const ctx = makeCtx({ "microsoft_mail_read": "unknown" });
    expect(hasCapability(ctx, "microsoft_mail_read")).toBe(false);
  });

  // ── Public-data capabilities: 'unknown' is still allowed ──────────

  it("returns true when status is 'unknown' for weather.current (public data)", () => {
    const ctx = makeCtx({ "weather.current": "unknown" });
    expect(hasCapability(ctx, "weather.current")).toBe(true);
  });

  it("returns true when status is 'unknown' for web.search (public data)", () => {
    const ctx = makeCtx({ "web.search": "unknown" });
    expect(hasCapability(ctx, "web.search")).toBe(true);
  });

  it("returns true when status is 'unknown' for profile.read (public data)", () => {
    const ctx = makeCtx({ "profile.read": "unknown" });
    expect(hasCapability(ctx, "profile.read")).toBe(true);
  });

  // ── Missing capability entirely ───────────────────────────────────

  it("returns false when capability is not in the context at all", () => {
    const ctx = makeCtx({});
    expect(hasCapability(ctx, "gmail_read")).toBe(false);
  });
});

describe("hasLocation", () => {
  it("returns false when source is 'none'", () => {
    const ctx = makeCtx({}, {
      location: { city: "Test", region: null, country: null, latitude: null, longitude: null, source: "none" },
    });
    expect(hasLocation(ctx)).toBe(false);
  });

  it("returns false when city is null", () => {
    const ctx = makeCtx({}, {
      location: { city: null, region: null, country: null, latitude: null, longitude: null, source: "vercel" },
    });
    expect(hasLocation(ctx)).toBe(false);
  });

  it("returns true when city is set and source is not 'none'", () => {
    const ctx = makeCtx({}, {
      location: { city: "Spring Lake", region: "MI", country: "US", latitude: null, longitude: null, source: "confirmed" },
    });
    expect(hasLocation(ctx)).toBe(true);
  });
});

describe("formatTemperature", () => {
  it("formats as Fahrenheit when unit is fahrenheit", () => {
    const ctx = makeCtx({}, { temperatureUnit: "fahrenheit" });
    expect(formatTemperature(ctx, 0)).toBe("32°F");
    expect(formatTemperature(ctx, 100)).toBe("212°F");
  });

  it("formats as Celsius when unit is celsius", () => {
    const ctx = makeCtx({}, { temperatureUnit: "celsius" });
    expect(formatTemperature(ctx, 0)).toBe("0°C");
    expect(formatTemperature(ctx, 25)).toBe("25°C");
  });
});
