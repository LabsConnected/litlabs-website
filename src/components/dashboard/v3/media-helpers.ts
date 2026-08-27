/**
 * Dashboard v3 — media helper utilities.
 */

import type { RecentCreation } from "@/lib/dashboard/recent-creations";
import type { DashboardMediaItem, MediaSource } from "./types";

/**
 * Format milliseconds as m:ss or h:mm:ss.
 */
export function formatTime(ms: number): string {
  if (!ms || ms <= 0 || isNaN(ms)) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Convert a RecentCreation (from the dashboard widgets API) into a
 * DashboardMediaItem for the Recent Media grid.
 */
export function creationToMediaItem(
  creation: RecentCreation,
  favorite: boolean,
): DashboardMediaItem {
  // Determine the source badge
  let source: MediaSource = "upload";
  if (creation.projectId) {
    source = "litt";
  }

  // Normalize type — "audio" maps to "music", "document" is excluded upstream
  const type: DashboardMediaItem["type"] =
    creation.type === "music" || creation.type === "audio"
      ? "music"
      : creation.type === "video"
        ? "video"
        : "image";

  return {
    id: creation.id,
    title: creation.title,
    type,
    thumbnailUrl: creation.thumbnailUrl,
    url: creation.url,
    createdAt: creation.createdAt,
    projectId: creation.projectId,
    source,
    favorite,
  };
}
