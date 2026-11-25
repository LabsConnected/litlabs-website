/**
 * Sentinel probes — one cheap, timeout-bounded check per platform
 * service. Every probe returns a ProbeResult; probes never throw.
 *
 * Reuse notes:
 *   - AI provider probes delegate to system-health.ts so Sentinel and
 *     the dashboard report identical provider state (and share its
 *     45s cache — a Sentinel pass costs no extra provider calls when
 *     the dashboard just probed).
 *   - The terminal probe hits the terminal-server's unauthenticated
 *     /health/live liveness route.
 *   - The Stripe probe is a real API call (GET /v1/balance) — it
 *     verifies the key works, not just that it exists. The key is
 *     never logged or included in details.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { probeGemini, probeOpenRouter } from "@/lib/system-health";
import { getTerminalServerUrl } from "@/lib/terminal-url";
import { checkBrowserUrlPolicy } from "@/lib/litt-intelligence/browser-url-policy";
import { mapAiProviderProbe } from "./state";
import type { ProbeResult, SentinelServiceId } from "./types";

const PROBE_TIMEOUT_MS = 6_000;

function timedOut(detail: string, latencyMs: number | null): ProbeResult {
  return { ok: false, latencyMs, detail, severity: "critical" };
}

async function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("probe timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function probeDatabase(client: SupabaseClient | null): Promise<ProbeResult> {
  const t0 = Date.now();
  if (!client) {
    return { ok: true, latencyMs: null, detail: "database client not configured", applicable: false };
  }
  try {
    const { error } = await withTimeout(
      client.from("users").select("id", { count: "exact", head: true }),
      PROBE_TIMEOUT_MS,
    );
    const latencyMs = Date.now() - t0;
    if (error) {
      return { ok: false, latencyMs, detail: `query failed: ${error.message}` };
    }
    return { ok: true, latencyMs, detail: "query ok" };
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "database unreachable", Date.now() - t0);
  }
}

export async function probeAiProvider(id: "ai-gemini" | "ai-openrouter"): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    const probe = id === "ai-gemini" ? probeGemini : probeOpenRouter;
    const result = await withTimeout(probe(), PROBE_TIMEOUT_MS + 4_000);
    return mapAiProviderProbe(result.state, result.detail, result.latencyMs ?? Date.now() - t0);
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "provider probe failed", Date.now() - t0);
  }
}

export async function probeTerminalServer(): Promise<ProbeResult> {
  const t0 = Date.now();
  const base = getTerminalServerUrl();
  if (!base) {
    return { ok: true, latencyMs: null, detail: "terminal server URL not configured", applicable: false };
  }
  try {
    const res = await withTimeout(
      fetch(`${base}/health/live`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }),
      PROBE_TIMEOUT_MS + 1_000,
    );
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      return { ok: true, latencyMs, detail: `liveness ${res.status}` };
    }
    return {
      ok: false,
      latencyMs,
      detail: `liveness returned ${res.status}`,
      severity: res.status >= 500 ? "critical" : "warning",
    };
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "terminal server unreachable", Date.now() - t0);
  }
}

export async function probeStripe(): Promise<ProbeResult> {
  const t0 = Date.now();
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) {
    return { ok: true, latencyMs: null, detail: "Stripe key not configured", applicable: false };
  }
  try {
    const res = await withTimeout(
      fetch("https://api.stripe.com/v1/balance", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }),
      PROBE_TIMEOUT_MS + 1_000,
    );
    const latencyMs = Date.now() - t0;
    if (res.ok) {
      return { ok: true, latencyMs, detail: "balance endpoint ok" };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs, detail: `API key rejected (${res.status})` };
    }
    if (res.status === 429) {
      return { ok: false, latencyMs, detail: "rate limited", severity: "warning" };
    }
    return {
      ok: false,
      latencyMs,
      detail: `API returned ${res.status}`,
      severity: res.status >= 500 ? "critical" : "warning",
    };
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "Stripe unreachable", Date.now() - t0);
  }
}

/**
 * Deployment is informational only: the process is running, so the
 * only meaningful signal is which platform it is on. Always ok;
 * "unknown" when running outside a known deploy target.
 */
export function probeDeployment(): ProbeResult {
  const platform = process.env.RAILWAY_ENVIRONMENT
    ? `railway/${process.env.RAILWAY_ENVIRONMENT}`
    : process.env.VERCEL || process.env.VERCEL_URL
      ? "vercel"
      : null;
  if (!platform) {
    return { ok: true, latencyMs: null, detail: "local / preview runtime", applicable: false };
  }
  return { ok: true, latencyMs: null, detail: `running on ${platform}` };
}

/**
 * Studio browser security probe — replays the navigate-time URL policy
 * battery on every Sentinel pass so a policy regression (false
 * positive on a legitimate domain, or a phishing/SSRF bypass) opens an
 * incident instead of silently shipping. Pure function, no network,
 * no secrets. Complements the authenticated staging acceptance gate
 * (scripts/final-acceptance/browser-security-check.mjs), which covers
 * the live route; this probe covers the policy layer continuously.
 */
export function probeStudioBrowser(): ProbeResult {
  const t0 = Date.now();
  try {
    const mustAllow = [
      "https://www.google.com/",
      "https://github.com/",
      "https://google.com.au/",
      "https://service.gov.uk/",
    ];
    const mustBlock = [
      "http://localhost:3000/",
      "http://169.254.169.254/latest/meta-data",
      "http://192.168.1.1/",
      "https://g00gle.com/",
      "https://google.com.evil.com/",
      "https://g00glelogin.com/",
      "https://xn--pple-43d.com/",
    ];
    const failures: string[] = [];
    for (const url of mustAllow) {
      const r = checkBrowserUrlPolicy(url);
      if (!r.allowed) failures.push(`allowed-case blocked: ${url} (${r.reason ?? "?"})`);
    }
    for (const url of mustBlock) {
      const r = checkBrowserUrlPolicy(url);
      if (r.allowed) failures.push(`blocked-case allowed: ${url}`);
    }
    const latencyMs = Date.now() - t0;
    if (failures.length > 0) {
      return {
        ok: false,
        latencyMs,
        detail: `policy regression: ${failures.slice(0, 3).join("; ")}`,
        severity: "critical",
      };
    }
    return { ok: true, latencyMs, detail: `${mustAllow.length + mustBlock.length} policy assertions ok` };
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "browser policy probe failed", Date.now() - t0);
  }
}

export type ProbeFn = () => Promise<ProbeResult>;

/** All Sentinel probes keyed by service id. Injectable for tests. */
export function defaultProbes(client: SupabaseClient | null): Record<SentinelServiceId, ProbeFn> {
  return {
    database: () => probeDatabase(client),
    "ai-gemini": () => probeAiProvider("ai-gemini"),
    "ai-openrouter": () => probeAiProvider("ai-openrouter"),
    "terminal-server": () => probeTerminalServer(),
    stripe: () => probeStripe(),
    deployment: async () => probeDeployment(),
    "studio-browser": async () => probeStudioBrowser(),
  };
}
