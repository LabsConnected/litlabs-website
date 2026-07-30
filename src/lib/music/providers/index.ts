// src/lib/music/providers/index.ts
// Provider abstraction for music generation. The frontend never talks to
// providers directly — all communication goes through server-side API routes.

import type {
  GenerateSongInput,
  GenerationStatus,
  MusicProviderName,
  ProviderGenerationResult,
  ProviderStatusResult,
} from "@/types/music";

export interface MusicProvider {
  readonly name: MusicProviderName;
  readonly supportsStreaming: boolean;
  readonly supportsAsyncPolling: boolean;

  /** Kick off a generation. May return audio directly (streaming) or a job id (async). */
  generateSong(input: GenerateSongInput & { blueprint: unknown }): Promise<ProviderGenerationResult>;

  /** Poll an async job. Only called when supportsAsyncPolling is true. */
  getStatus(providerJobId: string): Promise<ProviderStatusResult>;

  /** Best-effort cancel. Returns true if the provider accepted the cancel. */
  cancel(providerJobId: string): Promise<boolean>;
}

export { ElevenMusicProvider } from "./elevenlabs";
export { MurekaMusicProvider } from "./mureka";
export { MockMusicProvider } from "./mock";

export type { GenerationStatus, MusicProviderName };
