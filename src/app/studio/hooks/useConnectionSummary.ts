"use client";

import { useCallback, useEffect, useState } from "react";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { TerminalStatus } from "@/lib/capabilities/types";

export interface VoiceHealthState {
  /** Inworld env vars are set (server-side check) */
  configured: boolean;
  /** Token service actually works (tested by /api/voice/health) */
  tokenService: "healthy" | "error" | "unknown";
  /** Voice is available to use (configured + token service healthy) */
  available: boolean;
  /** Error code if unavailable */
  errorCode?: string;
  /** Human-readable message */
  message?: string;
  /** When the health was last checked */
  checkedAt?: string;
}

export interface ConnectionCapabilities {
  repository: string;
  repositoryName: string | null;
  repositoryIndexed: boolean;
  projectId: string | null;
  projectName: string | null;
  defaultBranch: string | null;
  sourceType: "github" | "blank" | "template" | null;
  workspaceStatus: string | null;
  githubInstalled: boolean;
  terminalExecution: "available" | "unavailable" | "connecting" | "degraded" | "error";
  writeAccess: boolean;
  connectedProviders: string[];
  availableTools: string[];
  connectionSummary: string;
  terminalStatus: TerminalStatus;
  terminalSessionId: string | null;
  terminalError: string | null;
  /** Voice transport connected (TTS-ready). Client-derived from VoiceSessionContext. */
  voiceTransportConnected: boolean;
  /** Microphone currently capturing audio. Client-derived from VoiceSessionContext. */
  voiceMicrophoneOn: boolean;
  /** Voice health from /api/voice/health (server-side check). */
  voiceHealth: VoiceHealthState;
}

const DEFAULT_CAPABILITIES: ConnectionCapabilities = {
  repository: "none",
  repositoryName: null,
  repositoryIndexed: false,
  projectId: null,
  projectName: null,
  defaultBranch: null,
  sourceType: null,
  workspaceStatus: null,
  githubInstalled: false,
  terminalExecution: "unavailable",
  writeAccess: false,
  connectedProviders: [],
  availableTools: [],
  connectionSummary: "No services connected.",
  terminalStatus: "disconnected",
  terminalSessionId: null,
  terminalError: null,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: {
    configured: false,
    tokenService: "unknown",
    available: false,
  },
};

export function useConnectionSummary() {
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<ConnectionCapabilities>(
    DEFAULT_CAPABILITIES,
  );

  // Client-side terminal store is the source of truth for PTY status
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalError = useTerminalStore((s) => s.error);
  const { isLoaded, isSignedIn } = useClerkAuth();

  const refresh = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }
    try {
      const [capsRes, termRes, voiceRes] = await Promise.allSettled([
        fetch("/api/capabilities", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
        fetch("/api/capabilities/project-terminal", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
        fetch("/api/voice/health", { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      ]);

      const next = { ...DEFAULT_CAPABILITIES };

      if (capsRes.status === "fulfilled" && capsRes.value.ok) {
        const data = await capsRes.value.json();
        const caps = data.capabilities ?? [];
        const repoCap = caps.find((c: { id: string }) => c.id === "repository");
        const projectCap = caps.find((c: { id: string }) => c.id === "project");
        next.repository = repoCap?.status === "ready" ? "connected" : "none";
        next.repositoryName = repoCap?.accountName ?? null;
        next.repositoryIndexed = repoCap?.status === "ready";
        // Prefer the project capability for projectId — a blank project
        // is valid even without a repository.
        next.projectId = projectCap?.projectId ?? repoCap?.projectId ?? null;
        next.projectName = projectCap?.projectName ?? repoCap?.projectName ?? null;
        next.defaultBranch = repoCap?.defaultBranch ?? null;
        next.githubInstalled = repoCap?.status === "unavailable";
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

      // Voice health — server-side check of Inworld configuration + token service
      if (voiceRes.status === "fulfilled" && voiceRes.value.ok) {
        const voiceData = await voiceRes.value.json();
        next.voiceHealth = {
          configured: !!voiceData.configured,
          tokenService: voiceData.tokenService === "healthy" ? "healthy" : "error",
          available: !!voiceData.available,
          errorCode: voiceData.errorCode,
          message: voiceData.message,
          checkedAt: voiceData.checkedAt,
        };
      } else {
        // Health endpoint failed — mark as unknown, don't silently reuse old state
        next.voiceHealth = {
          configured: false,
          tokenService: "unknown",
          available: false,
          errorCode: "VOICE_HEALTH_UNREACHABLE",
          message: "Voice health check failed.",
        };
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
    } finally {
      setLoading(false);
    }
  }, [terminalStatus, terminalSessionId, terminalError, isLoaded, isSignedIn]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { capabilities, refresh, loading };
}
