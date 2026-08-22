"use client";

/**
 * useServiceHealth — the canonical ServiceHealth subtree of StudioRuntimeState.
 *
 * This hook is INDEPENDENT from project runtime. It reports the health of
 * platform services (AI providers, voice, GitHub installation, platform
 * connectivity) without merging them into project readiness.
 *
 * Key design rules:
 * - Service health does NOT determine project readiness.
 *   A project can be "ready" (workspace + terminal) even if voice is down.
 * - LLM provider health is synced to useStudioModelStore so the model picker
 *   and empty-state briefing show accurate "AI ready" status.
 * - Voice health comes from /api/voice/health (server-side Inworld check).
 * - GitHub installation is separate from repository connection (a user can
 *   have the GitHub app installed without a repo selected).
 *
 * Consumed by: StudioRuntimeProvider (composed with ProjectRuntime + ActiveRun)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useVoiceSession } from "../context/VoiceSessionContext";
import { useStudioModelStore } from "../stores/useStudioModelStore";

// ─── Types ───────────────────────────────────────────────────────

export type ProviderAvailability = "available" | "unavailable" | "unknown";

export interface LlmProviderHealth {
  gemini: ProviderAvailability;
  groq: ProviderAvailability;
  openrouter: ProviderAvailability;
  /** "Auto" routes to whichever provider is available (prefer Gemini) */
  auto: ProviderAvailability;
  /** True when at least one provider is available */
  anyAvailable: boolean;
}

export interface VoiceServiceHealth {
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

export interface GitHubServiceHealth {
  /** GitHub App is installed (separate from repo connection) */
  installed: boolean;
}

export interface TerminalServiceHealth {
  /** True when the terminal server /health endpoint responded OK (server is alive) */
  serverReachable: boolean;
  /** Error from the terminal server probe, if any */
  serverError: string | null;
}

export interface ServiceHealthState {
  llm: LlmProviderHealth;
  voice: VoiceServiceHealth;
  github: GitHubServiceHealth;
  /** Terminal server reachability (server-side health probe) */
  terminal: TerminalServiceHealth;
  /** Client-side voice transport state (WebSocket connected for TTS) */
  voiceTransportConnected: boolean;
  /** Client-side microphone capturing state */
  voiceMicrophoneOn: boolean;
  /** Capabilities that are ready or running (from /api/capabilities) */
  connectedCapabilities: string[];
  /** Human-readable summary of service connections */
  summary: string;
  /** Timestamp of last health check */
  lastCheckedAt: string;
}

const INITIAL_STATE: ServiceHealthState = {
  llm: {
    gemini: "unknown",
    groq: "unknown",
    openrouter: "unknown",
    auto: "unknown",
    anyAvailable: false,
  },
  voice: {
    configured: false,
    tokenService: "unknown",
    available: false,
  },
  github: {
    installed: false,
  },
  terminal: {
    serverReachable: false,
    serverError: null,
  },
  voiceTransportConnected: false,
  voiceMicrophoneOn: false,
  connectedCapabilities: [],
  summary: "No services connected.",
  lastCheckedAt: new Date(0).toISOString(),
};

const POLL_INTERVAL_MS = 15_000;

// ─── Hook ────────────────────────────────────────────────────────

export interface UseServiceHealthResult {
  state: ServiceHealthState;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useServiceHealth(): UseServiceHealthResult {
  const [state, setState] = useState<ServiceHealthState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { getToken, isLoaded: authLoaded } = useClerkAuth();
  const searchParams = useSearchParams();
  const explicitProjectId = searchParams.get("project");

  // Client-side voice transport state (not server health)
  const { voiceTransportConnected, voiceInputState } = useVoiceSession();

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!authLoaded) return;

    try {
      const token = await getToken?.();
      const authHeaders: Record<string, string> = token
        ? { Authorization: `Bearer ${token}` }
        : {};

      const [capsRes, termRes, voiceRes, llmRes] = await Promise.allSettled([
        fetch(
          `/api/capabilities${explicitProjectId ? `?projectId=${encodeURIComponent(explicitProjectId)}` : ""}`,
          { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) },
        ),
        fetch("/api/capabilities/project-terminal", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
        fetch("/api/voice/health", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
        fetch("/api/llm/health", { cache: "no-store", credentials: "include", headers: authHeaders, signal: AbortSignal.timeout(8000) }),
      ]);

      if (!mountedRef.current) return;

      const next: ServiceHealthState = {
        ...INITIAL_STATE,
        voiceTransportConnected,
        voiceMicrophoneOn: voiceInputState === "listening",
      };

      // ── Capabilities (GitHub installation, connected services) ──
      if (capsRes.status === "fulfilled" && capsRes.value.ok) {
        const data = await capsRes.value.json();
        const caps = data.capabilities ?? [];
        const githubCap = caps.find((c: { id: string }) => c.id === "repository");
        next.github.installed = githubCap?.status === "ready" || githubCap?.status === "unavailable";
        next.connectedCapabilities = caps
          .filter((c: { status: string }) => c.status === "ready" || c.status === "running")
          .map((c: { id: string }) => c.id);
        next.summary =
          next.connectedCapabilities.length > 0
            ? `Connected: ${next.connectedCapabilities.join(", ")}`
            : "No services connected.";
      }

      // ── Terminal server reachability (server-side health probe) ──
      if (termRes.status === "fulfilled" && termRes.value.ok) {
        const termData = await termRes.value.json();
        next.terminal = {
          serverReachable: !!termData.serverReachable,
          serverError: termData.error ?? null,
        };
      } else {
        next.terminal = {
          serverReachable: false,
          serverError: "Terminal server unreachable",
        };
      }

      // ── Voice health (server-side Inworld check) ──
      if (voiceRes.status === "fulfilled" && voiceRes.value.ok) {
        const voiceData = await voiceRes.value.json();
        next.voice = {
          configured: !!voiceData.configured,
          tokenService: voiceData.tokenService === "healthy" ? "healthy" : "error",
          available: !!voiceData.available,
          errorCode: voiceData.errorCode,
          message: voiceData.message,
          checkedAt: voiceData.checkedAt,
        };
      } else {
        next.voice = {
          configured: false,
          tokenService: "unknown",
          available: false,
          errorCode: "VOICE_HEALTH_UNREACHABLE",
          message: "Voice health check failed.",
        };
      }

      // ── LLM provider health ──
      const setProviderHealth = useStudioModelStore.getState().setProviderHealth;
      if (llmRes.status === "fulfilled" && llmRes.value.ok) {
        const llmData = await llmRes.value.json();
        const geminiOk = !!llmData.gemini?.available;
        const groqOk = !!llmData.groq?.available;
        const openrouterOk = !!llmData.openrouter?.available;

        next.llm = {
          gemini: geminiOk ? "available" : "unavailable",
          groq: groqOk ? "available" : "unavailable",
          openrouter: openrouterOk ? "available" : "unavailable",
          auto: geminiOk || groqOk || openrouterOk ? "available" : "unavailable",
          anyAvailable: geminiOk || groqOk || openrouterOk,
        };

        setProviderHealth("gemini", geminiOk ? "available" : "unavailable");
        setProviderHealth("groq", groqOk ? "available" : "unavailable");
        setProviderHealth("openrouter", openrouterOk ? "available" : "unavailable");
        setProviderHealth("Auto", geminiOk || groqOk || openrouterOk ? "available" : "unavailable");
      } else {
        next.llm = {
          gemini: "unavailable",
          groq: "unavailable",
          openrouter: "unavailable",
          auto: "unavailable",
          anyAvailable: false,
        };
        // Health endpoint failed — mark all as unavailable so the UI
        // shows a truthful "setup required" rather than a stale unknown.
        setProviderHealth("gemini", "unavailable");
        setProviderHealth("groq", "unavailable");
        setProviderHealth("openrouter", "unavailable");
        setProviderHealth("Auto", "unavailable");
      }

      next.lastCheckedAt = new Date().toISOString();
      setState(next);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to check service health");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [authLoaded, getToken, explicitProjectId, voiceTransportConnected, voiceInputState]);

  // Initial resolve + polling
  useEffect(() => {
    mountedRef.current = true;
    void refresh();

    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
  }, [refresh]);

  // Update client-side voice transport state without re-fetching
  useEffect(() => {
    setState((prev) => ({
      ...prev,
      voiceTransportConnected,
      voiceMicrophoneOn: voiceInputState === "listening",
    }));
  }, [voiceTransportConnected, voiceInputState]);

  return { state, loading, error, refresh };
}
