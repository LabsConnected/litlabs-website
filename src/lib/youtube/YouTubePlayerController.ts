/**
 * YouTubePlayerController — the ONE canonical owner of the YouTube
 * IFrame Player API instance, queue, playback state, and persistence.
 *
 * This controller is framework-agnostic. The React provider wraps it.
 *
 * Responsibilities:
 *   - Load the YouTube IFrame API script (once, globally)
 *   - Create the YT.Player instance attached to a div
 *   - Load videos and playlists by URL or ID
 *   - Play, pause, stop, seek, volume, mute
 *   - Previous / next in queue
 *   - Player state machine (idle → loading_api → ready → playing → etc.)
 *   - Queue management (add, remove, reorder, clear)
 *   - Persist queue + volume + dock mode to localStorage per user
 *   - Emit state changes to subscribers
 *   - Proper cleanup (destroy player, remove script)
 *
 * @see src/lib/youtube/types.ts
 * @see src/context/YouTubePlayerContext.tsx
 */

import {
  YT_STATE,
  type YTPlayerState,
  type YTPlayerError,
  type YTQueueItem,
  type YTDockMode,
  type YTPersistedState,
  type YTPlayerInstance,
} from "./types";
import { extractVideoId, extractPlaylistId, getThumbnail } from "./url-parser";

const API_SCRIPT_SRC = "https://www.youtube.com/iframe_api";
const STORAGE_KEY_PREFIX = "litt:youtube-player:";
const DEFAULT_VOLUME = 70;

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type YouTubePlayerEvent =
  | { type: "stateChange"; state: YTPlayerState }
  | { type: "queueChange"; queue: YTQueueItem[]; currentIndex: number }
  | { type: "dockModeChange"; mode: YTDockMode }
  | { type: "volumeChange"; volume: number; muted: boolean }
  | { type: "progressChange"; currentTime: number; duration: number }
  | { type: "videoDataChange"; videoId: string; title: string; channel: string }
  | { type: "error"; error: YTPlayerError }
  | { type: "apiReady" };

type EventListener = (event: YouTubePlayerEvent) => void;

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video ID or parameter.",
  5: "HTML5 player error.",
  100: "Video not found or has been removed.",
  101: "This video cannot be played in embedded players.",
  150: "This video cannot be played in embedded players.",
};

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class YouTubePlayerController {
  private listeners = new Set<EventListener>();
  private state: YTPlayerState = "idle";
  private player: YTPlayerInstance | null = null;
  private playerDiv: HTMLDivElement | null = null;
  private apiLoaded = false;
  private apiLoading = false;
  private pendingCreate: (() => void) | null = null;

  private queue: YTQueueItem[] = [];
  private currentIndex = -1;
  private volume = DEFAULT_VOLUME;
  private muted = false;
  private dockMode: YTDockMode = "hidden";
  private currentVideoId: string | null = null;
  private currentTitle = "";
  private currentChannel = "";
  private currentTime = 0;
  private duration = 0;
  private lastPlaylistId: string | null = null;

  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private userId: string | null = null;

  // -------------------------------------------------------------------------
  // Event subscription
  // -------------------------------------------------------------------------

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: YouTubePlayerEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // listener errors are non-fatal
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  getState(): YTPlayerState {
    return this.state;
  }

  getQueue(): YTQueueItem[] {
    return [...this.queue];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentVideo(): YTQueueItem | null {
    return this.queue[this.currentIndex] ?? null;
  }

  getVolume(): number {
    return this.volume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  getDockMode(): YTDockMode {
    return this.dockMode;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    return this.duration;
  }

  getCurrentVideoId(): string | null {
    return this.currentVideoId;
  }

  getCurrentTitle(): string {
    return this.currentTitle;
  }

  getCurrentChannel(): string {
    return this.currentChannel;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  private setState(newState: YTPlayerState) {
    this.state = newState;
    this.emit({ type: "stateChange", state: newState });
  }

  private emitError(code: number) {
    const error: YTPlayerError = {
      code: code as YTPlayerError["code"],
      message: ERROR_MESSAGES[code] || "Unknown YouTube player error.",
    };
    this.setState("error");
    this.emit({ type: "error", error });
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  setUserId(userId: string | null) {
    this.userId = userId;
    this.loadPersistedState();
  }

  private getStorageKey(): string {
    return `${STORAGE_KEY_PREFIX}${this.userId ?? "anonymous"}`;
  }

  private loadPersistedState() {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(this.getStorageKey());
      if (!raw) return;
      const persisted = JSON.parse(raw) as YTPersistedState;
      this.queue = persisted.queue ?? [];
      this.currentIndex = persisted.currentIndex ?? -1;
      this.volume = persisted.volume ?? DEFAULT_VOLUME;
      this.muted = persisted.muted ?? false;
      this.dockMode = persisted.dockMode ?? "hidden";
      this.lastPlaylistId = persisted.lastPlaylistId ?? null;
      this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
      this.emit({ type: "volumeChange", volume: this.volume, muted: this.muted });
      this.emit({ type: "dockModeChange", mode: this.dockMode });
    } catch {
      // corrupted storage — ignore
    }
  }

  private persist() {
    if (typeof window === "undefined") return;
    try {
      const state: YTPersistedState = {
        queue: this.queue,
        currentIndex: this.currentIndex,
        volume: this.volume,
        muted: this.muted,
        dockMode: this.dockMode,
        lastPlaylistId: this.lastPlaylistId ?? undefined,
      };
      localStorage.setItem(this.getStorageKey(), JSON.stringify(state));
    } catch {
      // storage full or blocked — non-fatal
    }
  }

  // -------------------------------------------------------------------------
  // API script loading
  // -------------------------------------------------------------------------

  private loadApi(): Promise<void> {
    if (this.apiLoaded) return Promise.resolve();
    if (this.apiLoading) {
      // Wait for the existing load attempt
      return new Promise((resolve) => {
        const check = setInterval(() => {
          if (this.apiLoaded) {
            clearInterval(check);
            resolve();
          }
        }, 100);
      });
    }

    this.apiLoading = true;
    this.setState("loading_api");

    return new Promise((resolve, reject) => {
      if (typeof window === "undefined") {
        reject(new Error("Not in browser"));
        return;
      }

      // Set up the callback the API will call
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        this.apiLoaded = true;
        this.apiLoading = false;
        this.emit({ type: "apiReady" });
        if (prevCallback) {
          try { prevCallback(); } catch { /* ignore */ }
        }
        resolve();
      };

      // Check if script already exists
      const existing = document.querySelector(
        `script[src="${API_SCRIPT_SRC}"]`,
      );
      if (existing) {
        // Script is loading or loaded — if YT is already available, resolve
        if (window.YT?.Player) {
          this.apiLoaded = true;
          this.apiLoading = false;
          resolve();
        }
        // Otherwise the onYouTubeIframeAPIReady callback will fire
        return;
      }

      // Inject the script
      const script = document.createElement("script");
      script.src = API_SCRIPT_SRC;
      script.async = true;
      script.onerror = () => {
        this.apiLoading = false;
        this.emitError(5);
        reject(new Error("Failed to load YouTube IFrame API"));
      };
      document.head.appendChild(script);
    });
  }

  // -------------------------------------------------------------------------
  // Player creation
  // -------------------------------------------------------------------------

  /**
   * Create the YT.Player instance attached to the given div.
   * The div must already be in the DOM.
   */
  async createPlayer(div: HTMLDivElement): Promise<void> {
    if (this.player) {
      // Player already exists — just reattach if needed
      return;
    }

    this.playerDiv = div;

    // Load API if not loaded
    if (!this.apiLoaded) {
      try {
        await this.loadApi();
      } catch {
        return; // error already emitted
      }
    }

    if (!window.YT?.Player) {
      this.emitError(5);
      return;
    }

    this.setState("creating_player");

    const initialVideoId = this.queue[this.currentIndex]?.videoId;

    this.player = new window.YT.Player(div, {
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
        onError: (event) => this.emitError(event.data),
      },
    });
  }

  private handleReady(player: YTPlayerInstance) {
    this.setState("ready");
    player.setVolume(this.volume);
    if (this.muted) player.mute();
    else player.unMute();

    // Start progress polling
    this.startProgressPolling();

    // Try to get video data
    this.refreshVideoData();

    // If we have a queued video, load it
    const video = this.queue[this.currentIndex];
    if (video && !this.currentVideoId) {
      player.cueVideoById(video.videoId);
    }
  }

  private handleStateChange(ytState: number) {
    switch (ytState) {
      case YT_STATE.PLAYING:
        this.setState("playing");
        this.refreshVideoData();
        break;
      case YT_STATE.PAUSED:
        this.setState("paused");
        break;
      case YT_STATE.BUFFERING:
        this.setState("buffering");
        break;
      case YT_STATE.ENDED:
        this.setState("ended");
        // Auto-advance to next video
        this.next();
        break;
      case YT_STATE.CUED:
        this.setState("ready");
        this.refreshVideoData();
        break;
      case YT_STATE.UNSTARTED:
        // Don't change state on unstarted — could be initial load
        break;
    }
  }

  private refreshVideoData() {
    if (!this.player) return;
    try {
      const data = this.player.getVideoData();
      if (data?.video_id) {
        this.currentVideoId = data.video_id;
        this.currentTitle = data.title || "";
        this.currentChannel = data.author || "";
        this.emit({
          type: "videoDataChange",
          videoId: data.video_id,
          title: data.title || "",
          channel: data.author || "",
        });

        // Update queue item with fetched title
        if (this.queue[this.currentIndex]) {
          this.queue[this.currentIndex] = {
            ...this.queue[this.currentIndex],
            title: data.title || this.queue[this.currentIndex].title,
            channel: data.author || this.queue[this.currentIndex].channel,
          };
          this.emit({
            type: "queueChange",
            queue: this.queue,
            currentIndex: this.currentIndex,
          });
          this.persist();
        }
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
        this.currentTime = this.player.getCurrentTime() || 0;
        this.duration = this.player.getDuration() || 0;
        this.emit({
          type: "progressChange",
          currentTime: this.currentTime,
          duration: this.duration,
        });
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

  // -------------------------------------------------------------------------
  // Queue management
  // -------------------------------------------------------------------------

  /**
   * Load a video by URL or ID. Replaces the current queue with a single item.
   */
  loadVideo(input: string): boolean {
    const videoId = extractVideoId(input);
    if (!videoId) return false;

    const item: YTQueueItem = {
      videoId,
      title: "",
      thumbnail: getThumbnail(videoId),
      sourceUrl: input,
    };

    this.queue = [item];
    this.currentIndex = 0;
    this.currentVideoId = videoId;
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });

    if (this.player) {
      this.player.loadVideoById(videoId);
    }

    this.persist();
    return true;
  }

  /**
   * Add a video to the end of the queue without changing current playback.
   */
  addToQueue(input: string): boolean {
    const videoId = extractVideoId(input);
    if (!videoId) return false;

    const item: YTQueueItem = {
      videoId,
      title: "",
      thumbnail: getThumbnail(videoId),
      sourceUrl: input,
    };

    this.queue.push(item);
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
    return true;
  }

  /**
   * Load a playlist by URL or ID. The IFrame API will load the playlist
   * and we'll track the video IDs as they play.
   */
  loadPlaylist(input: string): boolean {
    const playlistId = extractPlaylistId(input);
    if (!playlistId) return false;

    this.lastPlaylistId = playlistId;

    // Also check if there's a video ID in the URL
    const videoId = extractVideoId(input);
    if (videoId) {
      // Start the queue with this video
      const item: YTQueueItem = {
        videoId,
        title: "",
        thumbnail: getThumbnail(videoId),
        sourceUrl: input,
      };
      this.queue = [item];
      this.currentIndex = 0;
    }

    if (this.player) {
      this.player.cuePlaylist(playlistId);
    }

    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
    return true;
  }

  /**
   * Remove an item from the queue by index.
   */
  removeFromQueue(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.queue.splice(index, 1);
    if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex) {
      // Current video was removed — stop or advance
      if (this.queue.length === 0) {
        this.currentIndex = -1;
        this.stop();
      } else if (this.currentIndex >= this.queue.length) {
        this.currentIndex = this.queue.length - 1;
      }
      // Load the new current video
      const video = this.queue[this.currentIndex];
      if (video && this.player) {
        this.player.loadVideoById(video.videoId);
      }
    }
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
  }

  /**
   * Clear the entire queue and stop playback.
   */
  clearQueue() {
    this.queue = [];
    this.currentIndex = -1;
    this.stop();
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
  }

  /**
   * Jump to a specific item in the queue.
   */
  jumpTo(index: number) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const video = this.queue[index];
    if (video && this.player) {
      this.player.loadVideoById(video.videoId);
    }
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Playback controls
  // -------------------------------------------------------------------------

  play() {
    if (this.player) this.player.playVideo();
  }

  pause() {
    if (this.player) this.player.pauseVideo();
  }

  stop() {
    if (this.player) this.player.stopVideo();
    this.setState("idle");
  }

  next() {
    if (this.queue.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    const video = this.queue[this.currentIndex];
    if (video && this.player) {
      this.player.loadVideoById(video.videoId);
    }
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
  }

  previous() {
    if (this.queue.length === 0) return;
    this.currentIndex =
      this.currentIndex <= 0 ? this.queue.length - 1 : this.currentIndex - 1;
    const video = this.queue[this.currentIndex];
    if (video && this.player) {
      this.player.loadVideoById(video.videoId);
    }
    this.emit({ type: "queueChange", queue: this.queue, currentIndex: this.currentIndex });
    this.persist();
  }

  seek(seconds: number) {
    if (this.player) this.player.seekTo(seconds, true);
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(100, volume));
    if (this.player) this.player.setVolume(this.volume);
    this.muted = this.volume === 0;
    this.emit({ type: "volumeChange", volume: this.volume, muted: this.muted });
    this.persist();
  }

  toggleMute() {
    if (!this.player) return;
    if (this.muted) {
      this.player.unMute();
      this.muted = false;
      if (this.volume === 0) this.volume = DEFAULT_VOLUME;
      this.player.setVolume(this.volume);
    } else {
      this.player.mute();
      this.muted = true;
    }
    this.emit({ type: "volumeChange", volume: this.volume, muted: this.muted });
    this.persist();
  }

  // -------------------------------------------------------------------------
  // Dock mode
  // -------------------------------------------------------------------------

  setDockMode(mode: YTDockMode) {
    this.dockMode = mode;
    this.emit({ type: "dockModeChange", mode });
    this.persist();
  }

  showDocked() {
    this.setDockMode("docked");
  }

  showMini() {
    this.setDockMode("mini");
  }

  showExpanded() {
    this.setDockMode("expanded");
  }

  hide() {
    this.setDockMode("hidden");
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroyPlayer() {
    this.stopProgressPolling();
    if (this.player) {
      try {
        this.player.destroy();
      } catch {
        // ignore
      }
      this.player = null;
    }
    this.playerDiv = null;
    this.setState("idle");
  }
}
