/**
 * Local model lane — is there a model on THIS machine (or the PC it can
 * reach) that can serve a request right now?
 *
 * The capability gate must never guess at this. "Ollama is probably
 * running" is exactly the kind of assumption that produces a cockpit
 * claiming a local lane it cannot use, or — the failure this module was
 * written for — demanding `litt login` from a user whose local model was
 * sitting there ready the whole time.
 *
 * So availability is a fact obtained by asking: GET /api/tags against the
 * Ollama endpoint, with a short timeout, and only "the daemon answered AND
 * listed at least one model" counts as available. Since "the Ollama
 * endpoint" is no longer a single fixed address — the PC may be reachable
 * on localhost, the home LAN, or only via Tailscale depending on where
 * this device is — the probe tries candidates in that priority order via
 * @litt/models' probeOllamaRoute() and reports which one actually
 * answered (LOCAL OLLAMA / LAN OLLAMA / TAILSCALE OLLAMA).
 *
 * The probe is cached briefly. A cockpit asks this on every submit, and a
 * per-keystroke HTTP request is waste; a few seconds of staleness is not,
 * because a model daemon appearing or disappearing mid-second, or the
 * phone hopping networks mid-second, is not a case worth optimising for.
 */

import {
  resolveOllamaEndpoint,
  ollamaEndpointSource,
  probeOllamaRoute,
  OLLAMA_ROUTE_LABELS,
  type OllamaRouteTier,
  type OllamaRouteCandidate,
} from "@litt/models";

/** How long a probe result stays fresh. */
const PROBE_CACHE_MS = 10_000;

/** Per-candidate timeout — the probe may try up to three hosts. */
/** Override the Ollama probe timeout via LITT_OLLAMA_TIMEOUT env var (ms). Default 1_500 when unset. */
const PROBE_TIMEOUT_MS = Number(process.env.LITT_OLLAMA_TIMEOUT ?? "") || 1_500;

export interface LocalLaneStatus {
  /** True only when the daemon answered AND has at least one model. */
  available: boolean;
  /** Model tags the daemon reported, e.g. ["qwen3:4b", "litt-coder:3b"]. */
  models: string[];
  /** The endpoint that answered (or the highest-priority one tried, if none did). */
  endpoint: string;
  /**
   * Why the lane is unavailable. null when it IS available.
   * Never contains credentials — the local lane has none.
   */
  reason: string | null;
  /**
   * Which network tier answered: "local" | "lan" | "tailscale", or null
   * when unavailable. Optional so existing literals built without it
   * (tests, fixtures) keep type-checking.
   */
  route?: OllamaRouteTier | null;
  /** Display label for the active route: "LOCAL OLLAMA" / "LAN OLLAMA" / "TAILSCALE OLLAMA". */
  routeLabel?: string;
}

export interface ProbeLocalLaneOptions {
  /**
   * Force a single specific endpoint, skipping local/LAN/Tailscale
   * candidate resolution entirely. Used by tests and any caller that
   * already knows exactly where to look.
   */
  endpoint?: string;
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Skip the cache and probe again. */
  force?: boolean;
  /** Per-candidate timeout in ms. */
  timeoutMs?: number;
}

interface CacheEntry {
  at: number;
  status: LocalLaneStatus;
}

let cache: CacheEntry | null = null;

/**
 * The Ollama endpoint to use for an actual request.
 *
 * Returns the endpoint the most recent successful probeLocalLane() found
 * reachable — LOCAL, LAN, or Tailscale, whichever answered — so a request
 * always lands on the same host the availability check just proved is
 * alive. Before any probe has run, falls back to the static single-shot
 * resolver (LITT_OLLAMA_URL / OLLAMA_HOST_PC / OLLAMA_HOST /
 * OLLAMA_BASE_URL / localhost) from @litt/models.
 */
export function resolveLocalLaneEndpoint(): string {
  if (cache?.status.available) return cache.status.endpoint;
  return resolveOllamaEndpoint((key) => process.env[key]);
}

/**
 * Diagnostic: which env var was honoured for the current STATIC endpoint
 * (ignores any live probe result)?
 * Returns "LITT_OLLAMA_URL", "OLLAMA_HOST_PC", "OLLAMA_HOST",
 * "OLLAMA_BASE_URL", "override", or "default".
 */
export function localLaneEndpointSource(): string {
  return ollamaEndpointSource((key) => process.env[key]);
}

/**
 * Probe the local model lane.
 *
 * With no explicit `options.endpoint`, tries candidates in priority
 * order — this machine's own Ollama, the home LAN, then Tailscale — via
 * @litt/models' probeOllamaRoute(), and reports which one answered.
 *
 * Never throws: an unreachable daemon is a normal, expected answer, not
 * an error condition. Callers get `available: false` and an actionable
 * reason (which routes were tried and why each failed).
 */
export async function probeLocalLane(
  options: ProbeLocalLaneOptions = {},
): Promise<LocalLaneStatus> {
  const forcedEndpoint = options.endpoint;

  if (
    !options.force &&
    cache &&
    Date.now() - cache.at < PROBE_CACHE_MS &&
    (forcedEndpoint === undefined || cache.status.endpoint === forcedEndpoint)
  ) {
    return cache.status;
  }

  const candidates: OllamaRouteCandidate[] | undefined = forcedEndpoint
    ? [{ tier: "local", label: OLLAMA_ROUTE_LABELS.local, endpoint: forcedEndpoint }]
    : undefined;

  const result = await probeOllamaRoute({
    candidates,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs ?? PROBE_TIMEOUT_MS,
  });

  const status: LocalLaneStatus = result.ok
    ? {
        available: true,
        models: result.models,
        endpoint: result.endpoint as string,
        reason: null,
        route: result.tier,
        routeLabel: result.label,
      }
    : {
        available: false,
        models: [],
        endpoint: forcedEndpoint ?? result.attempts[0]?.endpoint ?? "http://localhost:11434",
        reason: singleCandidateReason(result.attempts) ?? result.reason,
        route: null,
        routeLabel: "",
      };

  cache = { at: Date.now(), status };
  return status;
}

/**
 * When exactly one endpoint was tried — no LAN/Tailscale tier configured,
 * the common case for a plain local install — report the failure in the
 * original single-endpoint wording ("local model daemon not reachable at
 * ...") instead of the multi-route diagnostic. Existing callers and error
 * strings depend on this exact phrasing. Once more than one route is
 * configured, the richer multi-route reason from probeOllamaRoute (which
 * names every tier tried) takes over.
 */
function singleCandidateReason(attempts: { endpoint: string; error: string | null }[]): string | null {
  if (attempts.length !== 1) return null;
  const [attempt] = attempts;
  if (!attempt.error) return null;
  if (attempt.error.startsWith("HTTP ")) {
    return `local model daemon returned ${attempt.error}`;
  }
  if (attempt.error === "reachable but no models installed") {
    return "local model daemon is running but has no models installed";
  }
  return `local model daemon not reachable at ${attempt.endpoint} (${attempt.error})`;
}

/**
 * Pick the model to serve a local request, preferring LiTT's own coder
 * build, then a general local worker, then whatever is installed.
 *
 * Returns null when nothing is installed.
 */
export function selectLocalModel(models: string[], preferred?: string): string | null {
  if (preferred && models.includes(preferred)) return preferred;
  for (const candidate of LOCAL_MODEL_PREFERENCE) {
    const hit = models.find((m) => m === candidate || m.startsWith(`${candidate}:`));
    if (hit) return hit;
  }
  return models[0] ?? null;
}

/**
 * Preference order for the local lane. LiTT's own tuned builds first —
 * when the operator has installed them they meant for LiTT to use them —
 * then known-good general local models.
 */
const LOCAL_MODEL_PREFERENCE = [
  // LiTT's own tuned Qwen builds — what the Windows install ships.
  // litt-fast is the general/interactive pick; litt-tools is tool-tuned.
  "litt-fast",
  "litt-tools",
  "litt-coder:8k",
  "litt-coder:fast",
  "litt-coder:3b",
  "qwen2.5-coder:1.5b",
  "qwen2.5-coder:3b",
  "qwen3:4b",
  "qwen3:4b-instruct",
  "litt-hermes",
  "litt-oc-phone:1.7b-8k",
];

/**
 * Keep-alive window for the warmed local model. Ollama evicts a resident
 * model ~5m after its last request; a CLI session that chats every few
 * minutes then pays the full ~30s cold load again on a 3 GB card.
 * 30m keeps the model warm across realistic interactive gaps without
 * pinning VRAM forever.
 */
const WARM_KEEP_ALIVE = "30m";

/**
 * Load (or refresh residency of) a local model in the background.
 *
 * Fires a zero-output `/api/generate` request with `keep_alive` — Ollama
 * loads the model into VRAM/system RAM without producing tokens, so the
 * first real user request pays ~70ms first-token instead of the ~30s
 * cold load measured on this machine (GTX 1050, litt-fast:2k).
 *
 * Fire-and-forget contract: never throws, never blocks, never surfaces
 * an error — a failed warmup simply means the next real request pays
 * the normal load cost. Callers should `void` the promise.
 */
export async function warmLocalModel(
  endpoint: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${endpoint}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "", stream: false, keep_alive: WARM_KEEP_ALIVE }),
    });
  } catch {
    /* warmup is opportunistic — ignore */
  }
}

/** Drop the cached probe result (tests, and after an explicit /local). */
export function resetLocalLaneCache(): void {
  cache = null;
}
