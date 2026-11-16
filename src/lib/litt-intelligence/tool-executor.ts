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
  executeWebFetch,
  type WebSearchToolResponse,
  type WebFetchToolResponse,
} from "./web-search-tool";
import {
  executePlacesLookup,
  type PlacesToolResponse,
} from "./places-tool";
import {
  runOneShotScreenshot,
  detectScreenshotIntent,
  extractScreenshotUrl,
} from "./browser-agent";
import type { ConversationTurn } from "./turn-resolver";

/* ── Types ──────────────────────────────────────────────────────── */

export type ToolId = "weather" | "web_search" | "web_fetch" | "browser_screenshot" | "places" | "none";

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
  raw?: WeatherToolResponse | WebSearchToolResponse | WebFetchToolResponse | PlacesToolResponse;
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
/** Extract the first http(s) URL from a message, or null. */
export function extractFetchUrl(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  // Trim trailing sentence punctuation that isn't part of the URL.
  return match[0].replace(/[.,;:!?]+$/, "");
}

const WEB_FETCH_VERBS =
  /\b(fetch|read|open|visit|summarize|summarise|check|load|get|show|pull|grab|download)\b/i;

/**
 * Detects an explicit "fetch this URL" intent: the message contains an
 * http(s) URL and either asks to fetch/read/open/summarize it, or the
 * message is (essentially) just the URL itself.
 */
export function detectWebFetchIntent(message: string): boolean {
  const url = extractFetchUrl(message);
  if (!url) return false;
  const rest = message.replace(url, "").trim();
  if (rest.length <= 3) return true; // bare URL (plus punctuation)
  return WEB_FETCH_VERBS.test(rest);
}

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

/** Nouns that indicate a Studio UI/navigation request, not a places lookup. */
const PLACES_EXCLUDE_NOUNS =
  /\b(file|files|terminal|approval|approvals|settings|panel|project|repo|repository|branch|deploy|deployment|editor|code|component|task|pr|pull request|screenshot|screen shot|section|footer|header|website|page)\b/i;

const PLACES_INHERENT_PATTERNS = [
  /\b(?:what time does|what time is|when does|when is)\b[^.!?]{0,60}\b(?:open|close|closes|opens|closed)\b/i,
  /\bis\b[^.!?]{0,40}\bopen\b[^.!?]{0,20}\b(?:now|today|right now|still)\b/i,
];

// These patterns can appear inside ordinary (non-question) sentences —
// e.g. site-editing content like "Add a section with our store hours"
// or "Update the footer to say we open at 9am" — so they only count
// when the message is actually phrased as a question. Without this
// gate they hijacked normal Studio build/edit requests into a places
// lookup, dropping the user's real request before it ever reached the
// agent loop.
const PLACES_CONTEXT_PATTERNS = [
  /\b(?:opening hours|business hours|store hours)\b/i,
  /\bcloses?\s+at\b/i,
  /\bopens?\s+at\b/i,
];

const PLACES_QUESTION_FORM = /^\s*(?:what|when|is|are|does|how late)\b/i;

function looksLikeQuestion(message: string): boolean {
  return PLACES_QUESTION_FORM.test(message) || /\?\s*$/.test(message.trim());
}

/**
 * Detects whether a user message asks about a business/place's hours,
 * address, or open-now status (e.g. "What time does Best Buy open?").
 * Excludes Studio UI/navigation phrases ("open the terminal") and
 * weather questions, which are handled by their own tools.
 */
export function detectPlacesIntent(message: string): boolean {
  const lower = message.toLowerCase();
  if (PLACES_EXCLUDE_NOUNS.test(lower)) return false;
  if (WEATHER_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  if (PLACES_INHERENT_PATTERNS.some((p) => p.test(message))) return true;
  return looksLikeQuestion(message) && PLACES_CONTEXT_PATTERNS.some((p) => p.test(message));
}

/**
 * Extracts the business/place name from a places-intent message.
 * Falls back to the full message if no pattern matches.
 */
export function extractPlaceQuery(message: string): string {
  const patterns = [
    /(?:what time does|what time is|when does|when is)\s+(.+?)\s+(?:open|close|closes|opens|closed)\b/i,
    /\bis\s+(.+?)\s+open\b/i,
    // Anchored to a capitalized-word run (the business name), not an
    // unanchored lazy ".+?" — the lazy version matched too much of the
    // leading question clause (e.g. "What are Target's store hours?"
    // extracted "What are Target" instead of "Target") because nothing
    // stopped it from swallowing "What are" before the possessive "'s".
    /\b([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,3})(?:'s)?\s+(?:opening hours|business hours|store hours)\b/,
    /(.+?)\s+closes?\s+at\b/i,
    /(.+?)\s+opens?\s+at\b/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1] && match[1].trim().length > 1) {
      return match[1].trim();
    }
  }

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

  // Check for places intent (business hours, address, open-now) before
  // web search/fetch: a specific "what time does X open" question is a
  // more specific instruction than a generic search keyword match.
  if (detectPlacesIntent(message)) {
    return { tool: "places" };
  }

  // Check for explicit URL fetch intent ("read https://…", a bare URL, …).
  // Runs before web search: a concrete URL is a more specific instruction
  // than a keyword-matched search.
  if (detectWebFetchIntent(message)) {
    return { tool: "web_fetch" };
  }

  // Check for web search intent
  if (detectWebSearchIntent(message)) {
    return { tool: "web_search" };
  }

  // Check for browser screenshot intent ("screenshot example.com").
  // Runs after weather/web-search so those keep priority on overlap.
  if (detectScreenshotIntent(message)) {
    return { tool: "browser_screenshot" };
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

  if (intent.tool === "places") {
    return executePlacesTool(userId, message, options?.headers);
  }

  if (intent.tool === "web_fetch") {
    return executeWebFetchTool(userId, message, options?.headers);
  }

  if (intent.tool === "web_search") {
    return executeWebSearchTool(userId, message, options?.headers);
  }

  if (intent.tool === "browser_screenshot") {
    return executeBrowserScreenshotTool(userId, message);
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
 * Executes the places tool for a user: resolves business hours,
 * address, and open-now status for a named place.
 */
async function executePlacesTool(
  userId: string,
  message: string,
  headers?: Headers,
): Promise<ToolExecutionResult> {
  const query = extractPlaceQuery(message);

  const ctx = await getUserContext(userId, {
    capabilities: ["places.search"],
    headers,
  });

  const result: PlacesToolResponse = await executePlacesLookup(ctx, query);

  const metadata: ToolMetadata = {
    tool: "places",
    provider: "google_places",
    realtime: true,
    location: null,
  };

  if (result.success) {
    return {
      executed: true,
      toolId: "places",
      text: result.formatted,
      metadata,
      raw: result,
    };
  }

  return {
    executed: true,
    toolId: "places",
    text: result.error,
    metadata,
    raw: result,
  };
}

/**
 * Executes the web fetch tool for a user: reads the content of the URL
 * named in the message via the SSRF-safe agent-core fetch.
 */
async function executeWebFetchTool(
  userId: string,
  message: string,
  headers?: Headers,
): Promise<ToolExecutionResult> {
  const url = extractFetchUrl(message);
  if (!url) {
    return {
      executed: false,
      toolId: "none",
      text: "",
      metadata: { tool: "none", provider: "", realtime: false, location: null },
    };
  }

  const ctx = await getUserContext(userId, {
    capabilities: ["web.fetch"],
    headers,
  });

  const result = await executeWebFetch(ctx, url);

  const metadata: ToolMetadata = {
    tool: "web_fetch",
    provider: "agent_core_safe_fetch",
    realtime: true,
    location: null,
  };

  if (result.success) {
    return {
      executed: true,
      toolId: "web_fetch",
      text: result.formatted,
      metadata,
      raw: result,
    };
  }

  return {
    executed: true,
    toolId: "web_fetch",
    text: `I couldn't fetch that page: ${result.error}`,
    metadata,
    raw: result,
  };
}

/**
 * Executes the web search tool for a user.
 * Uses Brave when BRAVE_SEARCH_API_KEY is configured; otherwise the
 * keyless agent-core search (see web-search-tool.ts) — search no longer
 * silently no-ops when the optional key is absent.
 */
async function executeWebSearchTool(
  userId: string,
  message: string,
  headers?: Headers,
): Promise<ToolExecutionResult> {
  const query = extractSearchQuery(message);

  const ctx = await getUserContext(userId, {
    capabilities: ["web.search"],
    headers,
  });

  const result: WebSearchToolResponse = await executeWebSearch(ctx, query);

  const metadata: ToolMetadata = {
    tool: "web_search",
    provider: result.success ? result.provider : "brave_search",
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

/**
 * Executes the agent-browser one-shot screenshot for a user.
 * Honest by design: every failure (beta gate, missing API key, bad URL,
 * navigation failure) returns the real cause as text — never an image.
 * On success the screenshot is embedded as a data URL; the Studio client
 * already routes data:image message content to the Media tab.
 */
async function executeBrowserScreenshotTool(
  userId: string,
  message: string,
): Promise<ToolExecutionResult> {
  const metadata: ToolMetadata = {
    tool: "browser_screenshot",
    provider: "browserbase",
    realtime: true,
    location: null,
  };

  const rawUrl = extractScreenshotUrl(message);
  if (!rawUrl) {
    return {
      executed: true,
      toolId: "browser_screenshot",
      text: 'Which site should I screenshot? Send a URL, like "screenshot example.com".',
      metadata,
    };
  }

  const result = await runOneShotScreenshot(userId, rawUrl);
  if (!result.ok || !result.screenshotDataUrl) {
    return {
      executed: true,
      toolId: "browser_screenshot",
      text: result.message,
      metadata,
    };
  }

  const label = result.pageTitle
    ? `${result.url} ("${result.pageTitle}")`
    : result.url;
  return {
    executed: true,
    toolId: "browser_screenshot",
    text:
      `Here's a snapshot of ${label} — captured just now (a snapshot, not a live view):\n\n` +
      `![screenshot of ${result.url}](${result.screenshotDataUrl})`,
    metadata,
  };
}
