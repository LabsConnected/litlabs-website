/**
 * Video generation tier configuration.
 *
 * Video is metered usage — users pay per clip in LiTTBits.
 * Launch with 3 tiers (Draft, Quality, Video+Audio).
 * Cinema and 4K are hidden behind "coming soon" until billing stabilizes.
 *
 * Provider costs are approximate published rates from fal.ai.
 * Customer prices are set in LiTTBits (1 LiTTBit ≈ $0.01 USD).
 */

export type VideoTierId = "draft" | "quality" | "video_audio" | "cinema" | "ultra_4k";

export interface VideoTier {
  id: VideoTierId;
  name: string;
  description: string;
  model: string;
  /** Approximate provider cost per second in USD cents */
  providerCostPerSecCents: number;
  /** Customer price for a 5-second clip in LiTTBits */
  priceLiTTBits: number;
  /** Max duration in seconds */
  maxDuration: number;
  /** Default resolution */
  resolution: string;
  /** Whether this tier is available to users */
  enabled: boolean;
  /** Badge label for UI */
  badge?: string;
}

export const VIDEO_TIERS: Record<VideoTierId, VideoTier> = {
  draft: {
    id: "draft",
    name: "Draft Video",
    description: "Fast, affordable AI video for quick concepts",
    model: "wan-2.5",
    providerCostPerSecCents: 5,
    priceLiTTBits: 79,
    maxDuration: 5,
    resolution: "720p",
    enabled: true,
    badge: "Fastest",
  },
  quality: {
    id: "quality",
    name: "Quality Video",
    description: "Higher fidelity with Kling Turbo Pro",
    model: "kling-turbo-pro",
    providerCostPerSecCents: 7,
    priceLiTTBits: 129,
    maxDuration: 5,
    resolution: "720p",
    enabled: true,
    badge: "Best value",
  },
  video_audio: {
    id: "video_audio",
    name: "Video with Audio",
    description: "Veo 3.1 Fast with synchronized audio",
    model: "veo-3.1-fast",
    providerCostPerSecCents: 10,
    priceLiTTBits: 199,
    maxDuration: 5,
    resolution: "720p",
    enabled: true,
    badge: "Audio included",
  },
  cinema: {
    id: "cinema",
    name: "Cinema",
    description: "Veo 3.1 Standard for cinematic quality",
    model: "veo-3.1-standard",
    providerCostPerSecCents: 40,
    priceLiTTBits: 499,
    maxDuration: 5,
    resolution: "1080p",
    enabled: false,
    badge: "Coming soon",
  },
  ultra_4k: {
    id: "ultra_4k",
    name: "4K",
    description: "Kling 3 4K for ultra-high resolution",
    model: "kling-3-4k",
    providerCostPerSecCents: 42,
    priceLiTTBits: 599,
    maxDuration: 5,
    resolution: "4K",
    enabled: false,
    badge: "Coming soon",
  },
};

export const ENABLED_VIDEO_TIERS = Object.values(VIDEO_TIERS).filter((t) => t.enabled);
export const ALL_VIDEO_TIERS = Object.values(VIDEO_TIERS);

export function getVideoTier(id: string): VideoTier | null {
  return VIDEO_TIERS[id as VideoTierId] ?? null;
}

/**
 * Supported aspect ratios for video generation.
 */
export const VIDEO_ASPECT_RATIOS = [
  { id: "16:9", name: "Landscape", value: "16:9" },
  { id: "9:16", name: "Portrait", value: "9:16" },
  { id: "1:1", name: "Square", value: "1:1" },
] as const;

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]["id"];

/**
 * Daily spending limit per account for video generation (in LiTTBits).
 * Prevents runaway costs. ~$20/day equivalent.
 */
export const VIDEO_DAILY_SPEND_LIMIT_LB = 2000;

/**
 * Emergency cost cutoff — if total video spend across all users
 * exceeds this in a 24h period, generation is paused globally.
 */
export const VIDEO_GLOBAL_DAILY_CUTOFF_LB = 50000;
