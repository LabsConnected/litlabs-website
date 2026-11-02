// API Route: LLM provider health + chain config — useful for the admin UI
// and for agents that want to know which provider to prefer.
//
// Truthfulness contract (Oct 2026): `providers.*` reports what the routers
// actually believe — credential PRESENCE (never values), circuit-breaker
// state, and the last failure class. A key that exists but was rejected
// (e.g. OpenRouter 401 "User not found" → auth_invalid → disabled) reports
// available:false — never "healthy on presence alone", which is what this
// endpoint used to claim. `summary` is the SERVICE-level roll-up ("ok"
// when at least one usable route exists, cloud OR local); `providers` and
// `local` carry per-route truth independently of that roll-up.
//
// Security: Returns a minimal public payload ({ status }) to
// unauthenticated callers. Full provider/model details are only exposed
// to authenticated users (via Clerk session or Bearer token).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { llmHealth, DEFAULT_MODELS } from "@/lib/llm";
import {
  providerDiagnostics,
  resolveBasicOllamaEndpoint,
} from "@/lib/litt-intelligence/provider-registry";
import {
  OLLAMA_TOOL_CAPABLE,
  preferredLocalToolModel,
  ollamaRouteEligible,
} from "@/lib/litt-intelligence/ollama-shared";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

// ─── Local Ollama probe ───────────────────────────────────────────
// Short cache so the model picker / health UI can poll without hammering
// /api/tags. Reachability is probed live — "the router would try ollama"
// and "Ollama is actually up" are different facts and are both reported.

interface LocalModelInfo {
  name: string;
  sizeMb: number;
  /** Server-reported capabilities from /api/tags (e.g. ["tools","completion"]). */
  capabilities: string[];
  /** Router-side tool-calling eligibility (shared rule with both lanes). */
  toolCapable: boolean;
  /** What the routers auto-pick for tool runs right now. */
  recommended: boolean;
}

interface LocalProbe {
  /** Routing eligibility (env/deployed gate) — NOT reachability. */
  eligible: boolean;
  reachable: boolean;
  endpoint: string;
  models: LocalModelInfo[];
  defaultPick: string | null;
  /** True when this answers from the last successful probe — a live probe
   *  failed but Ollama was confirmed reachable recently (e.g. it is busy
   *  saturating the CPU with inference, which stalls even /api/tags past
   *  any reasonable timeout on this class of host). */
  stale?: boolean;
  error?: string;
}

let localProbeCache: { at: number; result: LocalProbe } | null = null;
const LOCAL_PROBE_TTL_MS = 15_000;

async function probeLocalOllama(): Promise<LocalProbe> {
  const eligible = ollamaRouteEligible();
  if (localProbeCache && Date.now() - localProbeCache.at < LOCAL_PROBE_TTL_MS) {
    return { ...localProbeCache.result, eligible };
  }
  const endpoint = resolveBasicOllamaEndpoint();
  const result: LocalProbe = {
    eligible,
    reachable: false,
    endpoint,
    models: [],
    defaultPick: null,
  };
  try {
    const res = await fetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      result.error = `Ollama /api/tags ${res.status}`;
    } else {
      const data = (await res.json()) as {
        models?: Array<{ name?: string; size?: number; capabilities?: string[] }>;
      };
      const names = (data.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => !!n);
      const pick = preferredLocalToolModel(names) ?? null;
      result.reachable = true;
      result.defaultPick = pick;
      result.models = (data.models ?? [])
        .filter((m): m is { name: string; size?: number; capabilities?: string[] } => !!m.name)
        .map((m) => ({
          name: m.name,
          sizeMb: Math.round((m.size ?? 0) / (1024 * 1024)),
          capabilities: m.capabilities ?? [],
          toolCapable: OLLAMA_TOOL_CAPABLE.test(m.name),
          recommended: m.name === pick,
        }));
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : "probe failed";
  }
  if (result.reachable) {
    localProbeCache = { at: Date.now(), result };
    return result;
  }
  // Probe failed — serve the last confirmed-reachable snapshot as stale
  // rather than flapping the picker to "no local models" every time Ollama
  // is busy inferring. Truthful either way: `stale` is explicit.
  if (localProbeCache?.result.reachable) {
    return {
      ...localProbeCache.result,
      eligible,
      stale: true,
      error: result.error,
    };
  }
  // Never confirmed reachable on this process — report honestly.
  localProbeCache = { at: Date.now(), result };
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth(req);
    const diag = providerDiagnostics();
    const local = await probeLocalOllama();

    // Truthful per-provider availability: credential presence alone is not
    // availability — a present-but-dead key that already failed auth shows
    // up as state:"disabled" + reason:"auth_invalid" + available:false.
    const providers: Record<
      string,
      {
        credential: string;
        state: string;
        reason?: string;
        cooldownUntil?: number;
        consecutiveFailures: number;
        costClass: string;
        available: boolean;
      }
    > = {};
    for (const [name, d] of Object.entries(diag)) {
      providers[name] = {
        credential: d.credential,
        state: d.state,
        reason: d.reason,
        cooldownUntil: d.cooldownUntil,
        consecutiveFailures: d.consecutiveFailures,
        costClass: d.costClass,
        available:
          (d.credential === "available" || d.credential === "not_required") &&
          d.state !== "disabled" &&
          d.state !== "cooldown",
      };
    }
    // The local route needs no credential — availability is eligibility +
    // reachability + the router's own breaker state.
    if (providers.ollama) {
      providers.ollama.available =
        local.eligible &&
        local.reachable &&
        providers.ollama.state !== "disabled" &&
        providers.ollama.state !== "cooldown";
    }

    const usableProviders = Object.entries(providers)
      .filter(([, p]) => p.available)
      .map(([name]) => name);
    const anyUsable = usableProviders.length > 0;

    // Unauthenticated: minimal public payload only — but still truthful
    // (computed from real availability, not key presence).
    if (!userId) {
      return NextResponse.json({ status: anyUsable ? "ok" : "degraded" });
    }

    // Authenticated: full details for admin UI and agents
    const health = llmHealth();
    // Catalog of free models the picker can advertise (catalog ≠ live
    // availability — per-route truth is in `providers`/`local`).
    const freeModels = [
      { id: "openrouter-qwen", name: "Qwen 2.5 Coder", provider: "OpenRouter", task: "code" },
      { id: "openrouter-deepseek", name: "DeepSeek Chat", provider: "OpenRouter", task: "chat" },
      { id: "openrouter-mistral", name: "Mistral Small 3.2", provider: "OpenRouter", task: "general" },
      { id: "openrouter-llama", name: "Llama 3.3 70B", provider: "OpenRouter", task: "general" },
      { id: "openrouter-trinity", name: "Trinity Large", provider: "OpenRouter", task: "general" },
    ];
    const geminiAvail = providers.gemini?.available ?? false;
    const openrouterAvail = providers.openrouter?.available ?? false;
    return NextResponse.json({
      // SERVICE-level roll-up: ok = at least one usable route exists.
      status: anyUsable ? "ok" : "degraded",
      summary: {
        service: "ok",
        anyUsableRoute: anyUsable,
        usableProviders,
        localReachable: local.reachable,
      },
      providers,
      local: {
        eligible: local.eligible,
        reachable: local.reachable,
        ...(local.stale ? { stale: true } : {}),
        endpoint: local.endpoint,
        defaultPick: local.defaultPick,
        models: local.models,
        ...(local.error ? { error: local.error } : {}),
      },
      // Legacy fields kept for existing consumers — now fed truthful
      // availability (breaker-aware), not mere key presence.
      gemini: { ...health.gemini, available: geminiAvail },
      groq: { ...health.groq, available: providers.groq?.available ?? false },
      openai: { ...health.openai, available: providers.openai?.available ?? false },
      openrouter: { ...health.openrouter, available: openrouterAvail },
      preferFree: health.preferFree,
      primary: health.primary,
      models: DEFAULT_MODELS,
      freeModels,
      hasGemini: geminiAvail,
      hasOpenRouter: openrouterAvail,
      // Basic router circuit-breaker state — presence/state only, no secrets.
      basicRoutes: diag,
    });
  } catch (_error) {
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}
