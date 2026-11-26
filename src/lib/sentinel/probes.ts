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
 * Backup probe — honest by design.
 *
 * Sentinel must never report backups as healthy until a real,
 * verified backup exists. The probe therefore reports "unknown"
 * (applicable:false) unless BACKUP_STATUS_URL points at a status
 * document published by the backup workstream, e.g.:
 *
 *   BACKUP_STATUS_URL=https://…/backup-status.json
 *   {
 *     "lastSuccessAt": "2026-11-25T04:00:00Z",
 *     "sha256Verified": true,
 *     "destination": "E:\\LiTT-Backups",
 *     "lastRestoreTestAt": "2026-11-20T00:00:00Z"
 *   }
 *
 * Freshness window: 36h (daily backups + slack). A stale or
 * unverified backup degrades; a missing/corrupt status document
 * fails. No status source → "unknown", never green.
 */
const BACKUP_MAX_AGE_MS = 36 * 60 * 60_000;

export async function probeBackup(): Promise<ProbeResult> {
  const t0 = Date.now();
  const url = process.env.BACKUP_STATUS_URL;
  if (!url) {
    return {
      ok: true,
      latencyMs: null,
      detail: "no backup telemetry configured (BACKUP_STATUS_URL unset)",
      applicable: false,
    };
  }
  try {
    const res = await withTimeout(
      fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: "no-store" }),
      PROBE_TIMEOUT_MS + 1_000,
    );
    const latencyMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, latencyMs, detail: `status endpoint returned ${res.status}` };
    }
    const body = (await res.json()) as {
      lastSuccessAt?: string;
      sha256Verified?: boolean;
      destination?: string;
      lastRestoreTestAt?: string;
    };
    if (!body.lastSuccessAt) {
      return { ok: false, latencyMs, detail: "status document missing lastSuccessAt" };
    }
    const ageMs = Date.now() - Date.parse(body.lastSuccessAt);
    if (!Number.isFinite(ageMs)) {
      return { ok: false, latencyMs, detail: "lastSuccessAt is not a valid timestamp" };
    }
    const dest = body.destination ? ` → ${body.destination}` : "";
    if (body.sha256Verified !== true) {
      return {
        ok: false,
        latencyMs,
        detail: `backup integrity unverified${dest}`,
        severity: "warning",
      };
    }
    if (ageMs > BACKUP_MAX_AGE_MS) {
      return {
        ok: false,
        latencyMs,
        detail: `last verified backup is ${Math.floor(ageMs / 3600_000)}h old${dest}`,
      };
    }
    const restore = body.lastRestoreTestAt
      ? `, restore test ${Math.floor((Date.now() - Date.parse(body.lastRestoreTestAt)) / 86_400_000)}d ago`
      : ", no restore test recorded";
    return {
      ok: true,
      latencyMs,
      detail: `verified backup ${Math.floor(ageMs / 3600_000)}h old${dest}${restore}`,
    };
  } catch (err) {
    return timedOut(err instanceof Error ? err.message : "backup status unreachable", Date.now() - t0);
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
    backup: () => probeBackup(),
  };
}
