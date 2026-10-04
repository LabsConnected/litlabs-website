"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";

interface GlobalLittProject {
  id: string;
  name: string;
  slug: string;
}

interface GlobalLittContextValue {
  project: GlobalLittProject | null;
  projectId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const GlobalLittContext = createContext<GlobalLittContextValue>({
  project: null,
  projectId: null,
  loading: true,
  error: null,
  refresh: async () => {},
});

export function useGlobalLitt() {
  return useContext(GlobalLittContext);
}

export function GlobalLittProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, userId } = useClerkAuth();
  const [project, setProject] = useState<GlobalLittProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Generation counter: each identity change increments this.
  // Stale responses check if their generation is still current before applying.
  const generationRef = useRef(0);
  // AbortController for the in-flight request
  const abortRef = useRef<AbortController | null>(null);

  const fetchProject = useCallback(async () => {
    // Capture the identity and generation at call time
    const currentUserId = userId;
    const currentGeneration = ++generationRef.current;

    // Abort any in-flight request from a previous identity
    if (abortRef.current) {
      abortRef.current.abort();
    }

    if (!isSignedIn || !currentUserId) {
      // Logged out: clear all state
      setProject(null);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    // Don't clear project immediately — keep showing old data while loading new
    // (prevents flicker on identity change). It will be replaced or cleared below.

    try {
      const res = await fetch("/api/global-litt", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Failed to load Global LiTT: ${res.status}`);
      }
      const data = await res.json();

      // STALE RESPONSE GUARD: Only apply if this is still the current generation
      // and the userId hasn't changed since we started.
      if (generationRef.current !== currentGeneration) {
        // A newer request has started — discard this stale response
        return;
      }

      setProject(data.project);
    } catch (err) {
      // AbortError is expected on identity change — don't treat as error
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      // Only apply error if still current generation
      if (generationRef.current === currentGeneration) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setProject(null);
      }
    } finally {
      // Only clear loading if still current generation
      if (generationRef.current === currentGeneration) {
        setLoading(false);
      }
    }
  }, [isSignedIn, userId]);

  // Reset state when identity changes (including logout)
  useEffect(() => {
    // Clear project immediately on identity change to prevent
    // showing user A's project to user B during the loading window
    setProject(null);
    setError(null);
    fetchProject();
  }, [fetchProject]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  return (
    <GlobalLittContext.Provider
      value={{
        project,
        projectId: project?.id ?? null,
        loading,
        error,
        refresh: fetchProject,
      }}
    >
      {children}
    </GlobalLittContext.Provider>
  );
}
