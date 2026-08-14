"use client";

/**
 * LiTTRuntimeProvider — Studio-level context for canonical agent runtime state.
 *
 * Wraps useLiTTRuntime() in a React context so all Studio components
 * can consume the same Socket.IO connection and runtime snapshot
 * without each opening their own socket.
 *
 * The hook itself uses a module-level singleton socket, so multiple
 * calls to useLiTTRuntime() already share one connection. This provider
 * adds explicit lifecycle management and a clean context API.
 *
 * Phase 2D.1: Studio ↔ CLI Runtime Convergence
 */

import { createContext, useContext, type ReactNode } from "react";
import {
  useLiTTRuntime,
  type UseLiTTRuntimeResult,
} from "@/hooks/useLiTTRuntime";

const LiTTRuntimeContext = createContext<UseLiTTRuntimeResult | null>(null);

export interface LiTTRuntimeProviderProps {
  children: ReactNode;
  /** Terminal server WebSocket URL (defaults to env var or localhost:4001) */
  url?: string;
  /** Auth token for terminal server (optional) */
  token?: string | null;
}

export function LiTTRuntimeProvider({
  children,
  url,
  token,
}: LiTTRuntimeProviderProps) {
  const runtime = useLiTTRuntime({ url, token });

  return (
    <LiTTRuntimeContext.Provider value={runtime}>
      {children}
    </LiTTRuntimeContext.Provider>
  );
}

/**
 * Consume the canonical LiTT runtime state from anywhere inside Studio.
 * Returns null if used outside LiTTRuntimeProvider (graceful degradation).
 */
export function useLiTTRuntimeContext(): UseLiTTRuntimeResult | null {
  return useContext(LiTTRuntimeContext);
}

/**
 * Consume the canonical LiTT runtime state, with a fallback to
 * calling the hook directly if no provider is mounted.
 * This allows components to work with or without the provider.
 */
export function useStudioRuntime(): UseLiTTRuntimeResult {
  const ctx = useContext(LiTTRuntimeContext);
  // If a provider is mounted, use its value.
  // Otherwise, fall back to calling the hook directly (singleton socket).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return ctx ?? useLiTTRuntime();
}
