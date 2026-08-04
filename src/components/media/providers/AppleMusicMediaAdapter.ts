/**
 * AppleMusicMediaAdapter — uses Apple MusicKit JS for embedding
 * Apple Music content. Feature-flagged because it requires an
 * Apple Developer account and a server-side JWT token.
 *
 * @see https://developer.apple.com/documentation/musickitjs
 */

import type {
  MediaAdapter,
  MediaCapabilities,
  MediaItem,
  MediaPlaybackState,
} from "../media-types";
import { extractAppleMusicId } from "../parse-media-url";

const MUSICKIT_SCRIPT_SRC = "https://js.music.apple.com/musickitjs/1/musickit.js";

// ── MusicKit JS types (minimal subset) ────────────────────────────

interface MusicKitConfiguration {
  developerToken: string;
  app: { name: string; build: string };
}

interface MusicKitMediaItem {
  id: string;
  type: string;
  attributes: {
    name: string;
    artistName: string;
    artwork?: { url: string };
    albumName?: string;
    durationInMillis?: number;
  };
}

interface MusicKitPlayer {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  volume: number;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  isPlaying: boolean;
}

interface MusicKitInstance {
  player: MusicKitPlayer;
  setQueueItem: (item: MusicKitMediaItem) => void;
  playNext: (item: MusicKitMediaItem) => void;
  playLater: (item: MusicKitMediaItem) => void;
}

interface MusicKitStatic {
  configure(config: MusicKitConfiguration): Promise<MusicKitInstance>;
  getInstance(): MusicKitInstance;
  MediaItem: new (item: Partial<MusicKitMediaItem>) => MusicKitMediaItem;
}

declare global {
  interface Window {
    MusicKit?: MusicKitStatic;
  }
}

// ── Adapter implementation ───────────────────────────────────────

type Listener = (state: MediaPlaybackState) => void;

export class AppleMusicMediaAdapter implements MediaAdapter {
  id = "apple-music" as const;
  capabilities: MediaCapabilities = {
    seek: true,
    volume: true,
    queue: true,
    video: false,
    playlists: true,
  };

  private listeners = new Set<Listener>();
  private musicKitInstance: MusicKitInstance | null = null;
  private hostElement: HTMLElement | null = null;
  private apiLoaded = false;
  private apiLoading = false;
  private configured = false;
  private currentItem: MediaItem | null = null;
  private volume = 70;
  private muted = false;
  private positionMs = 0;
  private durationMs = 0;
  private status: MediaPlaybackState["status"] = "idle";
  private error: string | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try { listener(state); } catch { /* non-fatal */ }
    }
  }

  private getState(): MediaPlaybackState {
    return {
      status: this.status,
      item: this.currentItem,
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      volume: this.volume,
      muted: this.muted,
      error: this.error,
    };
  }

  // ── API script loading ────────────────────────────────────────

  private loadApi(): Promise<void> {
    if (this.apiLoaded) return Promise.resolve();
    if (this.apiLoading) {
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.apiLoaded) { clearInterval(check); resolve(); }
        }, 100);
      });
    }

    this.apiLoading = true;
    this.status = "loading";
    this.emit();

    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("Not in browser"));
        return;
      }

      const existing = document.querySelector(`script[src="${MUSICKIT_SCRIPT_SRC}"]`);
      if (existing) {
        if (window.MusicKit) {
          this.apiLoaded = true;
          this.apiLoading = false;
          resolve();
        }
        return;
      }

      const script = document.createElement("script");
      script.src = MUSICKIT_SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        this.apiLoaded = true;
        this.apiLoading = false;
        resolve();
      };
      script.onerror = () => {
        this.apiLoading = false;
        this.status = "error";
        this.error = "Failed to load Apple MusicKit JS.";
        this.emit();
        reject(new Error("Failed to load MusicKit JS"));
      };
      document.head.appendChild(script);
    });
  }

  // ── Mount / destroy ───────────────────────────────────────────

  async mount(element: HTMLElement): Promise<void> {
    if (this.musicKitInstance) return;

    this.hostElement = element;

    try {
      await this.loadApi();
    } catch {
      return;
    }

    if (!window.MusicKit) {
      this.status = "error";
      this.error = "MusicKit JS not available.";
      this.emit();
      return;
    }

    // Fetch the developer token from our API
    try {
      const res = await fetch("/api/media/apple/token");
      if (!res.ok) {
        this.status = "error";
        this.error = "Apple Music not configured. Requires an Apple Developer account.";
        this.emit();
        return;
      }
      const { developerToken } = await res.json();
      if (!developerToken) {
        this.status = "error";
        this.error = "Apple Music token not available.";
        this.emit();
        return;
      }

      this.musicKitInstance = await window.MusicKit.configure({
        developerToken,
        app: { name: "LiTTree Lab Studios", build: "1.0.0" },
      });
      this.configured = true;
      this.status = "ready";
      this.error = null;
      this.emit();
      this.startProgressPolling();
    } catch {
      this.status = "error";
      this.error = "Failed to configure Apple Music.";
      this.emit();
    }
  }

  destroy(): void {
    this.stopProgressPolling();
    this.musicKitInstance = null;
    this.configured = false;
    this.hostElement = null;
    this.status = "idle";
    this.emit();
  }

  private startProgressPolling() {
    if (this.progressInterval) clearInterval(this.progressInterval);
    this.progressInterval = setInterval(() => {
      if (!this.musicKitInstance) return;
      const player = this.musicKitInstance.player;
      this.positionMs = (player.currentPlaybackTime || 0) * 1000;
      this.durationMs = (player.currentPlaybackDuration || 0) * 1000;
      if (player.isPlaying && this.status !== "playing") {
        this.status = "playing";
      }
      this.emit();
    }, 500);
  }

  private stopProgressPolling() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  // ── Load ──────────────────────────────────────────────────────

  async load(item: MediaItem): Promise<void> {
    this.currentItem = item;
    this.error = null;
    this.status = "loading";
    this.positionMs = 0;
    this.emit();

    if (!this.musicKitInstance || !window.MusicKit) return;

    const parsed = extractAppleMusicId(item.sourceUrl);
    if (!parsed) {
      this.status = "error";
      this.error = "Invalid Apple Music URL.";
      this.emit();
      return;
    }

    const mediaItem = new window.MusicKit.MediaItem({
      id: parsed.id,
      type: parsed.type,
      attributes: {
        name: item.title || "Apple Music Track",
        artistName: item.creator || "",
        albumName: item.album,
        durationInMillis: item.durationMs,
      },
    });

    this.musicKitInstance.setQueueItem(mediaItem);
    this.status = "ready";
    this.emit();
  }

  // ── Playback ──────────────────────────────────────────────────

  play() {
    if (this.musicKitInstance) void this.musicKitInstance.player.play();
  }

  pause() {
    if (this.musicKitInstance) this.musicKitInstance.player.pause();
  }

  toggle() {
    if (!this.musicKitInstance) return;
    if (this.musicKitInstance.player.isPlaying) this.pause();
    else this.play();
  }

  seek(milliseconds: number) {
    if (this.musicKitInstance) {
      this.musicKitInstance.player.seek(milliseconds / 1000);
    }
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.muted = this.volume === 0;
    if (this.musicKitInstance) {
      this.musicKitInstance.player.volume = this.volume / 100;
    }
    this.emit();
  }
}
