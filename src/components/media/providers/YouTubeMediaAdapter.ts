/**
 * YouTubeMediaAdapter — wraps the existing YouTube IFrame Player API
 * into the provider-neutral MediaAdapter interface.
 *
 * This adapter owns ONE YouTube player instance that persists across
 * route changes. It is never destroyed/recreated because the user
 * navigated between Studio tabs.
 */

import type {
  MediaAdapter,
  MediaCapabilities,
  MediaItem,
  MediaPlaybackState,
} from "../media-types";
import {
  extractYouTubeVideoId,
  extractYouTubePlaylistId,
  getYouTubeThumbnail,
} from "../parse-media-url";
import type { YTPlayerInstance } from "@/lib/youtube/types";

// ── YouTube IFrame API types ─────────────────────────────────────
// Reuse the existing window.YT augmentation from src/lib/youtube/types.ts

const API_SCRIPT_SRC = "https://www.youtube.com/iframe_api";

const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video ID or parameter.",
  5: "HTML5 player error.",
  100: "Video not found or has been removed.",
  101: "This video does not permit embedding.",
  150: "This video does not permit embedding.",
  153: "Video playback blocked due to missing client identification.",
};

// ── Adapter implementation ───────────────────────────────────────

type Listener = (state: MediaPlaybackState) => void;

export class YouTubeMediaAdapter implements MediaAdapter {
  id = "youtube" as const;
  capabilities: MediaCapabilities = {
    seek: true,
    volume: true,
    queue: true,
    video: true,
    playlists: true,
  };

  private listeners = new Set<Listener>();
  private player: YTPlayerInstance | null = null;
  private hostElement: HTMLElement | null = null;
  private apiLoaded = false;
  private apiLoading = false;
  private currentItem: MediaItem | null = null;
  private volume = 70;
  private muted = false;
  private positionMs = 0;
  private durationMs = 0;
  private status: MediaPlaybackState["status"] = "idle";
  private error: string | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;

  // ── Subscription ──────────────────────────────────────────────

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Emit current state immediately
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

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        this.apiLoaded = true;
        this.apiLoading = false;
        if (prevCallback) { try { prevCallback(); } catch { /* ignore */ } }
        resolve();
      };

      const existing = document.querySelector(`script[src="${API_SCRIPT_SRC}"]`);
      if (existing) {
        if (window.YT?.Player) {
          this.apiLoaded = true;
          this.apiLoading = false;
          resolve();
        }
        return;
      }

      const script = document.createElement("script");
      script.src = API_SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        this.apiLoading = false;
        this.status = "error";
        this.error = "Failed to load YouTube IFrame API.";
        this.emit();
        reject(new Error("Failed to load YouTube IFrame API"));
      };
      document.head.appendChild(script);
    });
  }

  // ── Mount / destroy ───────────────────────────────────────────

  async mount(element: HTMLElement): Promise<void> {
    if (this.player) return; // already mounted

    this.hostElement = element;

    if (!this.apiLoaded) {
      try {
        await this.loadApi();
      } catch {
        return; // error already emitted
      }
    }

    if (!window.YT?.Player) {
      this.status = "error";
      this.error = "YouTube IFrame API not available.";
      this.emit();
      return;
    }

    this.status = "loading";
    this.emit();

    const initialVideoId = this.currentItem
      ? extractYouTubeVideoId(this.currentItem.sourceUrl) ?? undefined
      : undefined;

    this.player = new window.YT.Player(element, {
      width: "100%",
      height: "100%",
      videoId: initialVideoId,
      playerVars: {
        autoplay: 0,
        controls: 1,
        enablejsapi: 1,
        playsinline: 1,
        origin: typeof window !== "undefined" ? window.location.origin : undefined,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady: (event) => this.handleReady(event.target),
        onStateChange: (event) => this.handleStateChange(event.data),
        onError: (event) => this.handleError(event.data),
        onAutoplayBlocked: () => {
          // Autoplay was blocked — user must interact to play.
          // Don't show an error; just reflect paused state.
          this.status = "paused";
          this.emit();
        },
      },
    });
  }

  destroy(): void {
    this.stopProgressPolling();
    if (this.player) {
      try { this.player.destroy(); } catch { /* ignore */ }
      this.player = null;
    }
    this.hostElement = null;
    this.status = "idle";
    this.emit();
  }

  // ── Event handlers ────────────────────────────────────────────

  private handleReady(player: YTPlayerInstance) {
    this.status = "ready";
    this.error = null;
    player.setVolume(this.volume);
    if (this.muted) player.mute();
    else player.unMute();

    this.startProgressPolling();
    this.refreshVideoData();
    this.emit();
  }

  private handleStateChange(ytState: number) {
    switch (ytState) {
      case YT_STATE.PLAYING:
        this.status = "playing";
        this.error = null;
        this.refreshVideoData();
        break;
      case YT_STATE.PAUSED:
        this.status = "paused";
        break;
      case YT_STATE.BUFFERING:
        this.status = "buffering";
        break;
      case YT_STATE.ENDED:
        this.status = "idle";
        break;
      case YT_STATE.CUED:
        this.status = "ready";
        this.refreshVideoData();
        break;
      case YT_STATE.UNSTARTED:
        // Don't change state on unstarted
        break;
    }
    this.emit();
  }

  private handleError(code: number) {
    this.status = "error";
    this.error = ERROR_MESSAGES[code] || `YouTube player error (${code}).`;
    this.emit();
  }

  private refreshVideoData() {
    if (!this.player) return;
    try {
      const data = this.player.getVideoData();
      if (data?.video_id && this.currentItem) {
        this.currentItem = {
          ...this.currentItem,
          title: data.title || this.currentItem.title,
          creator: data.author || this.currentItem.creator,
          artworkUrl: getYouTubeThumbnail(data.video_id),
        };
      }
    } catch {
      // getVideoData may fail if no video is loaded
    }
  }

  private startProgressPolling() {
    if (this.progressInterval) clearInterval(this.progressInterval);
    this.progressInterval = setInterval(() => {
      if (!this.player) return;
      try {
        const currentTime = this.player.getCurrentTime() || 0;
        const duration = this.player.getDuration() || 0;
        this.positionMs = Math.round(currentTime * 1000);
        this.durationMs = Math.round(duration * 1000);
        this.emit();
      } catch {
        // player may not be ready
      }
    }, 1000);
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
    this.emit();

    const videoId = extractYouTubeVideoId(item.sourceUrl);
    const playlistId = extractYouTubePlaylistId(item.sourceUrl);

    if (this.player) {
      if (playlistId && !videoId) {
        this.player.cuePlaylist(playlistId);
      } else if (videoId) {
        this.player.loadVideoById(videoId);
      }
    }
  }

  // ── Playback ──────────────────────────────────────────────────

  play() {
    if (this.player) this.player.playVideo();
  }

  pause() {
    if (this.player) this.player.pauseVideo();
  }

  toggle() {
    if (this.status === "playing") this.pause();
    else this.play();
  }

  seek(milliseconds: number) {
    if (this.player) this.player.seekTo(milliseconds / 1000, true);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.muted = this.volume === 0;
    if (this.player) {
      this.player.setVolume(this.volume);
      if (this.muted) this.player.mute();
      else this.player.unMute();
    }
    this.emit();
  }

  // ── Accessors ─────────────────────────────────────────────────

  getCurrentItem(): MediaItem | null {
    return this.currentItem;
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }
}
