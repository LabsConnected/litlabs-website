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
import { getUserContext } from "./user-context";
import {
  fetchWeatherForUser,
  type WeatherToolResponse,
} from "./weather-tool";

/* ── Types ──────────────────────────────────────────────────────── */

export type ToolId = "weather" | "none";

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
  raw?: WeatherToolResponse;
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
 * Detects any tool intent from the message.
 * Returns the tool id + refined intent, or null if no tool matches.
 */
export function detectToolIntent(message: string): { tool: ToolId; weatherType?: "current" | "hourly" | "daily" } | null {
  const weatherType = detectWeatherIntent(message);
  if (weatherType) return { tool: "weather", weatherType };
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
): Promise<ToolExecutionResult> {
  const intent = detectToolIntent(message);
  if (!intent) {
    return {
      executed: false,
      toolId: "none",
      text: "",
      metadata: { tool: "none", provider: "", realtime: false, location: null },
    };
  }

  if (intent.tool === "weather") {
    return executeWeatherTool(userId, message, intent.weatherType ?? "current");
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
): Promise<ToolExecutionResult> {
  const ctx = await getUserContext(userId, {
    capabilities: ["weather.current", "weather.hourly", "weather.daily"],
  });

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
