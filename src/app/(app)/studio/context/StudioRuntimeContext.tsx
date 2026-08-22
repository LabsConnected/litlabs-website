"use client";

/**
 * StudioRuntimeContext — the ONE canonical Studio control-plane state.
 *
 * Composes three INDEPENDENT subtrees into a single context:
 *
 *   StudioRuntimeState
 *        │
 *    ┌───┼───┐
 *    │   │   │
 *  project serviceHealth run
 *    │   │   │
 *  project  LLM    task/run ID
 *  repo     voice   mode
 *  branch   wallet  plan
 *  workspace github  approval
 *  terminal platform checks
 *  permissions       evidence
 *
 * NO component gets to invent readiness anymore. The header, welcome screen,
 * LiTT panel, Plan tab, sidebar status, and operator bar all read from this
 * same derived state.
 *
 * Subtrees:
 * - `project`: from useProjectRuntime (server-authoritative via /api/project-runtime)
 * - `serviceHealth`: from useServiceHealth (LLM/voice/GitHub/platform, independent)
 * - `run`: from useExecutionStore (live execution phase, approvals, checkpoints)
 *
 * Phase 1 — Studio Control Plane V1
 */

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useProjectRuntime, type UseProjectRuntimeResult } from "../hooks/useProjectRuntime";
import { useServiceHealth, type UseServiceHealthResult } from "../hooks/useServiceHealth";
import { useExecutionStore, type ExecutionPhase } from "../stores/useExecutionStore";

// ─── Types ───────────────────────────────────────────────────────

export interface StudioRuntimeState {
  /** Project + workspace + terminal readiness (server-authoritative) */
  project: UseProjectRuntimeResult;
  /** Service health — LLM/voice/GitHub/platform (independent from project) */
  serviceHealth: UseServiceHealthResult;
  /** Active run — live execution phase, approvals, checkpoints */
  run: {
    phase: ExecutionPhase;
    isRunning: boolean;
    pendingApproval: ReturnType<typeof useExecutionStore.getState>["pendingApproval"];
    checkpoint: ReturnType<typeof useExecutionStore.getState>["checkpoint"];
  };
}

// ─── Context ─────────────────────────────────────────────────────

const StudioRuntimeContext = createContext<StudioRuntimeState | null>(null);

// ─── Provider ────────────────────────────────────────────────────

export interface StudioRuntimeProviderProps {
  children: ReactNode;
}

/**
 * StudioRuntimeProvider — mounts the canonical runtime state.
 *
 * This provider calls useProjectRuntime, useServiceHealth, and reads
 * from useExecutionStore. It should be mounted ONCE at the Studio root
 * (inside CommandStudio or the Studio page layout) so all descendants
 * share the same state.
 */
export function StudioRuntimeProvider({ children }: StudioRuntimeProviderProps) {
  const project = useProjectRuntime();
  const serviceHealth = useServiceHealth();

  // Read execution store state — this is a Zustand store, so we select
  // only the fields we need to avoid unnecessary re-renders.
  const phase = useExecutionStore((s) => s.phase);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const pendingApproval = useExecutionStore((s) => s.pendingApproval);
  const checkpoint = useExecutionStore((s) => s.checkpoint);

  const value: StudioRuntimeState = useMemo(
    () => ({
      project,
      serviceHealth,
      run: { phase, isRunning, pendingApproval, checkpoint },
    }),
    [project, serviceHealth, phase, isRunning, pendingApproval, checkpoint],
  );

  return (
    <StudioRuntimeContext.Provider value={value}>
      {children}
    </StudioRuntimeContext.Provider>
  );
}

// ─── Hooks ───────────────────────────────────────────────────────

/**
 * useStudioRuntime — access the canonical Studio runtime state.
 *
 * Throws if used outside a StudioRuntimeProvider to prevent
 * silent context-less rendering with stale defaults.
 */
export function useStudioRuntime(): StudioRuntimeState {
  const ctx = useContext(StudioRuntimeContext);
  if (!ctx) {
    throw new Error("useStudioRuntime must be used within a StudioRuntimeProvider");
  }
  return ctx;
}

/**
 * useStudioRuntimeOptional — access the runtime state, or null if no
 * provider is mounted. Use this for components that need to work both
 * inside and outside Studio (e.g. settings page).
 */
export function useStudioRuntimeOptional(): StudioRuntimeState | null {
  return useContext(StudioRuntimeContext);
}
