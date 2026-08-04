/**
 * YouTube IFrame Player API type declarations.
 *
 * The official API is loaded via a <script> tag and attaches `YT`
 * to the window object. These types cover the subset we use.
 */

export type YTPlayerState =
  | "idle"
  | "loading_api"
  | "creating_player"
  | "ready"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type YTPlayerErrorCode =
  | 2 // Invalid video ID / parameter
  | 5 // HTML5 player error
  | 100 // Video not found / removed
  | 101 // Video not allowed to be embedded
  | 150; // Same as 101 (alternate)

export interface YTPlayerError {
  code: YTPlayerErrorCode;
  message: string;
}

/** Subset of the YT.PlayerState enum */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface YTVideo {
  videoId: string;
  title: string;
  channel?: string;
  /** Thumbnail URL (maxresdefault if available) */
  thumbnail?: string;
  /** Original URL the user pasted */
  sourceUrl?: string;
}

export interface YTPlaylist {
  playlistId: string;
  title?: string;
  videoIds: string[];
}

export type YTQueueItem = YTVideo;

export type YTDockMode = "docked" | "mini" | "expanded" | "hidden";

export interface YTPersistedState {
  queue: YTQueueItem[];
  currentIndex: number;
  volume: number;
  muted: boolean;
  dockMode: YTDockMode;
  lastPlaylistId?: string;
}

// ---------------------------------------------------------------------------
// Window augmentation for the YT API
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        config: {
          width?: string | number;
          height?: string | number;
          videoId?: string;
          playerVars?: {
            autoplay?: 0 | 1;
            controls?: 0 | 1;
            enablejsapi?: 0 | 1;
            playsinline?: 0 | 1;
            origin?: string;
            rel?: 0 | 1;
            modestbranding?: 0 | 1;
            listType?: "playlist" | "user_uploads";
            list?: string;
            loop?: 0 | 1;
          };
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { target: YTPlayerInstance; data: number }) => void;
            onError?: (event: { target: YTPlayerInstance; data: number }) => void;
            onAutoplayBlocked?: (event: { target: YTPlayerInstance }) => void;
          };
        },
      ) => YTPlayerInstance;
      PlayerState: typeof YT_STATE;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getVolume(): number;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  loadPlaylist(playlist: string[] | string, index?: number, startSeconds?: number): void;
  cuePlaylist(playlist: string[] | string, index?: number, startSeconds?: number): void;
  nextVideo(): void;
  previousVideo(): void;
  setShuffle(shuffle: boolean): void;
  setLoop(loop: boolean): void;
  getVideoData(): { video_id: string; title: string; author: string };
  getPlaylist(): string[];
  getPlaylistIndex(): number;
  destroy(): void;
  iframe?: HTMLIFrameElement;
}
