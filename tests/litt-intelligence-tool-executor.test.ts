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
  extractExplicitLocation,
  detectWebSearchIntent,
  extractSearchQuery,
} from "@/lib/litt-intelligence/tool-executor";
import type { UserContext } from "@/lib/litt-intelligence/user-context";
import type { ConversationTurn } from "@/lib/litt-intelligence/turn-resolver";

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

describe("LiTT Tool Executor — Explicit Location Extraction", () => {
  it("extracts city from 'weather in Grand Haven'", () => {
    expect(extractExplicitLocation("What's the weather in Grand Haven?")).toBe("Grand Haven");
  });

  it("extracts city from 'temperature in Detroit'", () => {
    expect(extractExplicitLocation("What's the temperature in Detroit?")).toBe("Detroit");
  });

  it("extracts city from 'is it raining in Chicago'", () => {
    expect(extractExplicitLocation("Is it raining in Chicago?")).toBe("Chicago");
  });

  it("extracts two-word city names", () => {
    expect(extractExplicitLocation("Weather in Grand Haven please")).toBe("Grand Haven");
  });

  it("returns null for non-weather messages", () => {
    expect(extractExplicitLocation("Build a website in React")).toBeNull();
  });

  it("filters out non-city words like 'the morning'", () => {
    expect(extractExplicitLocation("What's the weather in the morning?")).toBeNull();
  });
});

describe("LiTT Tool Executor — Explicit City Override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses explicit city instead of saved city", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    // Geocode call for "Detroit"
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ name: "Detroit", latitude: 42.33, longitude: -83.05, country: "US", admin1: "MI" }],
      }),
    });
    // Weather call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockCurrentWeatherResponse(28, 1),
    });

    const result = await detectAndExecuteTool("user_test1", "What's the weather in Detroit?");
    expect(result.executed).toBe(true);
    expect(result.metadata.location).toBe("Detroit");
    expect(result.text).toContain("Detroit");
    // Should NOT use the saved city "New York"
    expect(result.text).not.toContain("New York");
  });
});

describe("LiTT Tool Executor — Conversational Follow-ups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects weather follow-up 'What about tomorrow?' with history", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    // Geocode for "Grand Haven" (from history)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        results: [{ name: "Grand Haven", latitude: 43.06, longitude: -86.23, country: "US", admin1: "MI" }],
      }),
    });
    // Daily forecast call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-08-10", "2026-08-11"],
          weather_code: [1, 2],
          temperature_2m_max: [28, 30],
          temperature_2m_min: [18, 20],
          precipitation_sum: [0, 0.5],
          precipitation_probability_max: [10, 60],
          wind_speed_10m_max: [15, 20],
          sunrise: ["06:00", "06:01"],
          sunset: ["20:00", "19:59"],
        },
      }),
    });

    const history: ConversationTurn[] = [
      { role: "user", content: "What's the weather in Grand Haven?" },
      { role: "assistant", content: "Weather for Grand Haven: Clear sky, 82°F" },
    ];

    const result = await detectAndExecuteTool("user_test1", "What about tomorrow?", { history });
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
    expect(result.metadata.location).toBe("Grand Haven");
  });

  it("does not treat 'What about tomorrow?' as weather without history", async () => {
    const result = await detectAndExecuteTool("user_test1", "What about tomorrow?");
    expect(result.executed).toBe(false);
  });
});

describe("LiTT Tool Executor — Missing Location (Conversational Fallback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks 'what city?' conversationally when no location available", async () => {
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

    const result = await detectAndExecuteTool("user_test1", "Can you tell me the weather?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
    expect(result.text).toContain("what city");
    expect(result.text.toLowerCase()).not.toContain("settings");
    expect(result.text.toLowerCase()).not.toContain("unavailable");
    expect(result.text.toLowerCase()).not.toContain("real-time");
  });
});

describe("LiTT Tool Executor — Daily/Hourly Routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes 'forecast' to daily", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        daily: {
          time: ["2026-08-10"],
          weather_code: [1],
          temperature_2m_max: [28],
          temperature_2m_min: [18],
          precipitation_sum: [0],
          precipitation_probability_max: [10],
          wind_speed_10m_max: [15],
          sunrise: ["06:00"],
          sunset: ["20:00"],
        },
      }),
    });

    const result = await detectAndExecuteTool("user_test1", "What's the forecast for this week?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
  });

  it("routes 'next few hours' to hourly", async () => {
    vi.mocked(getUserContext).mockResolvedValue(makeCtx());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        hourly: {
          time: ["2026-08-10T10:00", "2026-08-10T11:00"],
          temperature_2m: [25, 26],
          precipitation_probability: [10, 20],
          weather_code: [1, 2],
          wind_speed_10m: [12, 14],
        },
      }),
    });

    const result = await detectAndExecuteTool("user_test1", "Will it rain in the next few hours?");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("weather");
  });
});

describe("LiTT Tool Executor — Web Search Intent Detection", () => {
  it("detects 'search for' intent", () => {
    expect(detectWebSearchIntent("Search for the best React frameworks")).toBe(true);
  });

  it("detects 'google' intent", () => {
    expect(detectWebSearchIntent("Google the latest AI news")).toBe(true);
  });

  it("detects 'look up' intent", () => {
    expect(detectWebSearchIntent("Look up the stock price of Apple")).toBe(true);
  });

  it("detects 'latest news' intent", () => {
    expect(detectWebSearchIntent("What's the latest news on AI?")).toBe(true);
  });

  it("does NOT fire for weather queries", () => {
    expect(detectWebSearchIntent("What's the weather like?")).toBe(false);
  });

  it("does NOT fire for coding questions", () => {
    expect(detectWebSearchIntent("How do I fix a bug in my React component?")).toBe(false);
  });

  it("does NOT fire for general chat", () => {
    expect(detectWebSearchIntent("Write me a poem about cats")).toBe(false);
  });

  it("extracts query from 'search for'", () => {
    expect(extractSearchQuery("Search for the best pizza in Chicago")).toBe("the best pizza in Chicago");
  });

  it("extracts query from 'google'", () => {
    expect(extractSearchQuery("Google the latest AI news")).toBe("the latest AI news");
  });

  it("extracts query from 'what happened' pattern", () => {
    expect(extractSearchQuery("What happened in the world today?")).toBe("in the world today?");
  });

  it("detectToolIntent returns web_search for search messages", () => {
    const intent = detectToolIntent("Search for the best React frameworks");
    expect(intent).toEqual({ tool: "web_search" });
  });
});

describe("LiTT Tool Executor — Web Search Execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns executed=false when BRAVE_SEARCH_API_KEY is not set", async () => {
    const result = await detectAndExecuteTool("user_test1", "Search for the best pizza");
    expect(result.executed).toBe(false);
    expect(result.toolId).toBe("none");
  });

  it("executes web search when API key is configured", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

    vi.mocked(getUserContext).mockResolvedValue(makeCtx({
      capabilities: { "web.search": "ready" },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: "Best Pizza in Chicago", url: "https://example.com/pizza", description: "Top 10 pizza places" },
          ],
        },
      }),
    });

    const result = await detectAndExecuteTool("user_test1", "Search for the best pizza in Chicago");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("web_search");
    expect(result.metadata.tool).toBe("web_search");
    expect(result.metadata.provider).toBe("brave_search");
    expect(result.metadata.realtime).toBe(true);
    expect(result.text).toContain("Best Pizza in Chicago");

    delete process.env.BRAVE_SEARCH_API_KEY;
  });

  it("returns honest error when Brave API fails", async () => {
    process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";

    vi.mocked(getUserContext).mockResolvedValue(makeCtx({
      capabilities: { "web.search": "ready" },
    }));

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await detectAndExecuteTool("user_test1", "Search for something");
    expect(result.executed).toBe(true);
    expect(result.toolId).toBe("web_search");
    expect(result.text.toLowerCase()).toMatch(/fail|error/);

    delete process.env.BRAVE_SEARCH_API_KEY;
  });
});
