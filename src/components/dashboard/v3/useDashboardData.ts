"use client";

/**
 * useDashboardData — isolated data hooks for the dashboard.
 *
 * Each data source is fetched independently with its own loading/error
 * state so a failure in one (e.g. Railway down) doesn't destroy the
 * entire dashboard.
 *
 * Data sources:
 *   - Mission Control: project, missions, health, billing (existing API)
 *   - Recent Creations: user's generated/uploaded media (existing API)
 *   - Music Tracks: LiTT-generated audio tracks (existing API)
 */

import { useCallback, useEffect, useState } from "react";
import type { MissionControlResponse } from "@/lib/mission-control";
import type { RecentCreation } from "@/lib/dashboard/recent-creations";
import type { PlayerTrack } from "@/context/MusicPlayerContext";
import type { DashboardProject, DashboardMediaItem, PulseItem } from "./types";
import { creationToMediaItem } from "./media-helpers";
import { getFavorites } from "./types";

// ── Mission Control hook ───────────────────────────────────────────

interface MissionControlData {
  data: MissionControlResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useMissionControl(): MissionControlData {
  const [data, setData] = useState<MissionControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetch("/api/dashboard/mission-control", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<MissionControlResponse>;
      })
      .then((json) => {
        if (active) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Mission Control unavailable");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  return { data, loading, error, refresh };
}

// ── Recent Creations hook ──────────────────────────────────────────

interface RecentCreationsData {
  items: RecentCreation[];
  loading: boolean;
  error: string | null;
}

export function useRecentCreations(): RecentCreationsData {
  const [items, setItems] = useState<RecentCreation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch("/api/dashboard/widgets?widgets=recent-creations", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (active) {
          setItems((json["recent-creations"] as RecentCreation[]) ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Recent media unavailable");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { items, loading, error };
}

// ── Music Tracks hook ──────────────────────────────────────────────

interface MusicTracksData {
  tracks: PlayerTrack[];
  loading: boolean;
  error: string | null;
}

export function useMusicTracks(): MusicTracksData {
  const [tracks, setTracks] = useState<PlayerTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);

    fetch("/api/music/tracks", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (active) {
          setTracks((json.tracks as PlayerTrack[]) ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("Music tracks unavailable");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return { tracks, loading, error };
}

// ── Combined media items (creations + music tracks) ────────────────

interface CombinedMediaData {
  items: DashboardMediaItem[];
  loading: boolean;
  error: string | null;
}

export function useDashboardMedia(): CombinedMediaData {
  const creations = useRecentCreations();
  const music = useMusicTracks();

  const items: DashboardMediaItem[] = [];
  const favs = getFavorites();

  // Add music tracks
  for (const track of music.tracks) {
    items.push({
      id: track.id,
      title: track.title,
      type: "music",
      thumbnailUrl: null,
      url: "", // Stream URL is resolved on play
      createdAt: track.created_at ?? new Date().toISOString(),
      projectId: null,
      source: "litt",
      track,
      favorite: favs.has(track.id),
    });
  }

  // Add recent creations (images, videos)
  for (const creation of creations.items) {
    // Skip music creations that are already in tracks (dedup by title)
    if (creation.type === "music" || creation.type === "audio") {
      if (music.tracks.some((t) => t.title === creation.title)) continue;
    }
    items.push(creationToMediaItem(creation, favs.has(creation.id)));
  }

  // Sort by creation date (newest first)
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    items,
    loading: creations.loading || music.loading,
    error: creations.error && music.error ? "Media unavailable" : null,
  };
}

// ── Project derivation ─────────────────────────────────────────────

/**
 * Derive DashboardProject from the Mission Control project runtime.
 * Maps the raw runtime states to display-friendly statuses.
 */
export function deriveProject(
  project: MissionControlResponse["project"] | null,
): DashboardProject | null {
  if (!project) return null;

  const deploymentState = project.deploymentState;
  const workspaceState = project.workspaceState;

  let status: DashboardProject["status"] = "unknown";
  if (deploymentState === "production") status = "live";
  else if (deploymentState === "failed") status = "failed";
  else if (workspaceState === "failed") status = "failed";
  else if (workspaceState === "preparing" || deploymentState === "preview") status = "building";
  else if (workspaceState === "ready") status = "draft";
  else if (workspaceState === "missing") status = "unknown";

  // Extract project name from repository (last segment after /)
  const name = project.repository
    ? project.repository.split("/").pop() || project.repository
    : "Untitled Project";

  return {
    id: project.projectId,
    name,
    type: "project",
    branch: project.branch,
    status,
    updatedAt: project.updatedAt,
    repository: project.repository,
    latestCommit: project.latestCommit,
    deploymentState,
    previewState: project.previewState,
    workspaceState,
    terminalState: project.terminalState,
  };
}

// ── Pulse items derivation ─────────────────────────────────────────

/**
 * Derive pulse bar items from the Mission Control health + project data.
 * Only shows real/known status — never fakes green checks.
 */
export function derivePulseItems(
  data: MissionControlResponse | null,
): PulseItem[] {
  const items: PulseItem[] = [];

  // Deployment / Railway status from health
  const platformHealth = data?.health.filter((h) => h.category === "platform") ?? [];
  const railway = platformHealth.find((h) =>
    h.id.includes("railway") || h.label.toLowerCase().includes("railway"),
  );

  if (railway) {
    const state = railway.state;
    let pulseState: PulseItem["state"] = "unknown";
    if (state === "operational" || state === "connected" || state === "live") pulseState = "live";
    else if (state === "degraded" || state === "checking") pulseState = "building";
    else if (state === "unavailable" || state === "unauthorized" || state === "rate_limited" || state === "reconnect_required") pulseState = "failed";
    else if (state === "not_connected" || state === "missing") pulseState = "unknown";

    items.push({
      id: "railway",
      label: `Railway ${pulseState === "live" ? "Live" : pulseState === "building" ? "Building" : pulseState === "failed" ? "Failed" : "Unknown"}`,
      state: pulseState,
      detail: railway.detail || undefined,
      clickable: true,
    });
  } else {
    items.push({
      id: "railway",
      label: "Railway Unknown",
      state: "unknown",
      clickable: true,
    });
  }

  // Build status from project workspace state
  const project = data?.project;
  if (project) {
    const buildState = project.workspaceState;
    let buildPulse: PulseItem["state"] = "unknown";
    if (buildState === "ready") buildPulse = "passing";
    else if (buildState === "preparing") buildPulse = "building";
    else if (buildState === "failed") buildPulse = "failed";

    items.push({
      id: "build",
      label: `Build ${buildPulse === "passing" ? "Passing" : buildPulse === "building" ? "Building" : buildPulse === "failed" ? "Failed" : "Unknown"}`,
      state: buildPulse,
      clickable: true,
    });

    // Tests — we don't have a dedicated test status, so report unknown
    items.push({
      id: "tests",
      label: "Tests Unknown",
      state: "unknown",
      clickable: true,
    });

    // Branch
    items.push({
      id: "branch",
      label: project.branch,
      state: "idle",
      clickable: false,
    });

    // Commit
    if (project.latestCommit) {
      const shortSha = project.latestCommit.slice(0, 7);
      items.push({
        id: "commit",
        label: shortSha,
        state: "idle",
        clickable: false,
      });
    }

    // Terminal
    const termState = project.terminalState;
    let termPulse: PulseItem["state"] = "unknown";
    if (termState === "connected") termPulse = "live";
    else if (termState === "connecting") termPulse = "building";
    else if (termState === "failed") termPulse = "failed";

    items.push({
      id: "terminal",
      label: `Terminal ${termPulse === "live" ? "Ready" : termPulse === "building" ? "Connecting" : termPulse === "failed" ? "Failed" : "Unavailable"}`,
      state: termPulse,
      clickable: true,
    });
  } else {
    // No project — all unknown
    items.push(
      { id: "build", label: "Build Unknown", state: "unknown", clickable: true },
      { id: "tests", label: "Tests Unknown", state: "unknown", clickable: true },
      { id: "branch", label: "no branch", state: "idle", clickable: false },
    );
  }

  return items;
}

// ── Recent projects derivation ─────────────────────────────────────

/**
 * Derive recent projects from missions (each mission belongs to a project).
 * Groups by project and returns the most recently updated per project.
 */
export function deriveRecentProjects(
  data: MissionControlResponse | null,
): DashboardProject[] {
  if (!data) return [];

  const projects: DashboardProject[] = [];

  // The active project is always first
  const activeProject = deriveProject(data.project);
  if (activeProject) {
    projects.push(activeProject);
  }

  // Derive additional projects from missions
  const seenProjectIds = new Set(projects.map((p) => p.id));
  for (const mission of data.missions) {
    if (mission.projectId && !seenProjectIds.has(mission.projectId)) {
      seenProjectIds.add(mission.projectId);
      let status: DashboardProject["status"] = "unknown";
      if (mission.state === "executing") status = "building";
      else if (mission.state === "completed") status = "live";
      else if (mission.state === "failed") status = "failed";
      else status = "draft";

      projects.push({
        id: mission.projectId,
        name: mission.title,
        type: "mission",
        branch: "main",
        status,
        updatedAt: mission.updatedAt,
        repository: null,
        latestCommit: null,
        deploymentState: "none",
        previewState: "idle",
        workspaceState: "missing",
        terminalState: "disconnected",
      });
    }
  }

  return projects.slice(0, 8);
}
