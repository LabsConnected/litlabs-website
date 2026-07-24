"use client";

import { useCallback, useEffect, useState } from "react";
import type { TerminalStatus } from "@/lib/capabilities/types";

export interface ConnectionCapabilities {
  repository: string;
  repositoryIndexed: boolean;
  terminalExecution: "available" | "unavailable" | "connecting" | "degraded";
  writeAccess: boolean;
  connectedProviders: string[];
  availableTools: string[];
  connectionSummary: string;
  terminalStatus: TerminalStatus;
  terminalSessionId: string | null;
}

const DEFAULT_CAPABILITIES: ConnectionCapabilities = {
  repository: "none",
  repositoryIndexed: false,
  terminalExecution: "unavailable",
  writeAccess: false,
  connectedProviders: [],
  availableTools: [],
  connectionSummary: "No services connected.",
  terminalStatus: "disconnected",
  terminalSessionId: null,
};

export function useConnectionSummary() {
  const [capabilities, setCapabilities] = useState<ConnectionCapabilities>(
    DEFAULT_CAPABILITIES,
  );

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

      if (termRes.status === "fulfilled" && termRes.value.ok) {
        const termData = await termRes.value.json();
        next.terminalStatus = termData.terminalStatus ?? "disconnected";
        next.terminalSessionId = termData.sessionId ?? null;
        next.terminalExecution =
          termData.terminalStatus === "connected"
            ? "available"
            : termData.terminalStatus === "connecting"
              ? "connecting"
              : termData.terminalStatus === "error"
                ? "unavailable"
                : "unavailable";
      }

      setCapabilities(next);
    } catch {
      // leave previous state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { capabilities, refresh };
}
