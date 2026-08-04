"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useVoiceSession } from "../context/VoiceSessionContext";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useProjectRuntime } from "./useProjectRuntime";
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
  activeBranch: string | null;
  sourceType: "github" | "blank" | "template" | "upload" | null;
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
  activeBranch: null,
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

  // Canonical project runtime — the ONE source of truth for project identity
  const { state: runtimeState } = useProjectRuntime();

  // Client-side terminal store is the source of truth for PTY status
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalError = useTerminalStore((s) => s.error);
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();
  const { getToken } = useClerkAuth();
  const searchParams = useSearchParams();
  const explicitProjectId = searchParams.get("project");

  const refresh = useCallback(async () => {
    try {
      const token = await getToken?.();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [capsRes, termRes, voiceRes, llmRes] = await Promise.allSettled([
        fetch(`/api/capabilities${explicitProjectId ? `?projectId=${encodeURIComponent(explicitProjectId)}` : ""}`, { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
        fetch("/api/capabilities/project-terminal", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
        fetch("/api/voice/health", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
        fetch("/api/llm/health", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
      ]);

      const next = { ...DEFAULT_CAPABILITIES };

      if (capsRes.status === "fulfilled" && capsRes.value.ok) {
        const data = await capsRes.value.json();
        const caps = data.capabilities ?? [];
        const repoCap = caps.find((c: { id: string }) => c.id === "repository");
        const projectCap = caps.find((c: { id: string }) => c.id === "project");
        const workspaceCap = caps.find((c: { id: string }) => c.id === "runtime.sandbox");
        next.repository = repoCap?.status === "ready" ? "connected" : "none";
        next.repositoryName = repoCap?.accountName ?? null;
        next.repositoryIndexed = repoCap?.status === "ready";
        // Prefer the project capability for projectId — a blank project
        // is valid even without a repository.
        next.projectId = projectCap?.projectId ?? repoCap?.projectId ?? null;
        next.projectName = projectCap?.projectName ?? repoCap?.projectName ?? null;
        next.defaultBranch = repoCap?.defaultBranch ?? null;
        next.activeBranch = repoCap?.activeBranch ?? repoCap?.defaultBranch ?? null;
        next.workspaceStatus = workspaceCap?.status ?? null;
        next.writeAccess = workspaceCap?.status === "ready";
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

      // Voice transport and microphone are client-side runtime state.
      next.voiceTransportConnected = voiceTransportConnected;
      next.voiceMicrophoneOn = voiceInputState === "listening";

      // LLM provider health — sync to model store so the empty-state
      // briefing and model picker show accurate "AI ready" status.
      const setProviderHealth = useStudioModelStore.getState().setProviderHealth;
      if (llmRes.status === "fulfilled" && llmRes.value.ok) {
        const llmData = await llmRes.value.json();
        const geminiOk = !!llmData.gemini?.available;
        const groqOk = !!llmData.groq?.available;
        const openrouterOk = !!llmData.openrouter?.available;
        setProviderHealth("gemini", geminiOk ? "available" : "unavailable");
        setProviderHealth("groq", groqOk ? "available" : "unavailable");
        setProviderHealth("openrouter", openrouterOk ? "available" : "unavailable");
        // "Auto" models route to whichever provider is available (prefer Gemini).
        setProviderHealth("Auto", geminiOk || groqOk || openrouterOk ? "available" : "unavailable");
      } else {
        // Health endpoint failed — mark all as unavailable so the UI
        // shows a truthful "setup required" rather than a stale unknown.
        setProviderHealth("gemini", "unavailable");
        setProviderHealth("groq", "unavailable");
        setProviderHealth("openrouter", "unavailable");
        setProviderHealth("Auto", "unavailable");
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

      // Allow writes when the terminal is connected (local dev) even if
      // the server-side workspace hasn't been provisioned. The terminal
      // PTY can execute file writes, so it's a valid write surface.
      if (next.terminalExecution === "available" && !next.writeAccess) {
        next.writeAccess = true;
      }

      // ── Merge canonical runtime state ──────────────────────────────
      // The project-runtime API is the single source of truth for project
      // identity, workspace, and branch. Override whatever the capabilities
      // endpoint returned with the canonical values so every Studio surface
      // shows the same project.
      if (runtimeState.projectId) {
        next.projectId = runtimeState.projectId;
        next.projectName = runtimeState.projectName;
        next.repository = runtimeState.repository ? "connected" : next.repository;
        next.repositoryName = runtimeState.repository ?? next.repositoryName;
        next.activeBranch = runtimeState.branch ?? next.activeBranch;
        next.defaultBranch = runtimeState.branch ?? next.defaultBranch;
        next.sourceType = runtimeState.sourceType ?? next.sourceType;
        next.workspaceStatus = runtimeState.workspaceStatus ?? next.workspaceStatus;
        next.writeAccess = runtimeState.writeAccess || next.writeAccess;
      }

      setCapabilities(next);
    } catch {
      // leave previous state
    } finally {
      setLoading(false);
    }
  }, [terminalStatus, terminalSessionId, terminalError, voiceTransportConnected, voiceInputState, getToken, explicitProjectId, runtimeState.projectId, runtimeState.projectName, runtimeState.repository, runtimeState.branch, runtimeState.workspaceStatus, runtimeState.writeAccess, runtimeState.sourceType]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { capabilities, refresh, loading };
}
