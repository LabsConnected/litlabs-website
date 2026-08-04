/**
 * SpotifyMediaAdapter — wraps the Spotify Embed iFrame API into the
 * provider-neutral MediaAdapter interface.
 *
 * Uses the Spotify Embed iFrame API (NOT the Web Playback SDK) to
 * avoid requiring Spotify Premium or OAuth. Supports pasted links
 * for tracks, albums, artists, playlists, podcast shows, and episodes.
 *
 * @see https://developer.spotify.com/documentation/embeds/references/iframe-api
 */

import type {
  MediaAdapter,
  MediaCapabilities,
  MediaItem,
  MediaPlaybackState,
} from "../media-types";

// ── Spotify IFrame API types (subset) ────────────────────────────

const EMBED_SCRIPT_SRC = "https://open.spotify.com/embed-api/iframe-api/v1";

interface SpotifyEmbedController {
  loadUri(uri: string): void;
  play(): void;
  pause(): void;
  resume(): void;
  togglePlay(): void;
  restart(): void;
  seek(positionMs: number): void;
  setVolume(volume: number): void;
  destroy(): void;
}

interface SpotifyIframeAPI {
  createController(
    element: HTMLElement,
    options: { uri?: string; width?: string | number; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void,
  ): void;
}

interface SpotifyEmbedEvent {
  type: "ready" | "playback_started" | "playback_update" | "playback_paused";
  payload?: {
    position?: number;
    duration?: number;
    isPaused?: boolean;
  };
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (IFrameAPI: SpotifyIframeAPI) => void;
    SpotifyIframeAPI?: SpotifyIframeAPI;
  }
}

// ── Adapter implementation ───────────────────────────────────────

type Listener = (state: MediaPlaybackState) => void;

export class SpotifyMediaAdapter implements MediaAdapter {
  id = "spotify" as const;
  capabilities: MediaCapabilities = {
    seek: false, // Embed API seek is limited
    volume: true,
    queue: true,
    video: false,
    playlists: true,
  };

  private listeners = new Set<Listener>();
  private controller: SpotifyEmbedController | null = null;
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

  // ── Subscription ──────────────────────────────────────────────

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

  private loadApi(): Promise<SpotifyIframeAPI> {
    if (this.apiLoaded && window.SpotifyIframeAPI) {
      return Promise.resolve(window.SpotifyIframeAPI);
    }
    if (this.apiLoading) {
      return new Promise((resolve, reject) => {
        const check = setInterval(() => {
          if (this.apiLoaded && window.SpotifyIframeAPI) {
            clearInterval(check);
            resolve(window.SpotifyIframeAPI);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(check);
          reject(new Error("Spotify Embed API load timeout"));
        }, 10000);
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

      const prevCallback = window.onSpotifyIframeApiReady;
      window.onSpotifyIframeApiReady = (api: SpotifyIframeAPI) => {
        this.apiLoaded = true;
        this.apiLoading = false;
        window.SpotifyIframeAPI = api;
        if (prevCallback) { try { prevCallback(api); } catch { /* ignore */ } }
        resolve(api);
      };

      const existing = document.querySelector(`script[src="${EMBED_SCRIPT_SRC}"]`);
      if (existing) {
        if (window.SpotifyIframeAPI) {
          this.apiLoaded = true;
          this.apiLoading = false;
          resolve(window.SpotifyIframeAPI);
        }
        return;
      }

      const script = document.createElement("script");
      script.src = EMBED_SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        this.apiLoading = false;
        this.status = "error";
        this.error = "Failed to load Spotify Embed API.";
        this.emit();
        reject(new Error("Failed to load Spotify Embed API"));
      };
      document.head.appendChild(script);
    });
  }

  // ── Mount / destroy ───────────────────────────────────────────

  async mount(element: HTMLElement): Promise<void> {
    if (this.controller) return;

    this.hostElement = element;

    let api: SpotifyIframeAPI;
    try {
      api = await this.loadApi();
    } catch {
      return;
    }

    this.status = "loading";
    this.emit();

    const initialUri = this.currentItem
      ? urlToSpotifyUri(this.currentItem.sourceUrl)
      : undefined;

    api.createController(
      element,
      {
        uri: initialUri ?? undefined,
        width: "100%",
        height: "100%",
      },
      (controller) => {
        this.controller = controller;
        this.status = "ready";
        this.error = null;
        this.emit();
      },
    );
  }

  destroy(): void {
    if (this.controller) {
      try { this.controller.destroy(); } catch { /* ignore */ }
      this.controller = null;
    }
    this.hostElement = null;
    this.status = "idle";
    this.emit();
  }

  // ── Load ──────────────────────────────────────────────────────

  async load(item: MediaItem): Promise<void> {
    this.currentItem = item;
    this.error = null;
    this.status = "loading";
    this.emit();

    const uri = urlToSpotifyUri(item.sourceUrl);
    if (this.controller && uri) {
      this.controller.loadUri(uri);
    }
  }

  // ── Playback ──────────────────────────────────────────────────

  play() {
    if (this.controller) this.controller.play();
  }

  pause() {
    if (this.controller) this.controller.pause();
  }

  toggle() {
    if (this.controller) this.controller.togglePlay();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.muted = this.volume === 0;
    if (this.controller) this.controller.setVolume(this.volume);
    this.emit();
  }

  // ── Event handler (called by the embed iframe via postMessage) ─

  handleEmbedEvent(event: SpotifyEmbedEvent) {
    switch (event.type) {
      case "ready":
        this.status = "ready";
        this.error = null;
        break;
      case "playback_started":
        this.status = "playing";
        this.error = null;
        break;
      case "playback_paused":
        this.status = "paused";
        break;
      case "playback_update":
        if (event.payload) {
          this.positionMs = event.payload.position ?? this.positionMs;
          this.durationMs = event.payload.duration ?? this.durationMs;
          this.status = event.payload.isPaused ? "paused" : "playing";
        }
        break;
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

/**
 * Convert a Spotify web URL to a Spotify URI.
 *   https://open.spotify.com/track/XYZ → spotify:track:XYZ
 */
function urlToSpotifyUri(url: string): string | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    // e.g. ["track", "XYZ"] or ["playlist", "ABC"] or ["episode", "DEF"]
    if (parts.length >= 2) {
      return `spotify:${parts[0]}:${parts[1]}`;
    }
  } catch {
    // not a URL
  }
  return null;
}
