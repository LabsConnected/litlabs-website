/**
 * LiTT Media Hub — shared types.
 *
 * Provider-neutral media system supporting YouTube, Spotify, SoundCloud,
 * Apple Music, direct audio files, and LiTT R2 assets.
 * The same types are used by the MediaHubProvider, all adapters,
 * and every UI component.
 */

export type MediaProviderId =
  | "youtube"
  | "spotify"
  | "soundcloud"
  | "apple-music"
  | "direct"
  | "litt";

export type MediaDockMode = "hidden" | "collapsed" | "expanded";

export type MediaPlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "buffering"
  | "error";

export interface MediaItem {
  id: string;
  provider: MediaProviderId;
  sourceUrl: string;
  title?: string;
  creator?: string;
  artworkUrl?: string;
  album?: string;
  durationMs?: number;
}

export interface MediaPlaybackState {
  status: MediaPlaybackStatus;
  item: MediaItem | null;
  positionMs: number;
  durationMs: number;
  volume: number;
  muted: boolean;
  error: string | null;
}

export interface MediaCapabilities {
  seek: boolean;
  volume: boolean;
  queue: boolean;
  video: boolean;
  playlists: boolean;
}

export interface MediaAdapter {
  id: MediaProviderId;
  capabilities: MediaCapabilities;

  mount(element: HTMLElement): Promise<void>;
  destroy(): void;

  load(item: MediaItem): Promise<void>;
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  toggle(): Promise<void> | void;

  seek?(milliseconds: number): Promise<void> | void;
  setVolume?(volume: number): Promise<void> | void;

  subscribe(
    listener: (state: MediaPlaybackState) => void,
  ): () => void;
}

export interface MediaPersistedState {
  activeProvider: MediaProviderId;
  queue: MediaItem[];
  currentIndex: number;
  volume: number;
  muted: boolean;
  dockMode: MediaDockMode;
  currentItem: MediaItem | null;
}

/**
 * All supported provider IDs in display order.
 */
export const ALL_PROVIDER_IDS: readonly MediaProviderId[] = [
  "youtube",
  "spotify",
  "soundcloud",
  "apple-music",
  "direct",
  "litt",
] as const;

/**
 * Human-readable label for each provider.
 */
export const PROVIDER_LABELS: Record<MediaProviderId, string> = {
  youtube: "YouTube",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
  "apple-music": "Apple Music",
  direct: "Direct Audio",
  litt: "LiTT",
};

/**
 * Brand color for each provider (used in badges/UI).
 */
export const PROVIDER_COLORS: Record<MediaProviderId, string> = {
  youtube: "#ff0000",
  spotify: "#1db954",
  soundcloud: "#ff5500",
  "apple-music": "#fa2d48",
  direct: "#888888",
  litt: "#00ffc8",
};
