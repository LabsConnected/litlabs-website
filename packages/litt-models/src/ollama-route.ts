/**
 * Multi-endpoint Ollama route resolution — "reach my PC from anywhere."
 *
 * ollama-endpoint.ts resolves to exactly ONE endpoint from env-var
 * precedence and never probes it — every existing call site relies on
 * that single-shot contract, so it is untouched.
 *
 * This module is a layer on top: it builds an ORDERED list of candidate
 * endpoints (local machine, home LAN, Tailscale) and probes them in
 * priority order with GET /api/tags, selecting the first one that
 * actually answers. This is what lets a phone on cellular data — off the
 * home Wi-Fi entirely — still reach the same Windows PC over Tailscale,
 * without the caller having to know which network it's on.
 *
 * Priority (highest → lowest):
 *   1. LITT_OLLAMA_URL       — explicit override, matches ollama-endpoint.ts.
 *      When set, it is the ONLY candidate: an explicit override must not
 *      be silently skipped in favour of a "healthier" endpoint.
 *   2. OLLAMA_LOCAL_URL      — this machine's own Ollama (default
 *      http://localhost:11434 when unset — always a candidate).
 *   3. OLLAMA_LAN_URL        — the PC's home-network address (falls back
 *      to the legacy OLLAMA_HOST_PC / OLLAMA_HOST / OLLAMA_BASE_URL
 *      names so existing configuration keeps working unchanged).
 *   4. OLLAMA_TAILSCALE_URL  — the PC's stable Tailscale hostname/IP,
 *      reachable from anywhere (cellular, another Wi-Fi, away from home).
 *
 * A tier is only a candidate when it resolves to a valid, non-duplicate
 * endpoint — an unset LAN or Tailscale var is skipped, not probed as
 * "undefined". Malformed values (via normalizeOllamaEndpoint) are
 * treated as unset, the same rule ollama-endpoint.ts already uses.
 *
 * Never reads process.env directly — the caller passes an env getter.
 */

import { DEFAULT_OLLAMA_URL, normalizeOllamaEndpoint, type EnvGetter } from "./ollama-endpoint.js";

/** Which tier of the network a candidate endpoint belongs to. */
export type OllamaRouteTier = "local" | "lan" | "tailscale";

/** The label LiTT displays for the active route. */
export const OLLAMA_ROUTE_LABELS: Record<OllamaRouteTier, string> = {
  local: "LOCAL OLLAMA",
  lan: "LAN OLLAMA",
  tailscale: "TAILSCALE OLLAMA",
};

/** Label shown when execution falls through to LiTT's remote/cloud lane. */
export const REMOTE_LITT_LABEL = "REMOTE LITT";

export interface OllamaRouteCandidate {
  tier: OllamaRouteTier;
  label: string;
  endpoint: string;
}

/** Env vars this module reads, exported for tests and diagnostics. */
export const OLLAMA_ROUTE_ENV_VARS = {
  override: "LITT_OLLAMA_URL",
  local: "OLLAMA_LOCAL_URL",
  lan: "OLLAMA_LAN_URL",
  lanLegacy: ["OLLAMA_HOST_PC", "OLLAMA_HOST", "OLLAMA_BASE_URL"],
  tailscale: "OLLAMA_TAILSCALE_URL",
} as const;

/**
 * Build the ordered list of endpoints to try.
 *
 * Pure and synchronous — no network I/O. Duplicate endpoints across
 * tiers (e.g. LAN and Tailscale vars pointed at the same host) are
 * collapsed to their first, highest-priority occurrence so a route is
 * never probed twice.
 */
export function resolveOllamaRouteCandidates(getEnv: EnvGetter): OllamaRouteCandidate[] {
  const override = normalizeOllamaEndpoint(getEnv(OLLAMA_ROUTE_ENV_VARS.override));
  if (override) {
    return [{ tier: "local", label: OLLAMA_ROUTE_LABELS.local, endpoint: override }];
  }

  const seen = new Set<string>();
  const candidates: OllamaRouteCandidate[] = [];

  const push = (tier: OllamaRouteTier, endpoint: string | null) => {
    if (!endpoint || seen.has(endpoint)) return;
    seen.add(endpoint);
    candidates.push({ tier, label: OLLAMA_ROUTE_LABELS[tier], endpoint });
  };

  const localUrl = normalizeOllamaEndpoint(getEnv(OLLAMA_ROUTE_ENV_VARS.local)) ?? DEFAULT_OLLAMA_URL;
  push("local", localUrl);

  const lanUrl =
    normalizeOllamaEndpoint(getEnv(OLLAMA_ROUTE_ENV_VARS.lan)) ??
    OLLAMA_ROUTE_ENV_VARS.lanLegacy.reduce<string | null>(
      (found, key) => found ?? normalizeOllamaEndpoint(getEnv(key)),
      null,
    );
  push("lan", lanUrl);

  push("tailscale", normalizeOllamaEndpoint(getEnv(OLLAMA_ROUTE_ENV_VARS.tailscale)));

  return candidates;
}

/** One candidate's probe outcome — kept even on failure, for diagnostics. */
export interface OllamaRouteAttempt {
  tier: OllamaRouteTier;
  label: string;
  endpoint: string;
  ok: boolean;
  error: string | null;
}

export interface OllamaRouteResult {
  ok: boolean;
  tier: OllamaRouteTier | null;
  /** "LOCAL OLLAMA" / "LAN OLLAMA" / "TAILSCALE OLLAMA", or "" when ok=false. */
  label: string;
  endpoint: string | null;
  /** Model tags reported by the winning endpoint's /api/tags. */
  models: string[];
  /** Every candidate tried, in priority order, with its outcome. */
  attempts: OllamaRouteAttempt[];
  /**
   * Actionable failure text when ok=false — never set when ok=true.
   * Names what was tried and points at the likely fix (Tailscale not
   * running, PC offline, nothing configured).
   */
  reason: string | null;
}

export interface ProbeOllamaRouteOptions {
  getEnv?: EnvGetter;
  /** Injected fetch, for tests. */
  fetchImpl?: typeof fetch;
  /** Per-candidate timeout in ms. Kept short — this may probe up to 3 hosts. */
  timeoutMs?: number;
  /** Pre-built candidate list — skips resolveOllamaRouteCandidates. For tests. */
  candidates?: OllamaRouteCandidate[];
}

const DEFAULT_ROUTE_TIMEOUT_MS = 1_200;

/** Extract model tags from an Ollama /api/tags body. */
function parseTagNames(body: unknown): string[] {
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
 * Probe candidate Ollama endpoints in priority order and return the
 * first that answers GET /api/tags with at least one model installed.
 *
 * Probes run strictly in sequence (not in parallel): the whole point of
 * the priority order is "prefer local over LAN over Tailscale", and a
 * parallel race could hand the win to a slower-but-lower-priority tier.
 * With a short per-candidate timeout the worst case (everything down)
 * is still well under a second per hop.
 *
 * Never throws — an unreachable network is an expected outcome here,
 * not an error condition.
 */
export async function probeOllamaRoute(
  options: ProbeOllamaRouteOptions = {},
): Promise<OllamaRouteResult> {
  const getEnv = options.getEnv ?? ((key: string) => process.env[key]);
  const candidates = options.candidates ?? resolveOllamaRouteCandidates(getEnv);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ROUTE_TIMEOUT_MS;

  const attempts: OllamaRouteAttempt[] = [];

  for (const candidate of candidates) {
    try {
      const response = await doFetch(`${candidate.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        attempts.push({ ...candidate, ok: false, error: `HTTP ${response.status}` });
        continue;
      }
      const body = (await response.json()) as unknown;
      const models = parseTagNames(body);
      if (models.length === 0) {
        attempts.push({ ...candidate, ok: false, error: "reachable but no models installed" });
        continue;
      }
      attempts.push({ ...candidate, ok: true, error: null });
      return {
        ok: true,
        tier: candidate.tier,
        label: candidate.label,
        endpoint: candidate.endpoint,
        models,
        attempts,
        reason: null,
      };
    } catch (error) {
      attempts.push({
        ...candidate,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: false,
    tier: null,
    label: "",
    endpoint: null,
    models: [],
    attempts,
    reason: buildFailureReason(attempts),
  };
}

/** E: a clear, actionable message — never a bare "unreachable". */
function buildFailureReason(attempts: OllamaRouteAttempt[]): string {
  if (attempts.length === 0) {
    return (
      "No Ollama endpoint configured. Set OLLAMA_LAN_URL to your PC's home-network " +
      "address and/or OLLAMA_TAILSCALE_URL to its Tailscale hostname so LiTT can " +
      "reach it from anywhere."
    );
  }
  const detail = attempts.map((a) => `${a.label} (${a.endpoint}): ${a.error}`).join("; ");
  const triedTailscale = attempts.some((a) => a.tier === "tailscale");
  const hint = triedTailscale
    ? "If you're away from home Wi-Fi, confirm Tailscale is running on both this " +
      "device and the PC (`tailscale status` on each) and that OLLAMA_TAILSCALE_URL " +
      "matches the PC's Tailscale hostname/IP."
    : "Set OLLAMA_TAILSCALE_URL to the PC's Tailscale hostname/IP to reach it " +
      "when you're away from the home network.";
  return `Ollama unreachable on every configured route — ${detail}. ${hint}`;
}
