import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => { throw new Error("not configured"); },
}));

vi.mock("@/lib/connectors/connector-repository", () => ({
  getUserPreferences: vi.fn().mockResolvedValue(null),
  getCapabilityStatus: vi.fn().mockResolvedValue(null),
  upsertCapability: vi.fn().mockResolvedValue(true),
  logConnectorAction: vi.fn().mockResolvedValue(undefined),
}));

import {
  getUserContext,
  hasLocation,
  hasCapability,
  formatTemperature,
  type UserContext,
} from "@/lib/litt-intelligence/user-context";

function makeCtx(overrides: Partial<UserContext> = {}): UserContext {
  return {
    userId: "user_test1",
    displayName: "Larry",
    email: "larry@test.com",
    timezone: "America/New_York",
    locale: "en-US",
    temperatureUnit: "fahrenheit",
    distanceUnit: "imperial",
    location: {
      city: "New York",
      region: "NY",
      country: "US",
      latitude: 40.71,
      longitude: -74.01,
      source: "manual_city",
    },
    newsInterests: [],
    dailyBriefingEnabled: false,
    dailyBriefingTime: null,
    capabilities: {},
    fetchedAt: Date.now(),
    ...overrides,
  };
}

describe("LiTT User Context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default context when Supabase is not configured", async () => {
    const ctx = await getUserContext("user_test1");
    expect(ctx.userId).toBe("user_test1");
    expect(ctx.temperatureUnit).toBe("fahrenheit");
    expect(ctx.location.source).toBe("none");
  });

  it("hasLocation returns true when city is set with manual_city source", () => {
    const ctx = makeCtx();
    expect(hasLocation(ctx)).toBe(true);
  });

  it("hasLocation returns false when source is none", () => {
    const ctx = makeCtx({
      location: { city: null, region: null, country: null, latitude: null, longitude: null, source: "none" },
    });
    expect(hasLocation(ctx)).toBe(false);
  });

  it("hasCapability returns true for ready status", () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "ready" },
    });
    expect(hasCapability(ctx, "weather.current")).toBe(true);
  });

  it("hasCapability returns false for disabled status", () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "disabled" },
    });
    expect(hasCapability(ctx, "weather.current")).toBe(false);
  });

  it("formatTemperature converts celsius to fahrenheit", () => {
    const ctx = makeCtx({ temperatureUnit: "fahrenheit" });
    expect(formatTemperature(ctx, 25)).toBe("77\u00B0F");
  });

  it("formatTemperature keeps celsius when preference is celsius", () => {
    const ctx = makeCtx({ temperatureUnit: "celsius" });
    expect(formatTemperature(ctx, 25)).toBe("25\u00B0C");
  });
});
