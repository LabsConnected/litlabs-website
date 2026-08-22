"use client";

/**
 * useConnectionSummary — COMPATIBILITY SHIM.
 *
 * This hook is now a thin derivation from the canonical Studio runtime state.
 * It NO LONGER independently fetches from /api/capabilities, /api/voice/health,
 * /api/llm/health, or /api/capabilities/project-terminal. Those fetches are
 * handled by useServiceHealth, and project/workspace state by useProjectRuntime.
 *
 * This eliminates the competing aggregation layer that caused contradictory
 * readiness reports (e.g. "1 AI" vs "setup required").
 *
 * Existing consumers that read `capabilities` from this hook continue to work
 * without changes. New code should use useStudioRuntime() directly.
 *
 * Phase 1 — Studio Control Plane V1
 */

import { useMemo } from "react";
import { useTerminalStore } from "@/stores/useTerminalStore";
import { useProjectRuntime } from "./useProjectRuntime";
import { useServiceHealth } from "./useServiceHealth";
import { useStudioRuntimeOptional } from "../context/StudioRuntimeContext";
import type { TerminalStatus } from "@/lib/capabilities/types";

// ─── Types (preserved for backward compatibility) ───────────────

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
  terminalExecution: "available" | "unavailable" | "connecting" | "degraded" | "error" | "idle";
  writeAccess: boolean;
  connectedProviders: string[];
  availableTools: string[];
  connectionSummary: string;
  terminalStatus: TerminalStatus;
  terminalSessionId: string | null;
  terminalError: string | null;
  /** Specific failure stage from the terminal store — for LiTTAI diagnostics. */
  terminalFailureStage: string | null;
  /** Verified cwd from PTY session — only set when PTY is truly ready. */
  terminalCwd: string | null;
  /** True when the terminal server /health endpoint responded OK (server is alive). */
  terminalServerReachable: boolean;
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
  terminalFailureStage: null,
  terminalCwd: null,
  terminalServerReachable: false,
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  voiceHealth: {
    configured: false,
    tokenService: "unknown",
    available: false,
  },
};

// ─── Hook (pure derivation, zero fetches) ────────────────────────

export function useConnectionSummary() {
  // Prefer the shared StudioRuntimeProvider context when available
  // (inside Studio) to avoid duplicate polling. The hooks below are
  // always called unconditionally (React rules of hooks), but their
  // results are only used when no provider is mounted.
  const ctx = useStudioRuntimeOptional();

  // Canonical project runtime — server-authoritative
  const directProject = useProjectRuntime();
  const { state: runtimeState, loading: projectLoading, refresh: refreshProject } =
    ctx?.project ?? directProject;

  // Canonical service health — LLM/voice/GitHub/terminal-server
  const directHealth = useServiceHealth();
  const { state: healthState, loading: healthLoading, refresh: refreshHealth } =
    ctx?.serviceHealth ?? directHealth;

  // Client-side terminal store — source of truth for PTY session state
  const terminalStatus = useTerminalStore((s) => s.status);
  const terminalSessionId = useTerminalStore((s) => s.sessionId);
  const terminalError = useTerminalStore((s) => s.error);
  const terminalFailureStage = useTerminalStore((s) => s.failureStage);
  const terminalCwd = useTerminalStore((s) => s.cwd);

  const capabilities = useMemo<ConnectionCapabilities>(() => {
    const next: ConnectionCapabilities = { ...DEFAULT_CAPABILITIES };

    // ── Project identity + workspace (from canonical runtime state) ──
    if (runtimeState.projectId) {
      next.projectId = runtimeState.projectId;
      next.projectName = runtimeState.projectName;
      next.repository = runtimeState.repository ? "connected" : "none";
      next.repositoryName = runtimeState.repository;
      next.repositoryIndexed = Boolean(runtimeState.repository);
      next.activeBranch = runtimeState.branch;
      next.defaultBranch = runtimeState.branch;
      next.sourceType = runtimeState.sourceType;
      next.workspaceStatus = runtimeState.workspaceStatus;
      next.writeAccess = runtimeState.writeAccess;
    }

    // ── Service health (from canonical service health state) ──
    next.githubInstalled = healthState.github.installed;
    next.connectedProviders = healthState.connectedCapabilities;
    next.availableTools = healthState.connectedCapabilities;
    next.connectionSummary = healthState.summary;
    next.voiceTransportConnected = healthState.voiceTransportConnected;
    next.voiceMicrophoneOn = healthState.voiceMicrophoneOn;
    next.voiceHealth = {
      configured: healthState.voice.configured,
      tokenService: healthState.voice.tokenService,
      available: healthState.voice.available,
      errorCode: healthState.voice.errorCode,
      message: healthState.voice.message,
      checkedAt: healthState.voice.checkedAt,
    };

    // ── Terminal PTY state (from client-side terminal store) ──
    // Terminal is only "available" when the store says connected AND
    // a verified cwd exists (set by session:ready, not by socket connect).
    next.terminalServerReachable = healthState.terminal.serverReachable;

    if (terminalStatus === "connected" && terminalCwd) {
      next.terminalStatus = "connected";
      next.terminalSessionId = terminalSessionId;
      next.terminalExecution = "available";
      next.terminalCwd = terminalCwd;
      next.terminalFailureStage = null;
      next.terminalServerReachable = true;
    } else if (terminalStatus === "connected" && !terminalCwd) {
      // Store says connected but no cwd — PTY not truly ready yet
      next.terminalStatus = "connecting";
      next.terminalExecution = "connecting";
      next.terminalFailureStage = "pty_creation_failed";
      next.terminalServerReachable = true;
    } else if (terminalStatus === "connecting") {
      next.terminalStatus = "connecting";
      next.terminalExecution = "connecting";
      next.terminalFailureStage = terminalFailureStage;
      next.terminalServerReachable = true;
    } else if (
      terminalStatus === "error" ||
      terminalStatus === "auth_failed" ||
      terminalStatus === "pty_failed" ||
      terminalStatus === "unavailable"
    ) {
      next.terminalStatus = terminalStatus;
      next.terminalError = terminalError;
      next.terminalExecution = "error";
      next.terminalFailureStage = terminalFailureStage;
    } else {
      // Client says disconnected — use server reachability from health probe
      next.terminalStatus = "disconnected";
      next.terminalSessionId = null;
      next.terminalExecution = healthState.terminal.serverReachable ? "idle" : "unavailable";
      next.terminalError = healthState.terminal.serverError;
    }

    // Allow writes when the terminal is connected (local dev) even if
    // the server-side workspace hasn't been provisioned. The terminal
    // PTY can execute file writes, so it's a valid write surface.
    // NOTE: writeAccess here means "a write surface exists", NOT "writes
    // don't need approval". Approval is a separate policy, always required.
    if (next.terminalExecution === "available" && !next.writeAccess) {
      next.writeAccess = true;
    }

    return next;
  }, [
    runtimeState.projectId,
    runtimeState.projectName,
    runtimeState.repository,
    runtimeState.branch,
    runtimeState.sourceType,
    runtimeState.workspaceStatus,
    runtimeState.writeAccess,
    healthState.github.installed,
    healthState.connectedCapabilities,
    healthState.summary,
    healthState.voiceTransportConnected,
    healthState.voiceMicrophoneOn,
    healthState.voice.configured,
    healthState.voice.tokenService,
    healthState.voice.available,
    healthState.voice.errorCode,
    healthState.voice.message,
    healthState.voice.checkedAt,
    healthState.terminal.serverReachable,
    healthState.terminal.serverError,
    terminalStatus,
    terminalSessionId,
    terminalError,
    terminalFailureStage,
    terminalCwd,
  ]);

  const loading = projectLoading || healthLoading;

  const refresh = useMemo(
    () => async () => {
      await Promise.all([refreshProject(), refreshHealth()]);
    },
    [refreshProject, refreshHealth],
  );

  return { capabilities, refresh, loading };
}
