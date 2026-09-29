"use client";

import { useEffect, useRef } from "react";
import { useExecutionStore } from "../stores/useExecutionStore";
import { useTerminalStore } from "@/stores/useTerminalStore";

/**
 * Phase 4 — project isolation.
 *
 * On project switch (A→B), ALL project-scoped runtime state must reset so
 * nothing from project A is visible while working in project B:
 * - execution store: events, phases, run state, pending approvals,
 *   checkpoints, preview-preparing flag, per-task mirrors
 * - terminal store: sessionId, cwd, connection status, heartbeat, errors
 *
 * Deliberately NOT reset:
 * - user-global preferences (theme, settings — useSettingsStore)
 * - server-persisted worktabs (useStudioTasks re-fetches per project)
 * - conversation state (the conversation store resets itself per project
 *   via resetForProject)
 *
 * The reset fires in an effect (not only in the switch click handler) so
 * every path that changes the project — switcher, new project, project
 * deletion, deep link — is covered. The child TerminalPanel re-attaches
 * for the new project asynchronously (session:ready), strictly after
 * this synchronous reset, so the reset can never wipe the new session.
 */
export function useProjectIsolation(projectId: string | null | undefined) {
  const prevProjectIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;
    useExecutionStore.getState().reset();
    useTerminalStore.getState().reset();
  }, [projectId]);
}
