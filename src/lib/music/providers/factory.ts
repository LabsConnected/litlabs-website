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
