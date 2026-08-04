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
  checkPermission,
  grantCapability,
  revokeCapability,
} from "@/lib/litt-intelligence/permission-gate";
import type { UserContext } from "@/lib/litt-intelligence/user-context";

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

describe("LiTT Permission Gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when capability is ready and location is set", () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "ready" },
    });
    const result = checkPermission(ctx, "weather.current");
    expect(result.allowed).toBe(true);
  });

  it("denies when capability is disabled", () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "disabled" },
    });
    const result = checkPermission(ctx, "weather.current");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("capability_disabled");
  });

  it("denies when capability needs connection", () => {
    const ctx = makeCtx({
      capabilities: { "google_calendar_read": "needs_connection" },
    });
    const result = checkPermission(ctx, "google_calendar_read");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("needs_connection");
  });

  it("denies when capability needs permission", () => {
    const ctx = makeCtx({
      capabilities: { "gmail_read": "needs_permission" },
    });
    const result = checkPermission(ctx, "gmail_read");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("needs_permission");
  });

  it("denies weather when location is not set", () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "ready" },
      location: {
        city: null,
        region: null,
        country: null,
        latitude: null,
        longitude: null,
        source: "none",
      },
    });
    const result = checkPermission(ctx, "weather.current");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("location_not_set");
      expect(result.message).toContain("city");
    }
  });

  it("allows non-location capabilities without location", () => {
    const ctx = makeCtx({
      capabilities: { "web.search": "ready" },
      location: {
        city: null,
        region: null,
        country: null,
        latitude: null,
        longitude: null,
        source: "none",
      },
    });
    const result = checkPermission(ctx, "web.search");
    expect(result.allowed).toBe(true);
  });

  it("grantCapability calls upsertCapability", async () => {
    const result = await grantCapability("user_test1", "weather.current", "open_meteo");
    expect(result).toBe(true);
  });

  it("revokeCapability calls upsertCapability with disabled", async () => {
    const result = await revokeCapability("user_test1", "weather.current");
    expect(result).toBe(true);
  });
});
