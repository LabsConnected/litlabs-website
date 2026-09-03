/**
 * Local model lane — is there a model on THIS machine that can serve a
 * request right now?
 *
 * The capability gate must never guess at this. "Ollama is probably
 * running" is exactly the kind of assumption that produces a cockpit
 * claiming a local lane it cannot use, or — the failure this module was
 * written for — demanding `litt login` from a user whose local model was
 * sitting there ready the whole time.
 *
 * So availability is a fact obtained by asking: GET /api/tags against the
 * configured Ollama endpoint, with a short timeout, and only "the daemon
 * answered AND listed at least one model" counts as available.
 *
 * The probe is cached briefly. A cockpit asks this on every submit, and a
 * per-keystroke HTTP request to localhost is waste; a few seconds of
 * staleness is not, because a model daemon appearing or disappearing
 * mid-second is not a case worth optimising for.
 */

import {
  resolveOllamaEndpoint,
  ollamaEndpointSource,
} from "@litt/models";

/** How long a probe result stays fresh. */
const PROBE_CACHE_MS = 10_000;

/** How long to wait for the local daemon before declaring it absent. */
const PROBE_TIMEOUT_MS = 1_500;

export interface LocalLaneStatus {
  /** True only when the daemon answered AND has at least one model. */
  available: boolean;
  /** Model tags the daemon reported, e.g. ["qwen3:4b", "litt-coder:3b"]. */
  models: string[];
  /** The endpoint that was probed. */
  endpoint: string;
  /**
   * Why the lane is unavailable. null when it IS available.
   * Never contains credentials — the local lane has none.
   */
  reason: string | null;
}

export interface ProbeLocalLaneOptions {
  /** Override the endpoint (defaults to LITT_OLLAMA_URL or localhost). */
  endpoint?: string;
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Skip the cache and probe again. */
  force?: boolean;
  /** Timeout in ms. */
  timeoutMs?: number;
}

interface CacheEntry {
  at: number;
  status: LocalLaneStatus;
}

let cache: CacheEntry | null = null;

/**
 * The Ollama base URL, honouring LITT_OLLAMA_URL / OLLAMA_BASE_URL /
 * OLLAMA_HOST via the shared canonical resolver in @litt/models.
 *
 * Re-exported for callers that need the resolved endpoint without probing.
 */
export function resolveLocalLaneEndpoint(): string {
  return resolveOllamaEndpoint((key) => process.env[key]);
}

/**
 * Diagnostic: which env var was honoured for the current endpoint?
 * Returns "LITT_OLLAMA_URL", "OLLAMA_BASE_URL", "OLLAMA_HOST", "override",
 * or "default".
 */
export function localLaneEndpointSource(): string {
  return ollamaEndpointSource((key) => process.env[key]);
}

const UNAVAILABLE = (endpoint: string, reason: string): LocalLaneStatus => ({
  available: false,
  models: [],
  endpoint,
  reason,
});

/**
 * Probe the local model lane.
 *
 * Never throws: an unreachable daemon is a normal, expected answer, not
 * an error condition. Callers get `available: false` and a reason.
 */
export async function probeLocalLane(
  options: ProbeLocalLaneOptions = {},
): Promise<LocalLaneStatus> {
  const endpoint = options.endpoint ?? resolveLocalLaneEndpoint();

  if (!options.force && cache && Date.now() - cache.at < PROBE_CACHE_MS && cache.status.endpoint === endpoint) {
    return cache.status;
  }

  const doFetch = options.fetchImpl ?? fetch;
  let status: LocalLaneStatus;

  try {
    const response = await doFetch(`${endpoint}/api/tags`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      status = UNAVAILABLE(endpoint, `local model daemon returned HTTP ${response.status}`);
    } else {
      const body = (await response.json()) as unknown;
      const models = parseModelTags(body);
      status = models.length > 0
        ? { available: true, models, endpoint, reason: null }
        : UNAVAILABLE(endpoint, "local model daemon is running but has no models installed");
    }
  } catch (error) {
    status = UNAVAILABLE(
      endpoint,
      `local model daemon not reachable at ${endpoint} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  cache = { at: Date.now(), status };
  return status;
}

/** Extract model tags from an Ollama /api/tags body. */
function parseModelTags(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];

  const tags: string[] = [];
  for (const entry of models) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const tag = record.model ?? record.name;
    if (typeof tag === "string" && tag) tags.push(tag);
  }
  return tags;
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
 * Preference order for the local lane. litt-coder first: it is the build
 * tuned for this tool, so when the operator has installed it they meant
 * for LiTT to use it.
 */
const LOCAL_MODEL_PREFERENCE = [
  "litt-coder:3b",
  "qwen2.5-coder:3b",
  "qwen3:4b",
  "qwen3:4b-instruct",
];

/** Drop the cached probe result (tests, and after an explicit /local). */
export function resetLocalLaneCache(): void {
  cache = null;
}
