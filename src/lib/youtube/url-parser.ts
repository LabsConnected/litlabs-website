/**
 * YouTube URL parsing utilities.
 *
 * Extracts video IDs and playlist IDs from any YouTube URL format:
 *   - https://www.youtube.com/watch?v=VIDEO_ID
 *   - https://youtu.be/VIDEO_ID
 *   - https://www.youtube.com/playlist?list=PLAYLIST_ID
 *   - https://www.youtube.com/watch?v=VIDEO_ID&list=PLAYLIST_ID
 *   - https://www.youtube.com/embed/VIDEO_ID
 *   - https://music.youtube.com/watch?v=VIDEO_ID
 */

import type { YTVideo, YTPlaylist } from "./types";

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extract a video ID from a YouTube URL or raw ID string.
 * Returns null if no valid video ID is found.
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Raw 11-char ID
  if (VIDEO_ID_REGEX.test(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, "");

    // youtu.be/VIDEO_ID
    if (host === "youtu.be") {
      const id = url.pathname.slice(1).split("/")[0];
      return VIDEO_ID_REGEX.test(id) ? id : null;
    }

    // youtube.com/watch?v=VIDEO_ID
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && VIDEO_ID_REGEX.test(v)) return v;

      // /embed/VIDEO_ID
      const embedMatch = url.pathname.match(/^\/embed\/([a-zA-Z0-9_-]{11})/);
      if (embedMatch) return embedMatch[1];

      // /shorts/VIDEO_ID
      const shortsMatch = url.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];

      // /live/VIDEO_ID
      const liveMatch = url.pathname.match(/^\/live\/([a-zA-Z0-9_-]{11})/);
      if (liveMatch) return liveMatch[1];
    }

    // music.youtube.com/watch?v=VIDEO_ID
    if (host === "music.youtube.com") {
      const v = url.searchParams.get("v");
      if (v && VIDEO_ID_REGEX.test(v)) return v;
    }
  } catch {
    // Not a URL — try as raw ID
    if (VIDEO_ID_REGEX.test(trimmed)) return trimmed;
  }

  return null;
}

/**
 * Extract a playlist ID from a YouTube URL.
 * Returns null if no playlist ID is found.
 */
export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const list = url.searchParams.get("list");
    if (list && list.length > 6) return list;
  } catch {
    // Not a URL
  }

  return null;
}

/**
 * Parse a YouTube URL into a video and/or playlist reference.
 */
export function parseYouTubeUrl(
  input: string,
): { video: YTVideo | null; playlist: YTPlaylist | null } {
  const videoId = extractVideoId(input);
  const playlistId = extractPlaylistId(input);

  const video = videoId
    ? {
        videoId,
        title: "", // Will be filled by the player onReady / getVideoData
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        sourceUrl: input,
      }
    : null;

  const playlist = playlistId
    ? {
        playlistId,
        title: "",
        videoIds: videoId ? [videoId] : [],
      }
    : null;

  return { video, playlist };
}

/**
 * Build a thumbnail URL for a video ID.
 */
export function getThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}
