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

import { fetchWeatherForUser } from "@/lib/litt-intelligence/weather-tool";
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
    capabilities: { "weather.current": "ready" },
    fetchedAt: Date.now(),
    ...overrides,
  };
}

const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

function mockGeocodeResponse(name: string, lat: number, lon: number) {
  return {
    results: [
      {
        name,
        latitude: lat,
        longitude: lon,
        country: "US",
        admin1: "NY",
        timezone: "America/New_York",
      },
    ],
  };
}

function mockCurrentWeatherResponse(tempC: number, weatherCode: number) {
  return {
    current: {
      time: "2026-08-02T10:00",
      temperature_2m: tempC,
      apparent_temperature: tempC + 2,
      relative_humidity_2m: 65,
      wind_speed_10m: 12,
      wind_direction_10m: 180,
      weather_code: weatherCode,
      is_day: 1,
    },
  };
}

describe("LiTT Weather Tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies when location is not set", async () => {
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
    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("city");
    }
  });

  it("denies when capability is disabled", async () => {
    const ctx = makeCtx({
      capabilities: { "weather.current": "disabled" },
    });
    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("disabled");
    }
  });

  it("fetches weather using lat/lon from context", async () => {
    const ctx = makeCtx();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(25, 1),
    });

    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.current.temperature).toBe(25);
      expect(result.formatted).toContain("77\u00B0F");
      expect(result.formatted).toContain("New York");
    }
  });

  it("geocodes city when lat/lon not available", async () => {
    const ctx = makeCtx({
      location: {
        city: "Tokyo",
        region: null,
        country: null,
        latitude: null,
        longitude: null,
        source: "manual_city",
      },
    });
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockGeocodeResponse("Tokyo", 35.68, 139.69),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockCurrentWeatherResponse(30, 0),
      });

    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.current.temperature).toBe(30);
      expect(result.formatted).toContain("Tokyo");
    }
  });

  it("returns error when geocode finds no results", async () => {
    const ctx = makeCtx({
      location: {
        city: "Nonexistent City XYZ123",
        region: null,
        country: null,
        latitude: null,
        longitude: null,
        source: "manual_city",
      },
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    });

    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Could not find");
    }
  });

  it("returns error when weather API fails", async () => {
    const ctx = makeCtx();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("failed");
    }
  });

  it("uses celsius when user preference is celsius", async () => {
    const ctx = makeCtx({ temperatureUnit: "celsius" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(25, 1),
    });

    const result = await fetchWeatherForUser(ctx);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.formatted).toContain("25\u00B0C");
    }
  });
});
