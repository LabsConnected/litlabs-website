"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import type { DirectorState } from "./HoloDirector";

export type RunStep = {
  id: string;
  role: "user" | "plan" | "tool" | "result" | "agent";
  content: string;
  timestamp: number;
  runId?: string;
};

export type Artifact = {
  id: string;
  type: "image" | "video" | "file";
  url: string;
  title: string;
  downloadUrl?: string;
  width?: number;
  height?: number;
};

type DirectorRuntimeValue = {
  state: DirectorState;
  audioLevel: number;
  steps: RunStep[];
  artifacts: Artifact[];
  activeArtifact: Artifact | null;
  activeRunId: string | null;
  setState: (state: DirectorState) => void;
  setAudioLevel: (level: number) => void;
  addUserStep: (content: string) => string;
  startRun: (runId: string) => void;
  addPlanStep: (runId: string, content: string) => void;
  addToolStep: (runId: string, content: string) => void;
  addResultStep: (runId: string, content: string) => void;
  setAgentResponse: (runId: string, content: string) => void;
  addArtifact: (artifact: Artifact) => void;
  setActiveArtifact: (artifact: Artifact | null) => void;
  clearRun: () => void;
};

const DirectorRuntimeContext = createContext<DirectorRuntimeValue | null>(null);

export function DirectorRuntimeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setStateRaw] = useState<DirectorState>("idle");
  const [audioLevel, setAudioLevelRaw] = useState(0);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  const addUserStep = useCallback((content: string) => {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    runIdRef.current = runId;
    setActiveRunId(runId);
    const step: RunStep = {
      id: `u_${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
      runId,
    };
    setSteps((prev) => [...prev, step]);
    return runId;
  }, []);

  const startRun = useCallback((runId: string) => {
    runIdRef.current = runId;
    setActiveRunId(runId);
  }, []);

  const upsertStep = useCallback(
    (
      runId: string,
      role: RunStep["role"],
      content: string,
      replace = false,
    ) => {
      setSteps((prev) => {
        const existing = replace
          ? prev.find((s) => s.runId === runId && s.role === role)
          : undefined;
        if (existing) {
          return prev.map((s) =>
            s.id === existing.id ? { ...s, content } : s,
          );
        }
        return [
          ...prev,
          {
            id: `${role}_${Date.now()}`,
            role,
            content,
            timestamp: Date.now(),
            runId,
          },
        ];
      });
    },
    [],
  );

  const addPlanStep = useCallback(
    (runId: string, content: string) =>
      upsertStep(runId, "plan", content, true),
    [upsertStep],
  );
  const addToolStep = useCallback(
    (runId: string, content: string) =>
      upsertStep(runId, "tool", content, true),
    [upsertStep],
  );
  const addResultStep = useCallback(
    (runId: string, content: string) =>
      upsertStep(runId, "result", content, false),
    [upsertStep],
  );
  const setAgentResponse = useCallback(
    (runId: string, content: string) =>
      upsertStep(runId, "agent", content, true),
    [upsertStep],
  );

  const setState = useCallback((next: DirectorState) => {
    if (next !== "speaking" && next !== "listening") {
      setAudioLevelRaw(0);
    }
    setStateRaw(next);
  }, []);

  const setAudioLevel = useCallback((level: number) => {
    setAudioLevelRaw(level);
  }, []);

  const addArtifact = useCallback((artifact: Artifact) => {
    setArtifacts((prev) => [...prev, artifact]);
    setActiveArtifact(artifact);
  }, []);

  const clearRun = useCallback(() => {
    setActiveRunId(null);
    runIdRef.current = null;
    setStateRaw("idle");
    setAudioLevelRaw(0);
  }, []);

  return (
    <DirectorRuntimeContext.Provider
      value={{
        state,
        audioLevel,
        steps,
        artifacts,
        activeArtifact,
        activeRunId,
        setState,
        setAudioLevel,
        addUserStep,
        startRun,
        addPlanStep,
        addToolStep,
        addResultStep,
        setAgentResponse,
        addArtifact,
        setActiveArtifact,
        clearRun,
      }}
    >
      {children}
    </DirectorRuntimeContext.Provider>
  );
}

export function useDirectorRuntime() {
  const ctx = useContext(DirectorRuntimeContext);
  if (!ctx) {
    throw new Error(
      "useDirectorRuntime must be used inside DirectorRuntimeProvider",
    );
  }
  return ctx;
}
