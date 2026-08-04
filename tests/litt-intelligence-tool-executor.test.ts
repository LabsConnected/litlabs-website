import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase-admin before importing modules that depend on it
vi.mock("@/lib/supabase-admin", () => ({
  getAdminSupabase: () => { throw new Error("not configured"); },
  isAdminSupabaseConfigured: () => false,
}));

vi.mock("@/lib/connectors/connector-repository", () => ({
  getUserPreferences: vi.fn().mockResolvedValue(null),
  getCapabilityStatus: vi.fn().mockResolvedValue(null),
  upsertCapability: vi.fn().mockResolvedValue(true),
  logConnectorAction: vi.fn().mockResolvedValue(undefined),
}));

import {
  detectWeatherIntent,
  detectToolIntent,
  detectAndExecuteTool,
} from "@/lib/litt-intelligence/tool-executor";
import type { UserContext } from "@/lib/litt-intelligence/user-context";

// Mock getUserContext so we can control the user's location/capabilities
vi.mock("@/lib/litt-intelligence/user-context", () => ({
  getUserContext: vi.fn(),
  formatTemperature: (ctx: UserContext, tempC: number) =>
    ctx.temperatureUnit === "celsius" ? `${Math.round(tempC)}\u00B0C` : `${Math.round(tempC * 9 / 5 + 32)}\u00B0F`,
  hasLocation: (ctx: UserContext) =>
    ctx.location.city != null || (ctx.location.latitude != null && ctx.location.longitude != null),
}));

const { getUserContext } = await import("@/lib/litt-intelligence/user-context");

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

describe("LiTT Tool Executor — Intent Detection", () => {
  it("detects weather intent from 'what's the weather like?'", () => {
    expect(detectWeatherIntent("What's the weather like?")).toBe("current");
  });

  it("detects weather intent from 'temperature'", () => {
    expect(detectWeatherIntent("What's the temperature outside?")).toBe("current");
  });

  it("detects weather intent from 'forecast' as daily", () => {
    expect(detectWeatherIntent("What's the forecast for tomorrow?")).toBe("daily");
  });

  it("detects weather intent from 'rain' as current", () => {
    expect(detectWeatherIntent("Is it going to rain?")).toBe("current");
  });

  it("detects weather intent from 'what should i wear'", () => {
    expect(detectWeatherIntent("What should I wear today?")).toBe("current");
  });

  it("detects weather intent from 'how hot'", () => {
    expect(detectWeatherIntent("How hot is it right now?")).toBe("current");
  });

  it("detects weather intent from 'how cold'", () => {
    expect(detectWeatherIntent("How cold is it?")).toBe("current");
  });

  it("detects weather intent from 'snow'", () => {
    expect(detectWeatherIntent("Will it snow today?")).toBe("current");
  });

  it("detects weather intent from 'wind'", () => {
    expect(detectWeatherIntent("How's the wind?")).toBe("current");
  });

  it("detects weather intent from 'humidity'", () => {
    expect(detectWeatherIntent("What's the humidity?")).toBe("current");
  });

  it("detects daily forecast from 'this week'", () => {
    expect(detectWeatherIntent("What's the weather this week?")).toBe("daily");
  });

  it("detects hourly from 'next few hours'", () => {
    expect(detectWeatherIntent("Will it rain in the next few hours?")).toBe("hourly");
  });

  it("returns null for non-weather messages", () => {
    expect(detectWeatherIntent("Help me build a website")).toBeNull();
    expect(detectWeatherIntent("Write a poem about cats")).toBeNull();
    expect(detectWeatherIntent("What's the capital of France?")).toBeNull();
  });

  it("detectToolIntent returns weather for weather messages", () => {
    const intent = detectToolIntent("What's the weather?");
    expect(intent).toEqual({ tool: "weather", weatherType: "current" });
  });

  it("detectToolIntent returns null for normal chat", () => {
    expect(detectToolIntent("Write me a song")).toBeNull();
  });
});

describe("LiTT Tool Executor — detectAndExecuteTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("invokes the weather tool for 'What's the weather like?'", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(25, 1),
    });

    const result = await detectAndExecuteTool("user_test1", "What's the weather like?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
    expect(result.metadata.tool).toBe("weather");
    expect(result.metadata.provider).toBe("open_meteo");
    expect(result.metadata.realtime).toBe(true);
    expect(result.metadata.location).toBe("New York");
    expect(result.text).toContain("New York");
  });

  it("returns live weather when a stored city exists", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(30, 2),
    });

    const result = await detectAndExecuteTool("user_test1", "How hot is it?");
    expect(result.executed).toBe(true);
    expect(result.text).toContain("86\u00B0F"); // 30C = 86F
  });

  it("asks for a city when location is missing", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx({
      location: {
        city: null,
        region: null,
        country: null,
        latitude: null,
        longitude: null,
        source: "none",
      },
    }));

    const result = await detectAndExecuteTool("user_test1", "What's the weather?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
    // The error message should ask for a city, NOT say "real-time access unavailable"
    expect(result.text.toLowerCase()).toContain("city");
    expect(result.text.toLowerCase()).not.toContain("real-time");
    expect(result.text.toLowerCase()).not.toContain("unavailable");
  });

  it("returns an honest error when the provider fails", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await detectAndExecuteTool("user_test1", "What's the temperature?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
    // Should report the actual failure, not claim "no real-time access"
    expect(result.text.toLowerCase()).toMatch(/fail|error/);
    expect(result.text.toLowerCase()).not.toContain("real-time access");
  });

  it("does NOT fire a tool for normal chat messages", async () => {
    const result = await detectAndExecuteTool("user_test1", "Write me a haiku about autumn");
    expect(result.executed).toBe(false);
    expect(result.toolId).toBe("none");
    expect(result.text).toBe("");
    expect(result.metadata.tool).toBe("none");
    // getUserContext should not even be called for non-tool messages
    expect(getUserContext).not.toHaveBeenCalled();
  });

  it("does not fire for coding questions", async () => {
    const result = await detectAndExecuteTool("user_test1", "How do I fix a TypeScript error?");
    expect(result.executed).toBe(false);
  });

  it("does not fire for general knowledge questions", async () => {
    const result = await detectAndExecuteTool("user_test1", "What's the capital of France?");
    expect(result.executed).toBe(false);
  });

  it("includes structured metadata with tool, provider, realtime, and location", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(20, 0),
    });

    const result = await detectAndExecuteTool("user_test1", "What's the weather?");
    expect(result.metadata).toEqual({
      tool: "weather",
      provider: "open_meteo",
      realtime: true,
      location: "New York",
    });
  });
});
