/**
 * LiTT Tool Executor — shared intent detection + tool execution.
 *
 * This is the canonical server-side module that BOTH chat endpoints use:
 *   - /api/agents/chat  (Studio chat)
 *   - /api/litt/think   (LiTT command-center)
 *
 * Before calling the LLM, each endpoint runs `detectAndExecuteTool` to check
 * whether the user's message matches a real-time tool intent (weather, etc.).
 * If a tool fires, the formatted live result is returned directly — the LLM
 * is never asked to "guess" real-time data.
 *
 * When no tool matches, the caller proceeds with normal LLM generation.
 */

import "server-only";
import { getUserContext, hasLocation } from "./user-context";
import type { UserContext } from "./user-context";
import {
  fetchWeatherForUser,
  type WeatherToolResponse,
} from "./weather-tool";
import {
  executeWebSearch,
  type WebSearchToolResponse,
} from "./web-search-tool";
import { isWebSearchAvailable } from "./web-search-provider";
import type { ConversationTurn } from "./turn-resolver";

/* ── Types ──────────────────────────────────────────────────────── */

export type ToolId = "weather" | "web_search" | "none";

/* ── Explicit location extraction ──────────────────────────────── */

const NON_CITY_WORDS = new Set([
  "the", "this", "that", "my", "your", "our", "a", "an",
  "morning", "afternoon", "evening", "night", "day", "week", "month", "year",
  "forecast", "weather", "general", "particular", "future", "past",
  "summer", "winter", "spring", "fall", "autumn",
  "today", "tomorrow", "yesterday",
  "celsius", "fahrenheit",
  "here", "there", "everywhere",
]);

/**
 * Extracts an explicit city name from a weather-related message.
 * Matches patterns like "weather in Grand Haven", "temperature in Detroit", etc.
 */
export function extractExplicitLocation(message: string): string | null {
  const lower = message.toLowerCase();
  if (!WEATHER_KEYWORDS.some((kw) => lower.includes(kw))) return null;

  const patterns = [
    /\b(?:weather|temperature|forecast|rain|snow|wind|humidity|umbrella)\b[^.!?]*?\b(?:in|for|at|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i,
    /\b(?:how hot|how cold|is it hot|is it cold|is it raining|is it snowing)\b[^.!?]*?\b(?:in|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i,
    /\b(?:what's|whats|what is)\s+(?:the\s+)?weather\b[^.!?]*?\b(?:in|like in|for|at)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const city = match[1].trim();
      const firstWord = city.split(/\s+/)[0].toLowerCase();
      // Filter out non-city words — check both the full capture and the first word
      if (!NON_CITY_WORDS.has(city.toLowerCase()) && !NON_CITY_WORDS.has(firstWord)) {
        return city;
      }
    }
  }

  return null;
}

/**
 * Extracts a location from conversation history by scanning prior
 * user messages for explicit city mentions in weather context.
 * Used for follow-ups like "What about tomorrow?" after "weather in Grand Haven".
 */
function extractLocationFromHistory(history: ConversationTurn[]): string | null {
  const recent = history.slice(-6);
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i];
    if (turn.role === "user") {
      const loc = extractExplicitLocation(turn.content);
      if (loc) return loc;
    }
  }
  return null;
}

export interface ToolMetadata {
  tool: ToolId;
  provider: string;
  realtime: boolean;
  location: string | null;
}

export interface ToolExecutionResult {
  /** True when a tool fired and produced a result (success or error) */
  executed: boolean;
  /** The tool that fired, or "none" */
  toolId: ToolId;
  /** Formatted text to return to the user (the tool's answer) */
  text: string;
  /** Structured metadata for the response payload */
  metadata: ToolMetadata;
  /** The raw tool response (for callers that need structured data) */
  raw?: WeatherToolResponse | WebSearchToolResponse;
}

/* ── Intent detection ───────────────────────────────────────────── */

const WEATHER_KEYWORDS = [
  "weather",
  "temperature",
  "forecast",
  "rain",
  "snow",
  "wind",
  "humidity",
  "what should i wear",
  "how hot",
  "how cold",
  "is it hot",
  "is it cold",
  "umbrella",
];

const WEB_SEARCH_KEYWORDS = [
  "search for",
  "google",
  "look up",
  "find online",
  "what's the latest",
  "what is the latest",
  "what's happening",
  "what is happening",
  "in the news",
  "current events",
  "who won",
  "who is winning",
  "what's the score",
  "stock price",
  "stock market",
  "crypto price",
  "bitcoin price",
  "eth price",
  "latest news",
  "breaking news",
  "trending",
  "what's new",
  "recently",
  "this week in",
  "current price of",
  "price of",
  "how much is",
  "when is the next",
  "who is the current",
  "what year did",
  "what happened",
];

/**
 * Detects whether a user message expresses weather intent.
 * Returns the weather request type, or null if no weather intent.
 */
export function detectWeatherIntent(message: string): "current" | "hourly" | "daily" | null {
  const lower = message.toLowerCase();
  if (!WEATHER_KEYWORDS.some((kw) => lower.includes(kw))) return null;

  // Refine: "forecast" or "tomorrow" or "this week" → daily
  if (lower.includes("forecast") || lower.includes("tomorrow") || lower.includes("this week") || lower.includes("week")) {
    return "daily";
  }
  // "hourly" or "next few hours" → hourly
  if (lower.includes("hourly") || lower.includes("next few hours") || lower.includes("rest of the day")) {
    return "hourly";
  }
  return "current";
}

/**
 * Detects whether a user message expresses web search intent.
 * Returns true if the message should trigger a web search.
 */
export function detectWebSearchIntent(message: string): boolean {
  const lower = message.toLowerCase();
  // Don't fire for weather queries (those are handled by weather tool)
  if (WEATHER_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  // Don't fire for coding/project queries
  if (/\b(code|function|bug|error|build|deploy|component|typescript|python|node)\b/i.test(lower)) return false;
  return WEB_SEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Extracts a search query from the user message.
 * Strips the trigger phrase and returns the remaining text as the query.
 */
export function extractSearchQuery(message: string): string {
  const patterns = [
    /(?:search for|google|look up|find online)\s+(.+)/i,
    /(?:what's the latest|what is the latest|what's happening|what is happening)\s+(?:on|with|in|about)?\s*(.+)/i,
    /(?:what's the|what is the|current)\s+(?:price of|cost of)?\s*(.+)/i,
    /(?:who won|who is winning|what's the score)\s+(.+)/i,
    /(?:latest news|breaking news|in the news)\s+(?:about|on|regarding)?\s*(.+)/i,
    /(?:what happened|what's new|trending)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && match[1].trim().length > 2) {
      return match[1].trim();
    }
  }

  // Fallback: use the full message as the query
  return message.trim();
}

/**
 * Detects any tool intent from the message.
 * Returns the tool id + refined intent, or null if no tool matches.
 * When history is provided, also detects weather follow-ups like
 * "What about tomorrow?" after a weather-related turn.
 */
export function detectToolIntent(
  message: string,
  history?: ConversationTurn[],
): { tool: ToolId; weatherType?: "current" | "hourly" | "daily" } | null {
  const weatherType = detectWeatherIntent(message);
  if (weatherType) return { tool: "weather", weatherType };

  // Check for web search intent
  if (detectWebSearchIntent(message)) {
    return { tool: "web_search" };
  }

  // Check for weather follow-up with temporal keywords (no explicit weather word)
  if (history && history.length > 0) {
    const lower = message.toLowerCase();
    const isTemporalFollowup =
      /\b(tomorrow|today|this week|next week|hourly|rest of the day|next few hours|forecast)\b/i.test(lower) &&
      !WEATHER_KEYWORDS.some((kw) => lower.includes(kw));

    if (isTemporalFollowup) {
      const recent = history.slice(-6);
      const hasWeatherContext = recent.some(
        (t) => t.role === "user" && WEATHER_KEYWORDS.some((kw) => t.content.toLowerCase().includes(kw)),
      );

      if (hasWeatherContext) {
        const type =
          lower.includes("tomorrow") ||
          lower.includes("this week") ||
          lower.includes("next week") ||
          lower.includes("forecast")
            ? "daily"
            : lower.includes("hourly") ||
                lower.includes("next few hours") ||
                lower.includes("rest of the day")
              ? "hourly"
              : "current";
        return { tool: "weather", weatherType: type };
      }
    }
  }

  return null;
}

/* ── Tool execution ─────────────────────────────────────────────── */

/**
 * Detects tool intent and, if matched, executes the tool with the
 * authenticated user's context. Returns a ToolExecutionResult.
 *
 * Callers should check `result.executed` — if true, return `result.text`
 * directly to the client and skip LLM generation. If false, proceed
 * with normal LLM chat.
 */
export async function detectAndExecuteTool(
  userId: string,
  message: string,
  options?: { clientIp?: string; headers?: Headers; history?: ConversationTurn[] },
): Promise<ToolExecutionResult> {
  const intent = detectToolIntent(message, options?.history);
  if (!intent) {
    return {
      executed: false,
      toolId: "none",
      text: "",
      metadata: { tool: "none", provider: "", realtime: false, location: null },
    };
  }

  if (intent.tool === "weather") {
    return executeWeatherTool(userId, message, intent.weatherType ?? "current", options?.headers, options?.history);
  }

  if (intent.tool === "web_search") {
    return executeWebSearchTool(userId, message, options?.headers);
  }

  return {
    executed: false,
    toolId: "none",
    text: "",
    metadata: { tool: "none", provider: "", realtime: false, location: null },
  };
}

/**
 * Executes the weather tool for a user.
 * Handles all failure modes honestly:
 *   - Missing location → asks for city
 *   - Capability disabled → reports disabled
 *   - Provider failure → reports the actual error
 */
async function executeWeatherTool(
  userId: string,
  message: string,
  type: "current" | "hourly" | "daily",
  headers?: Headers,
  history?: ConversationTurn[],
): Promise<ToolExecutionResult> {
  // 1. Try to extract explicit location from the message
  const explicitCity = extractExplicitLocation(message);

  // 2. Try to extract location from conversation history (for follow-ups)
  const historyCity = explicitCity ? null : extractLocationFromHistory(history ?? []);

  // 3. Load user context (saved location, Vercel geo, capabilities)
  const ctx = await getUserContext(userId, {
    capabilities: ["weather.current", "weather.hourly", "weather.daily"],
    headers,
  });

  // 4. Override location if explicit or history city found (this request only)
  const overrideCity = explicitCity ?? historyCity;
  if (overrideCity) {
    ctx.location = {
      city: overrideCity,
      region: null,
      country: null,
      latitude: null,
      longitude: null,
      source: "confirmed",
    };
  }

  // 5. If still no location, ask conversationally (not a settings error)
  if (!hasLocation(ctx)) {
    return {
      executed: true,
      toolId: "weather",
      text: "Sure — what city should I check?",
      metadata: {
        tool: "weather",
        provider: "open_meteo",
        realtime: true,
        location: null,
      },
    };
  }

  // 6. Fetch weather via the existing tool
  const result = await fetchWeatherForUser(ctx, { type });

  // Resolve the location name for metadata
  const locationName = ctx.location.city
    ?? (ctx.location.latitude != null && ctx.location.longitude != null
      ? `${ctx.location.latitude.toFixed(2)}, ${ctx.location.longitude.toFixed(2)}`
      : null);

  const metadata: ToolMetadata = {
    tool: "weather",
    provider: "open_meteo",
    realtime: true,
    location: locationName,
  };

  if (result.success) {
    return {
      executed: true,
      toolId: "weather",
      text: result.formatted,
      metadata,
      raw: result,
    };
  }

  // Failure — but still "executed" (we tried, and we have an honest error)
  return {
    executed: true,
    toolId: "weather",
    text: result.error,
    metadata,
    raw: result,
  };
}

/**
 * Executes the web search tool for a user.
 * Only fires when BRAVE_SEARCH_API_KEY is configured.
 */
async function executeWebSearchTool(
  userId: string,
  message: string,
  headers?: Headers,
): Promise<ToolExecutionResult> {
  const query = extractSearchQuery(message);

  // Check if web search is configured
  if (!isWebSearchAvailable()) {
    return {
      executed: false,
      toolId: "none",
      text: "",
      metadata: { tool: "none", provider: "", realtime: false, location: null },
    };
  }

  const ctx = await getUserContext(userId, {
    capabilities: ["web.search"],
    headers,
  });

  const result = await executeWebSearch(ctx, query);

  const metadata: ToolMetadata = {
    tool: "web_search",
    provider: "brave_search",
    realtime: true,
    location: null,
  };

  if (result.success) {
    return {
      executed: true,
      toolId: "web_search",
      text: result.formatted,
      metadata,
      raw: result,
    };
  }

  return {
    executed: true,
    toolId: "web_search",
    text: result.error,
    metadata,
    raw: result,
  };
}
