import { NextResponse } from "next/server";

/**
 * Capability snapshot — single source of truth for system health.
 *
 * This type is shared between the dashboard UI and the LiTT system prompt so
 * the two cannot contradict each other. The snapshot is built from two halves:
 *
 *   1. Server-derived infrastructure state (this route): AI provider,
 *      project, workspace, terminal, autonomic loop.
 *   2. Client-derived session state (VoiceSessionContext): voice transport
 *      and microphone. The server CANNOT reliably know whether the local
 *      browser's microphone stream is active — that must come from the
 *      client. The final UI snapshot merges the two.
 *
 * Truthful default: when a probe fails or is not yet wired, return
 * `"unknown"` with a `reason`, never invent a positive status.
 */
export type CapabilitySnapshot = {
  generatedAt: string;

  ai: {
    status: "ready" | "degraded" | "unavailable" | "unknown";
    reason?: string;
  };

  voice: {
    status: "ready" | "inactive" | "connecting" | "error" | "unknown";
    microphone: "on" | "off" | "denied" | "unavailable";
    reason?: string;
  };

  project: {
    status: "ready" | "not_configured" | "error" | "unknown";
    projectId?: string;
  };

  workspace: {
    status: "ready" | "preparing" | "stopped" | "error" | "unknown";
    workspaceId?: string;
  };

  terminal: {
    status: "connected" | "disconnected" | "error" | "unknown";
    lastVerifiedAt?: string;
  };

  autonomicLoop: {
    status: "healthy" | "degraded" | "offline" | "unknown";
    reason?: string;
  };
};

/**
 * Probe the LLM provider by calling our own /api/llm/health endpoint.
 * If that endpoint is not configured, the probe fails and we report
 * "unknown" — we do NOT invent "ready" or "degraded".
 */
async function probeAi(): Promise<CapabilitySnapshot["ai"]> {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/llm/health`, {
      method: "GET",
      cache: "no-store",
      // Server-to-server fetch; the liveness check is intentionally cheap.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      return { status: "unavailable", reason: `llm/health ${res.status}` };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const gemini = (json.gemini as { available?: boolean } | undefined)?.available;
    const openrouter = (json.openrouter as { available?: boolean } | undefined)?.available;
    if (gemini === true || openrouter === true) {
      return { status: "ready" };
    }
    return { status: "degraded", reason: "no provider reported available" };
  } catch (err) {
    return {
      status: "unknown",
      reason: err instanceof Error ? err.message : "probe failed",
    };
  }
}

/**
 * Probe the autonomic loop by calling the GET handlers on
 * /api/director/plan and /api/agent-tasks. Both are public reads.
 */
async function probeAutonomicLoop(): Promise<CapabilitySnapshot["autonomicLoop"]> {
  try {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const [plan, tasks] = await Promise.all([
      fetch(`${base}/api/director/plan`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(2000) }),
      fetch(`${base}/api/agent-tasks`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(2000) }),
    ]);
    if (plan.ok && tasks.ok) return { status: "healthy" };
    if (plan.status === 404 || tasks.status === 404) {
      return { status: "offline", reason: "endpoint not deployed" };
    }
    return {
      status: "degraded",
      reason: `director=${plan.status} tasks=${tasks.status}`,
    };
  } catch (err) {
    return {
      status: "unknown",
      reason: err instanceof Error ? err.message : "probe failed",
    };
  }
}

export async function GET(): Promise<NextResponse<CapabilitySnapshot>> {
  const [ai, autonomicLoop] = await Promise.all([probeAi(), probeAutonomicLoop()]);

  const snapshot: CapabilitySnapshot = {
    generatedAt: new Date().toISOString(),

    ai,

    // Server cannot know the browser's microphone state — that comes from
    // the client (VoiceSessionContext). The UI merges this server snapshot
    // with its live voiceInputState and voiceOutputState.
    voice: {
      status: "unknown",
      microphone: "unavailable",
      reason: "voice and microphone state are client-derived only",
    },

    // Project / workspace / terminal probes require Clerk auth and Supabase
    // project/workspace queries that are out of scope for this initial route.
    // Returning "unknown" is the truthful default until those probes land.
    project: { status: "unknown" },
    workspace: { status: "unknown" },
    terminal: { status: "unknown" },


    autonomicLoop,
  };

  return NextResponse.json(snapshot);
}
