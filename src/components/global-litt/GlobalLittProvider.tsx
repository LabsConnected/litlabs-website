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
  const [state, setState] = useState<{ ownerId: string; project: GlobalLittProject } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const project = isSignedIn && state?.ownerId === userId ? state.project : null;

  const fetchProject = useCallback(async () => {
    request.current.controller?.abort();
    const generation = ++request.current.generation;
    setState(null);
    setError(null);
    if (!isSignedIn || !userId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    request.current.controller = controller;
    const current = () => !controller.signal.aborted && request.current.generation === generation;
    setLoading(true);
    try {
      const res = await fetch("/api/global-litt", { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`Failed to load Global LiTT: ${res.status}`);
      const data = await res.json();
      if (current()) setState({ ownerId: userId, project: data.project });
    } catch (err) {
      if (current()) setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      if (current()) setLoading(false);
    }
  }, [isSignedIn, userId]);

  useEffect(() => {
    const lifecycle = request.current;
    void fetchProject();
    return () => {
      lifecycle.controller?.abort();
      ++lifecycle.generation;
    };
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
