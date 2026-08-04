"use client";

/**
 * useActiveProject — unified active project hook.
 *
 * Replaces the split localStorage keys used by Dashboard and Studio.
 * The active project is now server-authoritative via /api/project/active.
 *
 * Both Dashboard (Mission Control) and Studio use this hook to:
 * - Read the current active project
 * - Set a new active project (synchronized across all surfaces)
 *
 * The hook cleans up old localStorage keys on mount to migrate
 * existing users to the new server-authoritative system.
 */

import { useCallback, useEffect, useState } from "react";

export interface ActiveProject {
  projectId: string | null;
  projectName?: string;
  repositoryFullName?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  source?: string;
}

interface UseActiveProjectResult {
  activeProject: ActiveProject | null;
  isLoading: boolean;
  error: string | null;
  setActiveProject: (projectId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// Old localStorage keys to clean up during migration
const OLD_KEYS = [
  "litt:active-project-id",
  "studio-active-project",
  "dashboard-project",
  "mission-control-project",
  "selected-repo",
];

export function useActiveProject(): UseActiveProjectResult {
  const [activeProject, setActiveProjectState] = useState<ActiveProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveProject = useCallback(async () => {
    try {
      const res = await fetch("/api/project/active", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status !== 401) {
          setError(`Failed to load active project (${res.status})`);
        }
        setActiveProjectState(null);
        return;
      }
      const data = await res.json();
      setActiveProjectState(data);
      setError(null);
    } catch {
      // Non-fatal — offline or server unavailable
      setError(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount and clean up old localStorage keys
  useEffect(() => {
    // Clean up old localStorage keys — migrate to server-authoritative system
    if (typeof window !== "undefined") {
      for (const key of OLD_KEYS) {
        // Also clean up user-scoped variants (litt:active-project-id:{userId})
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const storageKey = localStorage.key(i);
          if (storageKey && (storageKey === key || storageKey.startsWith(`${key}:`))) {
            localStorage.removeItem(storageKey);
          }
        }
      }
    }
    void fetchActiveProject();
  }, [fetchActiveProject]);

  const setActiveProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch("/api/project/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed to set active project (${res.status})`);
        return;
      }
      const data = await res.json();
      setActiveProjectState({
        projectId: data.projectId,
        projectName: data.projectName,
      });
      setError(null);
    } catch {
      setError("Network error while setting active project");
    }
  }, []);

  return {
    activeProject,
    isLoading,
    error,
    setActiveProject,
    refresh: fetchActiveProject,
  };
}
