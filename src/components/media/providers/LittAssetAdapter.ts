/**
 * LittAssetAdapter — extends DirectAudioAdapter for LiTT-generated
 * audio assets stored in Cloudflare R2 or the LiTT CDN.
 *
 * LiTT assets are direct audio files but with:
 * - LiTT-branded metadata defaults
 * - R2/CDN URL detection
 * - Support for LiTT-generated music (from /api/media/generate-music)
 */

import type {
  MediaCapabilities,
  MediaItem,
  MediaProviderId,
} from "../media-types";
import { DirectAudioAdapter } from "./DirectAudioAdapter";

const LITT_ASSET_HOSTS = [
  "r2.littree.ai",
  "assets.littree.ai",
  "cdn.littree.ai",
  "media.littree.ai",
] as const;

function isLittAssetUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return LITT_ASSET_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export class LittAssetAdapter extends DirectAudioAdapter {
  id = "litt" as MediaProviderId;
  capabilities: MediaCapabilities = {
    seek: true,
    volume: true,
    queue: true,
    video: false,
    playlists: false,
  };

  async load(item: MediaItem): Promise<void> {
    // Validate it's a LiTT asset URL (or a direct audio URL fallback)
    if (!isLittAssetUrl(item.sourceUrl)) {
      // Allow direct audio URLs as fallback for LiTT-generated content
      // that may be served from non-LiTT hosts during development
    }

    this.currentItem = {
      ...item,
      title: item.title || "LiTT Generated Track",
      creator: item.creator || "LiTT",
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
}
