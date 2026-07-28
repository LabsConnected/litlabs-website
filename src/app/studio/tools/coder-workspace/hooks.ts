/**
 * Data-loading hooks for the CoderWorkspace shell.
 *
 * Each hook wraps a single existing API endpoint and returns a truthful
 * { data, status, error } tuple. No data is faked — missing endpoints,
 * network failures, and empty states all produce their correct status.
 *
 * Phase 1 only. These hooks READ. They do not mutate, do not call AI,
 * and do not touch /api/litt/run (which does not exist yet).
 */

import { useCallback, useEffect, useState } from "react";
import type {
  CanvasSummary,
  CheckpointSummary,
  FileEntry,
  LoadStatus,
  ProjectListResponse,
  StudioProject,
} from "./types";

// ─── Project list ─────────────────────────────────────────────────────────

export function useProjectData() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch("/api/studio-projects", { cache: "no-store" });
      const payload = (await response.json()) as ProjectListResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load projects");
      }
      const all = [...(payload.projects ?? []), ...(payload.legacyOnly ?? [])];
      setProjects(all);
      setStatus("ready");
      return all;
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load projects",
      );
      setProjects([]);
      setStatus("error");
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { projects, status, error, refresh };
}

// ─── File tree ────────────────────────────────────────────────────────────

export function useFilesData(projectId: string) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setFiles([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=.`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((data: { entries?: FileEntry[]; error?: string }) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setFiles(data.entries ?? []);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load files");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { files, status, error };
}

// ─── Preview status ───────────────────────────────────────────────────────

export function usePreviewData(projectId: string) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setPreviewUrl(null);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then(
        (data: {
          runtimeStatus?: string;
          previewUrl?: string | null;
          runtimeError?: string | null;
        }) => {
          if (cancelled) return;
          setPreviewUrl(data.previewUrl ?? null);
          setStatus(data.runtimeStatus === "ready" ? "ready" : "idle");
          if (data.runtimeError) setError(data.runtimeError);
        },
      )
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load preview");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { previewUrl, status, error };
}

// ─── Canvases for a project ───────────────────────────────────────────────

export function useCanvasesData(projectId: string) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");

  useEffect(() => {
    if (!projectId) {
      setCanvases([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/canvases?projectId=${encodeURIComponent(projectId)}&status=active`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { canvases?: CanvasSummary[] }) => {
        if (cancelled) return;
        setCanvases(data.canvases ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { canvases, status };
}

// ─── Checkpoints for a project ───────────────────────────────────────────

export function useCheckpointsData(projectId: string) {
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("idle");

  useEffect(() => {
    if (!projectId) {
      setCheckpoints([]);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checkpoints`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { checkpoints?: CheckpointSummary[] }) => {
        if (cancelled) return;
        setCheckpoints(data.checkpoints ?? []);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { checkpoints, status };
}
