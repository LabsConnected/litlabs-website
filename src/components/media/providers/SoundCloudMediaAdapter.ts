/**
 * SoundCloudMediaAdapter — wraps the SoundCloud Widget API into the
 * provider-neutral MediaAdapter interface.
 *
 * Uses the SoundCloud Widget API (iframe-based) for embedding tracks
 * and sets. Supports seek, volume, and progress events.
 *
 * @see https://developers.soundcloud.com/docs/api/html5-widget
 */

import type {
  MediaAdapter,
  MediaCapabilities,
  MediaItem,
  MediaPlaybackState,
} from "../media-types";

// ── SoundCloud Widget API types ───────────────────────────────────

const WIDGET_SCRIPT_SRC = "https://w.soundcloud.com/player/api.js";

interface SoundCloudWidget {
  bind(eventName: string, callback: (data?: unknown) => void): void;
  unbind(eventName: string): void;
  load(url: string, options?: Record<string, unknown>): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(milliseconds: number): void;
  setVolume(volume: number): void;
  getDuration(): number;
  getPosition(): number;
  getCurrentSound(callback: (sound: SoundCloudSound | null) => void): void;
  destroy(): void;
}

interface SoundCloudSound {
  title: string;
  user: { username: string };
  artwork_url: string | null;
  duration: number;
}

interface SoundCloudWidgetEvent {
  loadedProgress: number;
  relativePosition: number;
  currentPosition: number;
}

declare global {
  interface Window {
    SC?: { Widget: { Events: Record<string, string> } };
  }
}

const SC_EVENTS = {
  READY: "READY",
  PLAY: "PLAY",
  PAUSE: "PAUSE",
  FINISH: "FINISH",
  PLAY_PROGRESS: "PLAY_PROGRESS",
  ERROR: "ERROR",
} as const;

// ── Adapter implementation ───────────────────────────────────────

type Listener = (state: MediaPlaybackState) => void;

export class SoundCloudMediaAdapter implements MediaAdapter {
  id = "soundcloud" as const;
  capabilities: MediaCapabilities = {
    seek: true,
    volume: true,
    queue: true,
    video: false,
    playlists: true,
  };

  private listeners = new Set<Listener>();
  private widget: SoundCloudWidget | null = null;
  private iframe: HTMLIFrameElement | null = null;
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

      const existing = document.querySelector(`script[src="${WIDGET_SCRIPT_SRC}"]`);
      if (existing) {
        if (window.SC) {
          this.apiLoaded = true;
          this.apiLoading = false;
          resolve();
        }
        return;
      }

      const script = document.createElement("script");
      script.src = WIDGET_SCRIPT_SRC;
      script.async = true;
      script.onload = () => {
        this.apiLoaded = true;
        this.apiLoading = false;
        resolve();
      };
      script.onerror = () => {
        this.apiLoading = false;
        this.status = "error";
        this.error = "Failed to load SoundCloud Widget API.";
        this.emit();
        reject(new Error("Failed to load SoundCloud Widget API"));
      };
      document.head.appendChild(script);
    });
  }

  // ── Mount / destroy ───────────────────────────────────────────

  async mount(element: HTMLElement): Promise<void> {
    if (this.widget) return;

    this.hostElement = element;

    try {
      await this.loadApi();
    } catch {
      return;
    }

    this.status = "loading";
    this.emit();

    // Create the iframe with the SoundCloud widget
    const initialUrl = this.currentItem?.sourceUrl ?? "";
    const embedUrl = initialUrl
      ? `https://w.soundcloud.com/player/?url=${encodeURIComponent(initialUrl)}&auto_play=false&visual=true`
      : "https://w.soundcloud.com/player/?auto_play=false&visual=true";

    this.iframe = document.createElement("iframe");
    this.iframe.src = embedUrl;
    this.iframe.width = "100%";
    this.iframe.height = "100%";
    this.iframe.frameBorder = "0";
    this.iframe.allow = "autoplay";
    this.iframe.style.border = "none";
    element.appendChild(this.iframe);

    // Create the widget controller
    if (window.SC && this.iframe) {
      const SCWidget = (window as unknown as { SC: { Widget: new (iframe: HTMLIFrameElement) => SoundCloudWidget } }).SC.Widget;
      this.widget = new SCWidget(this.iframe);
      this.bindWidgetEvents();
    }
  }

  destroy(): void {
    if (this.widget) {
      try { this.widget.destroy(); } catch { /* ignore */ }
      this.widget = null;
    }
    if (this.iframe) {
      if (this.iframe.parentNode) this.iframe.parentNode.removeChild(this.iframe);
      this.iframe = null;
    }
    this.hostElement = null;
    this.status = "idle";
    this.emit();
  }

  private bindWidgetEvents() {
    if (!this.widget) return;
    const widget = this.widget;

    widget.bind(SC_EVENTS.READY, () => {
      this.status = "ready";
      this.error = null;
      widget.setVolume(this.volume);
      // Fetch sound metadata
      widget.getCurrentSound((sound) => {
        if (sound && this.currentItem) {
          this.currentItem = {
            ...this.currentItem,
            title: sound.title,
            creator: sound.user?.username,
            artworkUrl: sound.artwork_url?.replace("-large", "-t500x500") ?? undefined,
            durationMs: sound.duration,
          };
          this.durationMs = sound.duration;
          this.emit();
        }
      });
      this.durationMs = widget.getDuration();
      this.emit();
    });

    widget.bind(SC_EVENTS.PLAY, () => {
      this.status = "playing";
      this.error = null;
      this.emit();
    });

    widget.bind(SC_EVENTS.PAUSE, () => {
      this.status = "paused";
      this.emit();
    });

    widget.bind(SC_EVENTS.FINISH, () => {
      this.status = "idle";
      this.positionMs = 0;
      this.emit();
    });

    widget.bind(SC_EVENTS.PLAY_PROGRESS, (data?: unknown) => {
      const event = data as SoundCloudWidgetEvent | undefined;
      if (event) {
        this.positionMs = event.currentPosition || widget.getPosition() || 0;
        this.durationMs = widget.getDuration() || 0;
        this.emit();
      }
    });

    widget.bind(SC_EVENTS.ERROR, () => {
      this.status = "error";
      this.error = "This SoundCloud track could not be embedded. It may be restricted.";
      this.emit();
    });
  }

  // ── Load ──────────────────────────────────────────────────────

  async load(item: MediaItem): Promise<void> {
    this.currentItem = item;
    this.error = null;
    this.status = "loading";
    this.positionMs = 0;
    this.emit();

    if (this.widget) {
      this.widget.load(item.sourceUrl, {
        auto_play: false,
        visual: true,
        callback: () => {
          this.status = "ready";
          this.widget?.setVolume(this.volume);
          this.durationMs = this.widget?.getDuration() || 0;
          this.widget?.getCurrentSound((sound) => {
            if (sound && this.currentItem) {
              this.currentItem = {
                ...this.currentItem,
                title: sound.title,
                creator: sound.user?.username,
                artworkUrl: sound.artwork_url?.replace("-large", "-t500x500") ?? undefined,
                durationMs: sound.duration,
              };
              this.emit();
            }
          });
          this.emit();
        },
      });
    }
  }

  // ── Playback ──────────────────────────────────────────────────

  play() {
    if (this.widget) this.widget.play();
  }

  pause() {
    if (this.widget) this.widget.pause();
  }

  toggle() {
    if (this.widget) this.widget.toggle();
  }

  seek(milliseconds: number) {
    if (this.widget) this.widget.seek(milliseconds);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.muted = this.volume === 0;
    if (this.widget) this.widget.setVolume(this.volume);
    this.emit();
  }
}
