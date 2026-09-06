/**
 * Railway environment-variable inspector — JSON-based, structural, safe.
 *
 * This module is the SINGLE source of truth for reading Railway service env
 * vars. It replaces the old human-readable `railway variables` output parsing
 * (which was fragile and inspected the wrong service).
 *
 * Contract:
 *   - Retrieves variables with:  railway variable list --service <svc> --environment <env> --json
 *   - Parses the JSON structurally (never line-splitting human-readable text).
 *   - Never prints or returns secret VALUES to callers — only presence/absence.
 *   - Uses the canonical Railway production service explicitly ("web").
 *
 * The Railway `variable list --json` output is a flat JSON object:
 *   { "KEY": "value", "OTHER_KEY": "value", ... }
 * including Railway-injected keys (RAILWAY_ENVIRONMENT, etc.).
 */

import { exec } from "./utils.js";

// ─── Canonical Railway context ─────────────────────────────────────────

/**
 * The Railway service that serves production traffic for www.litlabs.net.
 *
 * This is the service whose env vars we inspect for Stripe/Clerk/Supabase/
 * Terminal configuration.
 *
 * Do not change these constants from a service *name* alone — names in this
 * account are actively misleading. The authority is domain ownership: the
 * production service is whichever service holds the `www.litlabs.net` custom
 * domain, confirmed with:
 *
 *   railway domain list --project <id> --environment production --service <name>
 *
 * History, because this has now been wrong twice. The original code inspected
 * "@litlabs/litt-shell". That was corrected to "cli" — still wrong. Both live
 * in the "litlabs-website" project, which despite its name serves no
 * production traffic; `cli` reported `[env-preflight] FAILED … degraded mode`
 * on its own boot while the real site was healthy. Production is the service
 * literally named "web", in the project named "litlabs-terminal-server",
 * which has held www.litlabs.net since 2026-08-19.
 *
 * checkProductionServiceDomain() in production-checks.ts asserts this at
 * runtime so a future rename or migration surfaces as a failed check rather
 * than as silent "NOT SET" reports about a machine nobody is using.
 */
export const RAILWAY_PRODUCTION_SERVICE = "web";
export const RAILWAY_PRODUCTION_ENVIRONMENT = "production";
/**
 * The Railway project ID that owns the production web service. Passed
 * explicitly to `railway variable list --project` so the command works from
 * any cwd without requiring a linked project (worktrees are not linked).
 *
 * Project name is "litlabs-terminal-server" — historical, and unrelated to
 * what it now hosts. See RAILWAY_PRODUCTION_SERVICE above.
 */
export const RAILWAY_PRODUCTION_PROJECT_ID = "69a241af-cd1b-4cf1-baff-f5a6a5a5d7d5";

// ─── Types ─────────────────────────────────────────────────────────────

/** A read-only map of env-var name -> non-empty value. */
export type EnvVarMap = ReadonlyMap<string, string>;

/** Result of fetching Railway env vars. */
export interface RailwayEnvResult {
  /** The parsed variables, or null if the fetch failed. */
  vars: EnvVarMap | null;
  /** The service that was inspected (for diagnostics). */
  service: string;
  /** The environment that was inspected. */
  environment: string;
  /** Non-fatal error reason when vars is null. */
  error?: string;
}

/** Exec function shape (matches lib/utils.ts exec). Injectable for tests. */
export type ExecFn = (
  cmd: string,
  options?: { cwd?: string },
) => { stdout: string; stderr: string; exitCode: number };

// ─── Core inspector ────────────────────────────────────────────────────

/**
 * Fetch and structurally parse Railway env vars for a service/environment.
 *
 * Runs:
 *   railway variable list --service <service> --environment <environment> --json
 *
 * Returns a map of KEY -> value. Values are kept internally for contract
 * checks (non-empty, prefix) but are NEVER returned to callers in a way that
 * could be printed — callers use hasNonEmpty/hasAnyNonEmpty which only
 * return booleans.
 *
 * @param options.service      Railway service name (default: "web")
 * @param options.environment  Railway environment (default: "production")
 * @param options.project      Railway project ID (default: canonical litlabs-terminal-server)
 * @param options.execFn       Injectable exec for tests
 */
export function getRailwayEnvVars(options: {
  service?: string;
  environment?: string;
  project?: string;
  execFn?: ExecFn;
} = {}): RailwayEnvResult {
  const service = options.service ?? RAILWAY_PRODUCTION_SERVICE;
  const environment = options.environment ?? RAILWAY_PRODUCTION_ENVIRONMENT;
  const project = options.project ?? RAILWAY_PRODUCTION_PROJECT_ID;
  const run = options.execFn ?? exec;

  // --project is passed explicitly so the command works from any cwd
  // without requiring a linked project (worktrees are not linked).
  const cmd = `railway variable list --service "${service}" --environment "${environment}" --project "${project}" --json`;
  const r = run(cmd);

  if (r.exitCode !== 0) {
    return {
      vars: null,
      service,
      environment,
      error: r.stderr?.trim() || `railway variable list exited ${r.exitCode}`,
    };
  }

  const raw = r.stdout.trim();
  if (!raw) {
    return { vars: null, service, environment, error: "empty output" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      vars: null,
      service,
      environment,
      error: err instanceof Error ? `JSON parse failed: ${err.message}` : "JSON parse failed",
    };
  }

  // Railway `variable list --json` returns a flat object { KEY: "value" }.
  // Be defensive: accept any plain object whose string-keyed properties are
  // string values. Ignore non-string values (shouldn't happen, but guard).
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { vars: null, service, environment, error: "unexpected JSON shape" };
  }

  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      map.set(key, value);
    }
  }

  return { vars: map, service, environment };
}

// ─── Contract helpers ──────────────────────────────────────────────────

/**
 * True if `key` exists in the map with a non-empty (whitespace-trimmed) value.
 * Never reveals the value.
 */
export function hasNonEmpty(vars: EnvVarMap | null, key: string): boolean {
  if (!vars) return false;
  const v = vars.get(key);
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * True if ANY of `keys` exists with a non-empty value (OR fallback contract).
 * Returns the first matching key, or null if none match. Never reveals values.
 */
export function hasAnyNonEmpty(
  vars: EnvVarMap | null,
  keys: readonly string[],
): string | null {
  if (!vars) return null;
  for (const key of keys) {
    if (hasNonEmpty(vars, key)) return key;
  }
  return null;
}

/**
 * True if `key` exists, is non-empty, AND its value starts with `prefix`.
 * Used for type/prefix assertions (e.g. STRIPE_SECRET_KEY starts with "sk_").
 * Never reveals the value beyond the boolean + prefix check.
 */
export function hasNonEmptyWithPrefix(
  vars: EnvVarMap | null,
  key: string,
  prefix: string,
): boolean {
  if (!vars) return false;
  const v = vars.get(key);
  return typeof v === "string" && v.trim().length > 0 && v.startsWith(prefix);
}
