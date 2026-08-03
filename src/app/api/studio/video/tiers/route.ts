import { NextResponse } from "next/server";
import { ENABLED_VIDEO_TIERS, ALL_VIDEO_TIERS, VIDEO_ASPECT_RATIOS } from "@/config/video-tiers";

export async function GET() {
  return NextResponse.json({
    tiers: ALL_VIDEO_TIERS.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      priceLiTTBits: t.priceLiTTBits,
      maxDuration: t.maxDuration,
      resolution: t.resolution,
      enabled: t.enabled,
      badge: t.badge ?? null,
    })),
    enabledTiers: ENABLED_VIDEO_TIERS.map((t) => t.id),
    aspectRatios: VIDEO_ASPECT_RATIOS,
  });
}
