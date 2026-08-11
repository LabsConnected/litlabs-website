// src/types/music.ts
// Music Lab types. `userId` is the internal public.users.id UUID (not clerk_id).

export type GenerationStatus =
  | "idle"
  | "queued"
  | "claimed"
  | "preparing"
  | "generating"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type MusicProviderName = "elevenlabs" | "mureka" | "lyria" | "mock";

export type TrackVisibility = "private" | "unlisted" | "public";

export interface MusicBlueprint {
  title: string;
  genre: string[];
  mood: string[];
  bpm?: number;
  key?: string;
  durationSeconds: number;
  instrumental: boolean;
  vocals?: {
    type: string;
    delivery: string;
    intensity: number;
  };
  structure: string[];
  production: string[];
  avoid: string[];
  instruments: string[];
  explicit: boolean;
  lyrics?: string;
  lyricInstructions?: string;
}

export interface GenerateSongInput {
  prompt: string;
  instrumental: boolean;
  durationSeconds: number;
  vocalType?: string;
  explicit?: boolean;
  referenceAudioUrl?: string;
  lyrics?: string;
  style?: string;
  energy?: number;
  idempotencyKey: string;
  compositionPlan?: CompositionPlan;
}

/** Shape returned by a provider after kicking off a generation. */
export interface ProviderGenerationResult {
  providerJobId?: string;
  providerSongId?: string;
  audioUrl?: string;
  status: GenerationStatus;
  estimatedCostCents: number;
  error?: string;
}

/** Shape returned by a provider when polling an async job. */
export interface ProviderStatusResult {
  status: GenerationStatus;
  audioUrl?: string;
  duration?: number;
  error?: string;
}

export interface GenerationJob {
  id: string;
  status: GenerationStatus;
  provider: MusicProviderName;
  providerJobId?: string;
  providerSongId?: string;
  estimatedCostCents: number;
  audioUrl?: string;
  duration?: number;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MusicTrack {
  id: string;
  userId: string;
  projectId: string | null;
  generationId: string;
  versionLabel: string;
  title: string;
  blueprint: MusicBlueprint;
  audioStorageKey: string;
  audioUrl?: string;
  waveformPeaks?: number[];
  duration: number;
  bpm?: number;
  key?: string;
  visibility: TrackVisibility;
  parentVersionId?: string;
  branchName?: string;
  lbcCharged: number;
  provider: MusicProviderName;
  providerModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SoundDna {
  favoriteGenres: string[];
  preferredBpmRange: [number, number];
  vocalStyle?: string;
  commonStructure: string[];
  energyPreference: number;
  likedInstruments: string[];
  rejectedInstruments: string[];
  previousPrompts: string[];
}

// ── ElevenLabs Music v2 Composition Plan types ─────────────────────────────

export type ContextAdherence = "low" | "medium" | "high";

export interface CompositionChunk {
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles?: string[];
  context_adherence?: ContextAdherence;
}

export interface CompositionPlan {
  chunks: CompositionChunk[];
  positive_global_styles: string[];
  negative_global_styles: string[];
}
