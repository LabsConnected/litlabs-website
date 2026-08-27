/**
 * Dashboard v3 — shared types and localStorage helpers.
 *
 * These types are consumed by the dashboard composition, data hooks,
 * and individual section components. They map real backend/runtime
 * data into display-friendly shapes.
 */

import type { PlayerTrack } from "@/context/MusicPlayerContext";
import type { MediaItem, MediaProviderId } from "@/components/media/media-types";

// ── Project ───────────────────────────────────────────────────────

export type ProjectStatus = "live" | "building" | "failed" | "draft" | "unknown";

export interface DashboardProject {
  id: string;
  name: string;
  type: "project" | "mission";
  branch: string;
  status: ProjectStatus;
  updatedAt: string | null;
  repository: string | null;
  latestCommit: string | null;
  deploymentState: string;
  previewState: string;
  workspaceState: string;
  terminalState: string;
}

// ── Media ─────────────────────────────────────────────────────────

export type MediaCategory = "all" | "image" | "video" | "music";

export type MediaSource = "litt" | "upload" | "youtube";

export interface DashboardMediaItem {
  id: string;
  title: string;
  type: "image" | "video" | "music";
  thumbnailUrl: string | null;
  url: string;
  createdAt: string;
  projectId: string | null;
  source: MediaSource;
  track?: PlayerTrack;
  favorite: boolean;
}

// ── Pulse ─────────────────────────────────────────────────────────

export type PulseState = "live" | "passing" | "building" | "failed" | "unknown" | "idle";

export interface PulseItem {
  id: string;
  label: string;
  state: PulseState;
  detail?: string;
  clickable: boolean;
}

// ── Command Palette ───────────────────────────────────────────────

export type CommandCategory =
  | "projects"
  | "actions"
  | "developer"
  | "media"
  | "navigation";

export interface CommandItem {
  id: string;
  label: string;
  category: CommandCategory;
  keywords?: string;
  action: () => void;
}

// ── Dock queue item (unified view across providers) ───────────────

export interface DockQueueItem {
  id: string;
  title: string;
  source: MediaProviderId | "litt";
  artworkUrl?: string;
  isActive: boolean;
}

// ── localStorage helpers: Favorites ───────────────────────────────

const FAVORITES_KEY = "litt-dashboard-favorites";

export function getFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function isFavorite(id: string): boolean {
  return getFavorites().has(id);
}

export function toggleFavorite(id: string): boolean {
  const favs = getFavorites();
  if (favs.has(id)) {
    favs.delete(id);
  } else {
    favs.add(id);
  }
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs]));
  } catch {
    // non-fatal
  }
  return favs.has(id);
}

// ── localStorage helpers: Pinned projects ─────────────────────────

const PINS_KEY = "litt-dashboard-pins";

export function getPinnedProjects(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export function togglePin(projectId: string): boolean {
  const pins = getPinnedProjects();
  if (pins.has(projectId)) {
    pins.delete(projectId);
  } else {
    pins.add(projectId);
  }
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify([...pins]));
  } catch {
    // non-fatal
  }
  return pins.has(projectId);
}

// ── Re-export MediaItem for convenience ───────────────────────────

export type { MediaItem, MediaProviderId };
