import "server-only";

import type { LLMProvider } from "@/lib/llm";
import { isLittPaidProvider } from "@/lib/llm";

/**
 * Demo lane configuration — all server-side, env-configurable with sane defaults.
 *
 * The demo lane is a REAL limited anonymous LiTT chat inside the Studio chrome.
 * Spend controls here are REAL and independent of billing (chargeLlmUsage is in
 * shadow mode and preflightBillingAuth is dead code) — the route pins the
 * provider to a free-tier model and enforces hard ceilings BEFORE any model
 * call.
 */

export interface DemoConfig {
  /** Master on/off for the demo lane. Default true. */
  enabled: boolean;
  /** Hard global kill switch. When set (1/true) the API 503s and the page
   *  renders a disabled state. Unset = off. */
  killSwitch: boolean;
  /** Max anonymous chat messages per demo session. Default 5, clamped 1..10. */
  maxMessages: number;
  /** Max completion tokens per demo reply. Default 1024, clamped 128..4096. */
  maxTokens: number;
  /** Server-pinned provider. Only free-tier ("included" cost class) providers
   *  are accepted; anything else falls back to "openrouter-free". */
  modelProvider: LLMProvider;
  /** demo_session cookie lifetime in seconds. Default 30 days. */
  sessionTtlSeconds: number;
  /** Per-session burst limit (requests per minute). Default 10. */
  sessionPerMinute: number;
  /** Per-IP burst limit (requests per minute). Default 20. */
  ipPerMinute: number;
  /** Max client history entries accepted per request. Default 20. */
  maxHistoryEntries: number;
  /** Max characters per user message. Default 4000. */
  maxMessageChars: number;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function parseIntClamped(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Providers the demo lane may ever pin. These are "included" cost-class
 * providers (free tier / :free OpenRouter slugs) that spend none of LiTT's
 * own money. Anything litt_paid (openai) is structurally rejected here —
 * an env misconfiguration can never route anonymous traffic to a paid key.
 */
const DEMO_PROVIDER_ALLOWLIST: readonly LLMProvider[] = [
  "openrouter-free",
  "gemini",
  "groq",
];

function resolveModelProvider(env: Partial<NodeJS.ProcessEnv>): LLMProvider {
  const raw = (env.DEMO_MODEL_PROVIDER ?? "openrouter-free").trim();
  const provider = raw as LLMProvider;
  if (
    (DEMO_PROVIDER_ALLOWLIST as readonly string[]).includes(raw) &&
    !isLittPaidProvider(provider)
  ) {
    return provider;
  }
  if (raw) {
    // Never silently route anonymous traffic to a paid/misconfigured provider.
    console.warn(
      `[demo] DEMO_MODEL_PROVIDER="${raw}" is not a free-tier provider — falling back to "openrouter-free".`,
    );
  }
  return "openrouter-free";
}

export function getDemoConfig(env: Partial<NodeJS.ProcessEnv> = process.env): DemoConfig {
  return {
    enabled: parseBool(env.DEMO_ENABLED, true),
    killSwitch: parseBool(env.DEMO_KILL_SWITCH, false),
    maxMessages: parseIntClamped(env.DEMO_MAX_MESSAGES, 5, 1, 10),
    maxTokens: parseIntClamped(env.DEMO_MAX_TOKENS, 1024, 128, 4096),
    modelProvider: resolveModelProvider(env),
    sessionTtlSeconds: parseIntClamped(
      env.DEMO_SESSION_TTL_SECONDS,
      30 * 24 * 60 * 60,
      60 * 60,
      365 * 24 * 60 * 60,
    ),
    sessionPerMinute: parseIntClamped(env.DEMO_SESSION_PER_MINUTE, 10, 1, 100),
    ipPerMinute: parseIntClamped(env.DEMO_IP_PER_MINUTE, 20, 1, 1000),
    maxHistoryEntries: parseIntClamped(env.DEMO_MAX_HISTORY_ENTRIES, 20, 1, 50),
    maxMessageChars: parseIntClamped(env.DEMO_MAX_MESSAGE_CHARS, 4000, 100, 20000),
  };
}

/** True when the demo lane should serve traffic (enabled AND not kill-switched). */
export function isDemoAvailable(env: Partial<NodeJS.ProcessEnv> = process.env): boolean {
  const cfg = getDemoConfig(env);
  return cfg.enabled && !cfg.killSwitch;
}

/** Exact copy shown when the anonymous message ceiling is reached. */
export { DEMO_LIMIT_MESSAGE } from "./constants";
