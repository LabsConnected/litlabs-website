/**
 * Universal media URL parser.
 *
 * Detects the provider from a pasted URL and returns a MediaItem.
 * Supports YouTube (video, playlist, shorts, live), Spotify
 * (tracks, albums, artists, playlists, podcast shows, episodes),
 * SoundCloud (tracks, sets), Apple Music (songs, albums, playlists),
 * and direct audio file URLs (mp3, wav, ogg, m4a, flac, webm).
 */

import type { MediaItem, MediaProviderId } from "./media-types";

// ── Direct audio file extensions ──────────────────────────────────
const AUDIO_EXTENSIONS = [
  ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac", ".webm", ".opus",
] as const;

// ── LiTT asset URL patterns ───────────────────────────────────────
const LITT_ASSET_HOSTS = [
  "r2.littree.ai",
  "assets.littree.ai",
  "cdn.littree.ai",
  "media.littree.ai",
] as const;

function detectProvider(url: URL): MediaProviderId | null {
  const hostname = url.hostname.replace(/^www\./, "");
  const pathname = url.pathname.toLowerCase();

  // YouTube
  if (
    hostname === "youtube.com" ||
    hostname === "youtu.be" ||
    hostname === "music.youtube.com" ||
    hostname === "youtube-nocookie.com"
  ) {
    return "youtube";
  }

  // Spotify
  if (
    hostname === "open.spotify.com" ||
    hostname === "spotify.link"
  ) {
    return "spotify";
  }

  // SoundCloud
  if (
    hostname === "soundcloud.com" ||
    hostname === "snd.sc" ||
    hostname === "w.soundcloud.com"
  ) {
    return "soundcloud";
  }

  // Apple Music
  if (
    hostname === "music.apple.com" ||
    hostname === "embed.music.apple.com" ||
    hostname === "api.music.apple.com"
  ) {
    return "apple-music";
  }

  // LiTT assets (R2 CDN or internal media hosts)
  if (LITT_ASSET_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
    return "litt";
  }

  // Direct audio files — check extension
  if (AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return "direct";
  }

  return null;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function parseMediaUrl(input: string): MediaItem {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a valid media link (YouTube, Spotify, SoundCloud, Apple Music, or audio file URL).");
  }

  const provider = detectProvider(url);

  if (!provider) {
    throw new Error("Unsupported URL. Paste a YouTube, Spotify, SoundCloud, Apple Music link, or a direct audio file URL.");
  }

  const item: MediaItem = {
    id: makeId(),
    provider,
    sourceUrl: url.toString(),
  };

  // Enrich with metadata where possible
  if (provider === "youtube") {
    const videoId = extractYouTubeVideoId(url.toString());
    if (videoId) {
      item.artworkUrl = getYouTubeThumbnail(videoId);
    }
  }

  return item;
}

/**
 * Quick check — does this string look like a supported media URL?
 * Used for paste detection without throwing.
 */
export function isMediaUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return detectProvider(url) !== null;
  } catch {
    return false;
  }
}

/**
 * Extract a YouTube video ID from a MediaItem sourceUrl.
 */
export function extractYouTubeVideoId(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }

    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];

      const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];

      const liveMatch = url.pathname.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch) return liveMatch[1];
    }

    if (host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Extract a YouTube playlist ID from a MediaItem sourceUrl.
 */
export function extractYouTubePlaylistId(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const list = url.searchParams.get("list");
    if (list && list.length > 6) return list;
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Get a YouTube thumbnail URL for a video ID.
 */
export function getYouTubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Convert a Spotify open.spotify.com URL to a spotify: URI.
 * e.g. https://open.spotify.com/track/abc → spotify:track:abc
 */
export function urlToSpotifyUri(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) {
      return `spotify:${parts[0]}:${parts[1]}`;
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Extract a SoundCloud track URL (canonical form for the Widget API).
 * SoundCloud Widget API accepts the full track URL as the iframe src.
 */
export function extractSoundCloudTrackUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "soundcloud.com" || host === "w.soundcloud.com") {
      return url.toString();
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Extract an Apple Music catalog ID and type from a URL.
 * e.g. https://music.apple.com/us/album/song-name/1234567890?i=987654321
 * Returns { type: "song", id: "987654321" } (uses the track index `i` param if present)
 */
export function extractAppleMusicId(sourceUrl: string): { type: string; id: string } | null {
  try {
    const url = new URL(sourceUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    // music.apple.com/{locale}/{type}/{name}/{id}
    if (parts.length >= 3) {
      const type = parts[1]; // album, song, playlist, artist
      const id = parts[parts.length - 1];
      // For album URLs with ?i= (specific track within album)
      const trackIndex = url.searchParams.get("i");
      if (trackIndex && type === "album") {
        return { type: "song", id: trackIndex };
      }
      return { type, id };
    }
  } catch {
    // not a URL
  }
  return null;
}

/**
 * Check if a URL is a direct audio file.
 */
export function isDirectAudioUrl(sourceUrl: string): boolean {
  try {
    const url = new URL(sourceUrl);
    const pathname = url.pathname.toLowerCase();
    return AUDIO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Derive a title from a direct audio URL's filename.
 */
export function directAudioTitle(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const filename = url.pathname.split("/").pop() || "Unknown Track";
    return decodeURIComponent(filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "));
  } catch {
    return "Unknown Track";
  }
}
