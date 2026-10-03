"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
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
  const { isSignedIn } = useClerkAuth();
  const [project, setProject] = useState<GlobalLittProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    if (!isSignedIn) {
      setProject(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/global-litt", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load Global LiTT: ${res.status}`);
      }
      const data = await res.json();
      setProject(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject]);

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
