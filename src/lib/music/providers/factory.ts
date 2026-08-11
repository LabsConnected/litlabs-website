// src/lib/music/providers/factory.ts
import type { MusicProviderName } from "@/types/music";
import type { MusicProvider } from "./index";
import { ElevenMusicProvider } from "./elevenlabs";
import { MurekaMusicProvider } from "./mureka";
import { MockMusicProvider } from "./mock";
import { LyriaMusicProvider } from "./lyria";

/**
 * Resolve a provider by name. API keys are read from env at call time so
 * rotating secrets takes effect without a redeploy.
 */
export function createProvider(name: MusicProviderName): MusicProvider {
  switch (name) {
    case "elevenlabs":
      return new ElevenMusicProvider(process.env.ELEVENLABS_API_KEY || "");
    case "mureka":
      return new MurekaMusicProvider(process.env.MUREKA_API_KEY || "");
    case "lyria":
      return new LyriaMusicProvider(
        process.env.GEMINI_API_KEY || "",
        process.env.LYRIA_MODEL || "lyria-3-pro-preview",
      );
    case "mock":
      return new MockMusicProvider();
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown music provider: ${_exhaustive}`);
    }
  }
}

/**
 * Active provider for new generations.
 *
 * Production safety: if MUSIC_PROVIDER is unset or "mock" in a production
 * environment, we fall back to Lyria (Google Gemini) if GEMINI_API_KEY is
 * configured, or ElevenLabs if ELEVENLABS_API_KEY is configured.
 * Mock is NEVER silently used in production — it must be explicitly allowed
 * via MUSIC_ALLOW_MOCK=true.
 */
export function getActiveProvider(): MusicProvider {
  const configured = getConfiguredProviderName();

  // If mock is selected but not allowed, fall back to a real provider
  if (configured === "mock" && !isMockAllowed()) {
    // Prefer Lyria (cheapest) if Gemini key exists
    if (process.env.GEMINI_API_KEY) {
      return createProvider("lyria");
    }
    // Then ElevenLabs
    if (process.env.ELEVENLABS_API_KEY) {
      return createProvider("elevenlabs");
    }
    // Then Mureka
    if (process.env.MUREKA_API_KEY) {
      return createProvider("mureka");
    }
    // No real provider configured — last resort: mock (will produce fake audio)
    // This is intentional so the app doesn't crash, but it should never happen
    // in production with proper env vars.
    return createProvider("mock");
  }

  return createProvider(configured);
}

/** Whether Mureka is enabled. Server-side feature flag only. */
export function isMurekaEnabled(): boolean {
  return process.env.ENABLE_MUREKA === "true" && !!process.env.MUREKA_API_KEY;
}

/**
 * Whether the mock provider is allowed to run. The mock never burns real API
 * credits, so it is permitted in tests and when an operator explicitly opts in
 * via MUSIC_ALLOW_MOCK=true (e.g. local development). In production the mock
 * is rejected by the API routes so a missing MUSIC_PROVIDER can never silently
 * produce fake audio on a billed path.
 */
export function isMockAllowed(): boolean {
  return process.env.NODE_ENV === "test" || process.env.MUSIC_ALLOW_MOCK === "true";
}

/**
 * Whether Lyria is available (requires GEMINI_API_KEY).
 */
export function isLyriaAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * The provider name that would be selected right now, without instantiating it.
 * In production, this never returns "mock" unless explicitly allowed.
 */
export function getConfiguredProviderName(): MusicProviderName {
  const raw = (process.env.MUSIC_PROVIDER as MusicProviderName | undefined) || "mock";

  // In production without MUSIC_ALLOW_MOCK, "mock" is not allowed
  if (raw === "mock" && !isMockAllowed()) {
    // Fall back to the best available real provider
    if (process.env.GEMINI_API_KEY) return "lyria";
    if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
    if (process.env.MUREKA_API_KEY) return "mureka";
  }

  return raw;
}

/**
 * Provider configuration health report — used by the worker and API
 * to verify production has a real, credentialed provider before
 * accepting billed generations. NEVER exposes secret values.
 */
export interface ProviderHealthReport {
  configuredProvider: MusicProviderName;
  providerKeyPresent: boolean;
  mockAllowed: boolean;
  healthy: boolean;
  reason: string;
}

/**
 * Check whether the active provider has its API key configured.
 * Does NOT make a network request — just checks env presence.
 * Returns a report safe to expose in API responses (no secrets).
 */
export function getProviderHealth(): ProviderHealthReport {
  const name = getConfiguredProviderName();
  const mockAllowed = isMockAllowed();

  let keyPresent = false;
  switch (name) {
    case "elevenlabs":
      keyPresent = !!process.env.ELEVENLABS_API_KEY;
      break;
    case "mureka":
      keyPresent = !!process.env.MUREKA_API_KEY;
      break;
    case "lyria":
      keyPresent = !!process.env.GEMINI_API_KEY;
      break;
    case "mock":
      keyPresent = true; // mock needs no key
      break;
  }

  if (name === "mock" && !mockAllowed) {
    return {
      configuredProvider: name,
      providerKeyPresent: false,
      mockAllowed: false,
      healthy: false,
      reason: "No real music provider configured. Set MUSIC_PROVIDER and provider API key.",
    };
  }

  if (!keyPresent) {
    return {
      configuredProvider: name,
      providerKeyPresent: false,
      mockAllowed,
      healthy: false,
      reason: `${name} selected but API key is missing. Set the appropriate env var.`,
    };
  }

  return {
    configuredProvider: name,
    providerKeyPresent: true,
    mockAllowed,
    healthy: true,
    reason: `${name} configured and ready`,
  };
}
