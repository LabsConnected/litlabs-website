"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useVoiceSession } from "../context/VoiceSessionContext";
import { useStudioModelStore } from "../stores/useStudioModelStore";
import { useProjectRuntime } from "./useProjectRuntime";
import type { TerminalStatus } from "@/lib/capabilities/types";
import { deriveTerminalHealth, type TerminalHealth } from "@/lib/studio/terminal-health";

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
  sourceType: "github" | "blank" | "template" | "managed" | "upload" | null;
  /** Who owns the durable source: LiTT ("managed") or GitHub. */
  sourceKind: "managed" | "github" | null;
  /** "LiTT Managed" or "GitHub" — what the project card should show. */
  sourceLabel: string | null;
  /** Provisioning state of the source, separate from agent execution. */
  sourceStatus: "provisioning" | "ready" | "error" | "needs_setup" | null;
  /** Whether the workspace has a Git repository. Managed projects do. */
  versionControl: "git" | "none";
  /** Whether a GitHub repository is connected. Optional by design. */
  githubConnected: boolean;
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
  /**
   * Canonical terminal health — the ONLY terminal label/level any Studio
   * surface may render (header, operator bar, mission hints, health light).
   */
  terminalHealth?: TerminalHealth;
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
  sourceKind: null,
  sourceLabel: null,
  sourceStatus: null,
  versionControl: "none",
  githubConnected: false,
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
  terminalHealth: deriveTerminalHealth({ storeStatus: "disconnected", cwd: null, serverReachable: null }),
};

/**
 * Parse a /api/llm/health payload into per-provider availability.
 *
 * Returns null when the payload carries no provider fields — e.g. the
 * minimal {status} payload served to unauthenticated callers, or an error
 * payload. Null means "unknown": callers must leave previously known state
 * alone rather than marking providers "unavailable".
 */
export function parseLlmProviderHealth(
  data: unknown,
): { gemini: boolean; groq: boolean; openrouter: boolean } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    gemini?: { available?: unknown };
    groq?: { available?: unknown };
    openrouter?: { available?: unknown };
  };
  if (d.gemini === undefined && d.groq === undefined && d.openrouter === undefined) return null;
  return {
    gemini: !!d.gemini?.available,
    groq: !!d.groq?.available,
    openrouter: !!d.openrouter?.available,
  };
}

export function useConnectionSummary(options?: { disabled?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [capabilities, setCapabilities] = useState<ConnectionCapabilities>(
    DEFAULT_CAPABILITIES,
  );

  // Canonical project runtime — the ONE source of truth for project identity
  // and readiness. Return the complete result so consumers do not derive
  // readiness from project existence or issue a second runtime request.
  // Disabled propagates: a disabled summary must not spin up a second
  // runtime poller either.
  const runtime = useProjectRuntime({ disabled: options?.disabled });
  const { state: runtimeState } = runtime;

  // Client-side terminal state comes ONLY from useProjectRuntime — this
  // hook never reads useTerminalStore directly. The `terminal` object below
  // is the canonical derivation; capabilities fields are mapped, not
  // re-derived.
  const { terminal: runtimeTerminal } = runtime;
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();
  const { getToken } = useClerkAuth();
  const searchParams = useSearchParams();
  const explicitProjectId = searchParams.get("project");

  const refresh = useCallback(async () => {
    try {
      const token = await getToken?.();
      const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      const [capsRes, voiceRes, llmRes] = await Promise.allSettled([
        fetch(`/api/capabilities${explicitProjectId ? `?projectId=${encodeURIComponent(explicitProjectId)}` : ""}`, { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
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
      // Only assert what the check actually verified: a failed or
      // unparseable health check is "unknown", never "unavailable".
      // (The route returns a minimal {status} payload to unauthenticated
      // callers — that must not read as "all providers down".)
      const setProviderHealth = useStudioModelStore.getState().setProviderHealth;
      if (llmRes.status === "fulfilled" && llmRes.value.ok) {
        const providers = parseLlmProviderHealth(await llmRes.value.json());
        if (providers) {
          setProviderHealth("gemini", providers.gemini ? "available" : "unavailable");
          setProviderHealth("groq", providers.groq ? "available" : "unavailable");
          setProviderHealth("openrouter", providers.openrouter ? "available" : "unavailable");
          // "Auto" models route to whichever provider is available (prefer Gemini).
          setProviderHealth("Auto", providers.gemini || providers.groq || providers.openrouter ? "available" : "unavailable");
        }
        // else: no provider fields in the payload — leave previous state.
        // Unknown stays unknown (the UI shows an honest "checking"), and the
        // next poll retries.
      }
      // else: the health check itself failed — leave previous state. A failed
      // check is not evidence the providers are down, and must never surface
      // as a stale "AI provider unavailable" badge while the router works.

      // Terminal state — mapped from the canonical runtime truth.
      // useProjectRuntime is the ONLY reader of useTerminalStore; this hook
      // maps its derived `terminal` object into the capabilities shape.
      // No re-derivation here.
      next.terminalStatus = runtimeTerminal.status;
      next.terminalSessionId = runtimeTerminal.sessionId;
      next.terminalError = runtimeTerminal.error;
      next.terminalFailureStage = runtimeTerminal.failureStage;
      next.terminalCwd = runtimeTerminal.cwd;
      next.terminalServerReachable = runtimeTerminal.serverReachable;
      next.terminalExecution = runtimeTerminal.execution;

      // Allow writes when the terminal is connected (local dev) even if
      // the server-side workspace hasn't been provisioned. The terminal
      // PTY can execute file writes, so it's a valid write surface.
      // NOTE: writeAccess here means "a write surface exists", NOT "writes
      // don't need approval". Approval is a separate policy, always required.
      next.terminalHealth = deriveTerminalHealth({
        storeStatus: next.terminalStatus,
        cwd: next.terminalCwd,
        // Only trust reachability we actually observed: useProjectRuntime is
        // the single prober now — its serverReachable is false until the
        // first successful probe, so a stale "reachable" can never leak in.
        serverReachable: next.terminalServerReachable,
        error: next.terminalError,
      });

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
        next.sourceKind = runtimeState.sourceKind ?? next.sourceKind;
        next.sourceLabel = runtimeState.sourceLabel ?? next.sourceLabel;
        next.sourceStatus = runtimeState.sourceStatus ?? next.sourceStatus;
        next.versionControl = runtimeState.versionControl ?? next.versionControl;
        next.githubConnected = runtimeState.githubConnected ?? next.githubConnected;
        next.workspaceStatus = runtimeState.workspaceStatus ?? next.workspaceStatus;
        // writeAccess = a write surface exists (workspace OR terminal).
        // This does NOT mean approval is waived — approval is separate.
        next.writeAccess = runtimeState.writeAccess || next.writeAccess;
      }

      setCapabilities(next);
    } catch {
      // leave previous state
    } finally {
      setLoading(false);
    }
  }, [runtimeTerminal, voiceTransportConnected, voiceInputState, getToken, explicitProjectId, runtimeState.projectId, runtimeState.projectName, runtimeState.repository, runtimeState.branch, runtimeState.workspaceStatus, runtimeState.writeAccess, runtimeState.sourceType, runtimeState.sourceKind, runtimeState.sourceLabel, runtimeState.sourceStatus, runtimeState.versionControl, runtimeState.githubConnected]);

  useEffect(() => {
    // A disabled instance performs no fetches and no polling — used when the
    // caller already receives capabilities from a shared instance, so a
    // second hook doesn't double every capability/runtime poll.
    if (options?.disabled) return;
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh, options?.disabled]);

  return { capabilities, refresh, loading, runtime };
}
