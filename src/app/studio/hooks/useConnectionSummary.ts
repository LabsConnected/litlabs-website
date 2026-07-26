"use client";

import { useCallback, useEffect, useState } from "react";
import { useTerminalStore } from "@/stores/useTerminalStore";
import type { TerminalStatus } from "@/lib/capabilities/types";

export interface ConnectionCapabilities {
  repository: string;
  repositoryName: string | null;
  repositoryIndexed: boolean;
  terminalExecution: "available" | "unavailable" | "connecting" | "degraded" | "error";
  writeAccess: boolean;
  connectedProviders: string[];
  availableTools: string[];
  connectionSummary: string;
  terminalStatus: TerminalStatus;
  terminalSessionId: string | null;
  terminalError: string | null;
}

const DEFAULT_CAPABILITIES: ConnectionCapabilities = {
  repository: "none",
  repositoryName: null,
  repositoryIndexed: false,
  terminalExecution: "unavailable",
  writeAccess: false,
  connectedProviders: [],
  availableTools: [],
  connectionSummary: "No services connected.",
  terminalStatus: "disconnected",
  terminalSessionId: null,
  terminalError: null,
};

export function useConnectionSummary() {
  const [capabilities, setCapabilities] = useState<ConnectionCapabilities>(
    DEFAULT_CAPABILITIES,
  );

  // Client-side terminal store is the source of truth for PTY status
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalError = useTerminalStore((s) => s.error);

  const refresh = useCallback(async () => {
    try {
      const [capsRes, termRes] = await Promise.allSettled([
        fetch("/api/capabilities", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
        fetch("/api/capabilities/project-terminal", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      ]);

      const next = { ...DEFAULT_CAPABILITIES };

      if (capsRes.status === "fulfilled" && capsRes.value.ok) {
        const data = await capsRes.value.json();
        const caps = data.capabilities ?? [];
        const repoCap = caps.find((c: { id: string }) => c.id === "repository");
        next.repository = repoCap?.status === "ready" ? "connected" : "none";
        next.repositoryName = repoCap?.accountName ?? null;
        next.repositoryIndexed = repoCap?.status === "ready";
        next.connectedProviders = caps
          .filter((c: { status: string }) => c.status === "ready" || c.status === "running")
          .map((c: { id: string }) => c.id);
        next.availableTools = caps
          .filter((c: { status: string }) => c.status === "ready" || c.status === "running")
          .map((c: { id: string }) => c.id);
        next.connectionSummary =
          next.connectedProviders.length > 0
            ? `Connected: ${next.connectedProviders.join(", ")}`
            : "No services connected.";
      }

      // Use client-side terminal store as primary source of truth for PTY status
      // Only fall back to server-side if client hasn't connected yet
      if (terminalStatus === "connected") {
        next.terminalStatus = "connected";
        next.terminalSessionId = terminalSessionId;
        next.terminalExecution = "available";
      } else if (terminalStatus === "connecting") {
        next.terminalStatus = "connecting";
        next.terminalExecution = "connecting";
      } else if (terminalStatus === "error") {
        next.terminalStatus = "error";
        next.terminalError = terminalError;
        next.terminalExecution = "error";
      } else {
        // Client says disconnected — check if server is at least alive
        if (termRes.status === "fulfilled" && termRes.value.ok) {
          const termData = await termRes.value.json();
          // Server confirms: terminal server exists but no session
          next.terminalStatus = "disconnected";
          next.terminalSessionId = null;
          next.terminalExecution = "unavailable";
          next.terminalError = termData.error ?? null;
        } else {
          next.terminalStatus = "disconnected";
          next.terminalExecution = "unavailable";
        }
      }

      setCapabilities(next);
    } catch {
      // leave previous state
    }
  }, [terminalStatus, terminalSessionId, terminalError]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { capabilities, refresh };
}
