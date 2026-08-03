// src/lib/music/providers/factory.ts
import type { MusicProviderName } from "@/types/music";
import type { MusicProvider } from "./index";
import { ElevenMusicProvider } from "./elevenlabs";
import { MurekaMusicProvider } from "./mureka";
import { MockMusicProvider } from "./mock";

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
    case "mock":
      return new MockMusicProvider();
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown music provider: ${_exhaustive}`);
    }
  }
}

/**
 * Active provider for new generations. Defaults to `mock` so the app never
 * accidentally burns real API credits. Set MUSIC_PROVIDER=elevenlabs in
 * production after the mock flow is verified.
 */
export function getActiveProvider(): MusicProvider {
  const configured = (process.env.MUSIC_PROVIDER as MusicProviderName | undefined) || "mock";
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

/** The provider name that would be selected right now, without instantiating it. */
export function getConfiguredProviderName(): MusicProviderName {
  return (process.env.MUSIC_PROVIDER as MusicProviderName | undefined) || "mock";
}
