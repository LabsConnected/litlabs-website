/**
 * DirectAudioAdapter — uses the native HTMLAudioElement for direct
 * audio file URLs (MP3, WAV, OGG, M4A, FLAC, AAC, WebM, Opus).
 *
 * This is the simplest adapter — no external API, no iframe, just
 * a plain <audio> element with full programmatic control.
 */

import type {
  MediaAdapter,
  MediaCapabilities,
  MediaItem,
  MediaPlaybackState,
  MediaProviderId,
} from "../media-types";
import { directAudioTitle, isDirectAudioUrl } from "../parse-media-url";

type Listener = (state: MediaPlaybackState) => void;

export class DirectAudioAdapter implements MediaAdapter {
  id: MediaProviderId = "direct";
  capabilities: MediaCapabilities = {
    seek: true,
    volume: true,
    queue: true,
    video: false,
    playlists: false,
  };

  protected listeners = new Set<Listener>();
  protected audio: HTMLAudioElement | null = null;
  protected hostElement: HTMLElement | null = null;
  protected currentItem: MediaItem | null = null;
  protected volume = 70;
  protected muted = false;
  protected positionMs = 0;
  protected durationMs = 0;
  protected status: MediaPlaybackState["status"] = "idle";
  protected error: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  protected emit() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try { listener(state); } catch { /* non-fatal */ }
    }
  }

  protected getState(): MediaPlaybackState {
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

  async mount(element: HTMLElement): Promise<void> {
    if (this.audio) return;

    this.hostElement = element;
    this.audio = new Audio();
    this.audio.style.display = "none";
    this.audio.preload = "auto";
    this.audio.crossOrigin = "anonymous";

    this.attachAudioEvents(this.audio);

    // If we already have an item, load it
    if (this.currentItem) {
      this.audio.src = this.currentItem.sourceUrl;
      this.audio.load();
    }

    // Append to the host element (hidden)
    element.appendChild(this.audio);
    this.status = this.currentItem ? "loading" : "idle";
    this.emit();
  }

  destroy(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      if (this.audio.parentNode) {
        this.audio.parentNode.removeChild(this.audio);
      }
      this.audio = null;
    }
    this.hostElement = null;
    this.status = "idle";
    this.emit();
  }

  protected attachAudioEvents(audio: HTMLAudioElement) {
    audio.addEventListener("loadstart", () => {
      this.status = "loading";
      this.emit();
    });
    audio.addEventListener("canplay", () => {
      this.status = "ready";
      this.durationMs = (audio.duration || 0) * 1000;
      this.emit();
    });
    audio.addEventListener("playing", () => {
      this.status = "playing";
      this.error = null;
      this.emit();
    });
    audio.addEventListener("pause", () => {
      this.status = "paused";
      this.emit();
    });
    audio.addEventListener("waiting", () => {
      this.status = "buffering";
      this.emit();
    });
    audio.addEventListener("timeupdate", () => {
      this.positionMs = (audio.currentTime || 0) * 1000;
      this.durationMs = (audio.duration || 0) * 1000;
      this.emit();
    });
    audio.addEventListener("ended", () => {
      this.status = "idle";
      this.positionMs = 0;
      this.emit();
    });
    audio.addEventListener("error", () => {
      this.status = "error";
      const code = audio.error?.code;
      const messages: Record<number, string> = {
        1: "Audio loading was aborted.",
        2: "Network error while loading audio.",
        3: "Audio decoding failed — the file may be corrupted or unsupported.",
        4: "Audio source not supported or not found.",
      };
      this.error = (code && messages[code]) || "Audio playback error.";
      this.emit();
    });
  }

  async load(item: MediaItem): Promise<void> {
    if (!isDirectAudioUrl(item.sourceUrl) && this.id === "direct") {
      this.status = "error";
      this.error = "Not a direct audio file URL.";
      this.emit();
      return;
    }

    this.currentItem = {
      ...item,
      title: item.title || directAudioTitle(item.sourceUrl),
    };
    this.error = null;
    this.status = "loading";
    this.positionMs = 0;
    this.emit();

    if (this.audio) {
      this.audio.src = item.sourceUrl;
      this.audio.load();
    }
  }

  play() {
    if (this.audio) {
      void this.audio.play().catch(() => {
        // Autoplay blocked — user must interact
        this.status = "paused";
        this.emit();
      });
    }
  }

  pause() {
    if (this.audio) this.audio.pause();
  }

  toggle() {
    if (this.audio) {
      if (this.audio.paused) this.play();
      else this.pause();
    }
  }

  seek(milliseconds: number) {
    if (this.audio && this.audio.duration) {
      this.audio.currentTime = Math.max(0, Math.min(milliseconds / 1000, this.audio.duration));
    }
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    this.muted = this.volume === 0;
    if (this.audio) {
      this.audio.volume = this.volume / 100;
      this.audio.muted = this.muted;
    }
    this.emit();
  }
}
