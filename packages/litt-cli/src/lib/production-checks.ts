/**
 * Production checks — shared verification logic for all production commands.
 *
 * Each check returns a structured result so callers can:
 *   - Display results in their preferred format (TUI, plain text, JSON)
 *   - Aggregate results for doctor/finish orchestration
 *   - Resume from the first failing check
 *
 * Design principles:
 *   - Never print secret values (use redactEnvValue)
 *   - Never mutate Stripe, Railway, or any external system
 *   - All checks are read-only and idempotent
 *   - Each check has a stable string ID for resumable state
 */

import { exec, detectProject, resolveProjectCwd } from "./utils.js";
import { redactEnvValue, redact } from "./secret-redaction.js";
import {
  getRailwayEnvVars,
  hasNonEmpty,
  hasAnyNonEmpty,
  hasNonEmptyWithPrefix,
  type EnvVarMap,
  type ExecFn,
  RAILWAY_PRODUCTION_SERVICE,
  RAILWAY_PRODUCTION_ENVIRONMENT,
} from "./railway-env.js";

// ─── Types ─────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "warn" | "skip" | "blocked";

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  /** Optional remediation hint shown to the user */
  fix?: string;
}

export interface CheckGroup {
  name: string;
  results: CheckResult[];
}

// ─── Constants ─────────────────────────────────────────────────────────

export const RAILWAY_PROJECT_ID = "3d5b8abe-088c-4a6c-9b34-7054829247c9";
/**
 * The Railway service that hosts the production web app env vars.
 *
 * This is the "cli" service — NOT "@litlabs/litt-shell" (a different service
 * that does not carry Stripe/Clerk/Supabase/Terminal config). Inspecting the
 * wrong service was the root cause of false "NOT SET" reports.
 *
 * Service ID confirmed via `railway service list --environment production --json`.
 */
export const RAILWAY_SERVICE_ID = "f71b9a86-cd1e-4c5a-ba00-b4efc0b6e119";
export const RAILWAY_ENVIRONMENT_ID = "56de816e-3904-4b35-9dde-031303a6d5cb";
export const RAILWAY_SERVICE_NAME = RAILWAY_PRODUCTION_SERVICE;
export const PRODUCTION_DOMAIN = "https://www.litlabs.net";
export const HEALTH_ENDPOINT = "/api/health";
export const WEBHOOK_URL = "https://www.litlabs.net/api/stripe/webhook";

/**
 * Resolve the project LiTT was actually invoked against.
 *
 * Never derive this from the CLI binary location: a globally installed
 * CLI or a CLI built in another worktree must still operate on the user's
 * active project.
 */
export function getProductionRepoRoot(): string {
  return detectProject(resolveProjectCwd()).rootDir;
}

export const EXPECTED_PRICES = {
  creator: { amount: 1500, currency: "usd", interval: "month", mode: "recurring" },
  pro: { amount: 3900, currency: "usd", interval: "month", mode: "recurring" },
  founder: { amount: 14900, currency: "usd", mode: "one_time" },
} as const;

export const EXPECTED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
  "charge.refunded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
] as const;

// ─── Git Checks ────────────────────────────────────────────────────────

export function checkGitMain(): CheckResult {
  const branch = exec(`git -C "${getProductionRepoRoot()}" rev-parse --abbrev-ref HEAD`);
  if (branch.exitCode !== 0) {
    return { id: "git.branch", label: "Git branch", status: "fail", detail: "Cannot determine branch" };
  }
  const branchName = branch.stdout.trim();
  if (branchName === "main") {
    return { id: "git.branch", label: "Git branch", status: "pass", detail: "main" };
  }
  return { id: "git.branch", label: "Git branch", status: "fail", detail: `Expected main, got ${branchName}` };
}

export function checkGitClean(): CheckResult {
  const status = exec(`git -C "${getProductionRepoRoot()}" status --porcelain`);
  if (status.exitCode !== 0) {
    return { id: "git.clean", label: "Working tree", status: "fail", detail: "Cannot determine git status" };
  }
  if (status.stdout.length === 0) {
    return { id: "git.clean", label: "Working tree", status: "pass", detail: "clean" };
  }
  const lines = status.stdout.split("\n").filter(Boolean);
  return { id: "git.clean", label: "Working tree", status: "warn", detail: `${lines.length} uncommitted changes` };
}

export function checkGitSynced(): CheckResult {
  const local = exec(`git -C "${getProductionRepoRoot()}" rev-parse HEAD`);
  const remote = exec(`git -C "${getProductionRepoRoot()}" rev-parse origin/main`);
  if (local.exitCode !== 0 || remote.exitCode !== 0) {
    return { id: "git.synced", label: "origin/main sync", status: "fail", detail: "Cannot compare HEAD with origin/main" };
  }
  if (local.stdout.trim() === remote.stdout.trim()) {
    return { id: "git.synced", label: "origin/main sync", status: "pass", detail: local.stdout.trim().slice(0, 8) };
  }
  return {
    id: "git.synced",
    label: "origin/main sync",
    status: "fail",
    detail: `local ${local.stdout.trim().slice(0, 8)} ≠ origin ${remote.stdout.trim().slice(0, 8)}`,
    fix: `Run: git -C "${getProductionRepoRoot()}" pull --ff-only origin main`,
  };
}

// ─── Railway Checks ────────────────────────────────────────────────────

export function checkRailwayAuth(): CheckResult {
  const r = exec("railway whoami");
  if (r.exitCode === 0 && r.stdout.trim().length > 0) {
    return { id: "railway.auth", label: "Railway auth", status: "pass", detail: r.stdout.trim() };
  }
  return { id: "railway.auth", label: "Railway auth", status: "fail", detail: "Not authenticated", fix: "Run: railway login" };
}

export function checkRailwayProject(): CheckResult {
  const r = exec(`railway project list --json`);
  if (r.exitCode !== 0) {
    return { id: "railway.project", label: "Railway project", status: "fail", detail: "Cannot list projects" };
  }
  if (r.stdout.includes(RAILWAY_PROJECT_ID)) {
    return { id: "railway.project", label: "Railway project", status: "pass", detail: "litlabs-website" };
  }
  return { id: "railway.project", label: "Railway project", status: "fail", detail: "Project not found" };
}

// ─── Production Health Check ───────────────────────────────────────────

export async function checkProductionHealth(): Promise<CheckResult> {
  try {
    const response = await fetch(`${PRODUCTION_DOMAIN}${HEALTH_ENDPOINT}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { id: "prod.health", label: "Production health", status: "fail", detail: `HTTP ${response.status}` };
    }
    const data = await response.json() as {
      status?: string;
      commit?: string;
      checks?: Record<string, { status?: string }>;
    };
    const allOk = data.status === "ok" &&
      Object.values(data.checks ?? {}).every((c) => c.status === "ok");
    if (allOk) {
      return {
        id: "prod.health",
        label: "Production health",
        status: "pass",
        detail: `healthy @ ${data.commit?.slice(0, 8) ?? "unknown"}`,
      };
    }
    const failed = Object.entries(data.checks ?? {})
      .filter(([, c]) => c.status !== "ok")
      .map(([k]) => k);
    return {
      id: "prod.health",
      label: "Production health",
      status: "warn",
      detail: `degraded: ${failed.join(", ")}`,
    };
  } catch (err) {
    return {
      id: "prod.health",
      label: "Production health",
      status: "fail",
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

/**
 * Normalize a git SHA for comparison.
 *
 * Git SHAs can be full (40 chars) or abbreviated (7-40 chars). Two SHAs
 * are equivalent if one is a prefix of the other and both are at least
 * 7 chars long (git's minimum abbreviation length).
 *
 * This handles the common case where the health endpoint reports a short
 * SHA (e.g. "28e87432") but `git rev-parse HEAD` returns the full 40-char
 * SHA. Without normalization, `deployedSHA === expected` fails even when
 * they refer to the same commit.
 *
 * @returns lowercase trimmed SHA, or undefined if invalid
 */
export function normalizeSHA(sha: string | undefined): string | undefined {
  if (!sha) return undefined;
  const normalized = sha.trim().toLowerCase();
  // Git SHAs are hex strings of 7-40 characters
  if (!/^[0-9a-f]{7,40}$/.test(normalized)) return undefined;
  return normalized;
}

/**
 * Compare two git SHAs for equivalence.
 *
 * Two SHAs are equivalent if:
 *   - both normalize to valid hex strings, AND
 *   - one is a prefix of the other (handles short vs full SHA)
 *
 * @returns true if the SHAs refer to the same commit
 */
export function shasEqual(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeSHA(a);
  const nb = normalizeSHA(b);
  if (!na || !nb) return false;
  // Short vs full: one is a prefix of the other
  return na.startsWith(nb) || nb.startsWith(na);
}

export async function checkProductionSHA(expectedSHA?: string): Promise<CheckResult> {
  try {
    const response = await fetch(`${PRODUCTION_DOMAIN}${HEALTH_ENDPOINT}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      return { id: "prod.sha", label: "Production SHA", status: "fail", detail: `HTTP ${response.status}` };
    }
    const data = await response.json() as { commit?: string };
    const deployedSHA = data.commit?.trim();
    if (!deployedSHA) {
      return { id: "prod.sha", label: "Production SHA", status: "warn", detail: "SHA not reported" };
    }
    const expected = expectedSHA ?? exec(`git -C "${getProductionRepoRoot()}" rev-parse HEAD`).stdout.trim();
    if (shasEqual(deployedSHA, expected)) {
      return { id: "prod.sha", label: "Production SHA", status: "pass", detail: normalizeSHA(deployedSHA)!.slice(0, 8) };
    }
    return {
      id: "prod.sha",
      label: "Production SHA",
      status: "warn",
      detail: `deployed ${normalizeSHA(deployedSHA)!.slice(0, 8)} ≠ expected ${normalizeSHA(expected)!.slice(0, 8)}`,
      fix: "Run: litt deploy verify",
    };
  } catch (err) {
    return {
      id: "prod.sha",
      label: "Production SHA",
      status: "fail",
      detail: err instanceof Error ? err.message : "unreachable",
    };
  }
}

// ─── Stripe Checks ─────────────────────────────────────────────────────

/**
 * Check Stripe CLI auth by running a simple API call.
 * Uses whatever Stripe CLI profile is configured.
 */
export function checkStripeAuth(): CheckResult {
  const r = exec("stripe config --list");
  if (r.exitCode === 0 && r.stdout.length > 0) {
    // Check if the key has expired
    if (r.stdout.includes("expired")) {
      return { id: "stripe.auth", label: "Stripe auth", status: "fail", detail: "API key expired", fix: "Run: stripe login" };
    }
    return { id: "stripe.auth", label: "Stripe auth", status: "pass", detail: "authenticated" };
  }
  return { id: "stripe.auth", label: "Stripe auth", status: "fail", detail: "Not authenticated", fix: "Run: stripe login" };
}

/**
 * Check Railway env vars for the Stripe secret key.
 *
 * Contract: STRIPE_SECRET_KEY must exist and be non-empty.
 * Detects live vs test mode via prefix (sk_live_ / sk_test_) without
 * revealing the value.
 *
 * Never prints values — only presence/absence and mode.
 *
 * @param envMap  Optional pre-fetched env map (for tests). If omitted, fetches
 *                from the canonical "cli" service via JSON.
 * @param execFn  Optional exec override (for tests).
 */
export function checkStripeSecretKey(
  envMap?: EnvVarMap | null,
  execFn?: ExecFn,
): CheckResult {
  const vars = envMap !== undefined ? envMap : getRailwayEnvVars({ execFn }).vars;
  if (vars === null) {
    return { id: "stripe.secret", label: "Stripe secret key", status: "fail", detail: "Cannot read Railway variables" };
  }
  if (hasNonEmptyWithPrefix(vars, "STRIPE_SECRET_KEY", "sk_live_")) {
    return { id: "stripe.secret", label: "Stripe secret key", status: "pass", detail: "SET (live mode)" };
  }
  if (hasNonEmptyWithPrefix(vars, "STRIPE_SECRET_KEY", "sk_test_")) {
    return { id: "stripe.secret", label: "Stripe secret key", status: "warn", detail: "SET (test mode — should be live for production)" };
  }
  if (hasNonEmpty(vars, "STRIPE_SECRET_KEY")) {
    return { id: "stripe.secret", label: "Stripe secret key", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.secret",
    label: "Stripe secret key",
    status: "fail",
    detail: "NOT SET",
    fix: "Set STRIPE_SECRET_KEY in Railway production environment (cli service)",
  };
}

/**
 * Check Railway env vars for the Stripe publishable key.
 *
 * Contract: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must exist and be non-empty.
 * Never prints values.
 */
export function checkStripePublishableKey(
  envMap?: EnvVarMap | null,
  execFn?: ExecFn,
): CheckResult {
  const vars = envMap !== undefined ? envMap : getRailwayEnvVars({ execFn }).vars;
  if (vars === null) {
    return { id: "stripe.pk", label: "Stripe publishable key", status: "fail", detail: "Cannot read Railway variables" };
  }
  if (hasNonEmpty(vars, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")) {
    return { id: "stripe.pk", label: "Stripe publishable key", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.pk",
    label: "Stripe publishable key",
    status: "fail",
    detail: "NOT SET",
    fix: "Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in Railway (cli service)",
  };
}

/**
 * Check Railway env vars for the Stripe webhook signing secret.
 *
 * Contract: STRIPE_WEBHOOK_SECRET must exist and be non-empty.
 * Never prints values.
 */
export function checkWebhookSecret(
  envMap?: EnvVarMap | null,
  execFn?: ExecFn,
): CheckResult {
  const vars = envMap !== undefined ? envMap : getRailwayEnvVars({ execFn }).vars;
  if (vars === null) {
    return { id: "stripe.whsec", label: "Webhook signing secret", status: "fail", detail: "Cannot read Railway variables" };
  }
  if (hasNonEmpty(vars, "STRIPE_WEBHOOK_SECRET")) {
    return { id: "stripe.whsec", label: "Webhook signing secret", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.whsec",
    label: "Webhook signing secret",
    status: "fail",
    detail: "NOT SET",
    fix: "Reveal signing secret in Stripe Dashboard → Webhooks, then set STRIPE_WEBHOOK_SECRET in Railway (cli service)",
  };
}

/** A live webhook endpoint as returned by `stripe webhook_endpoints list`. */
interface StripeWebhookEndpoint {
  id?: string;
  url?: string;
  status?: string;
  livemode?: boolean;
  enabled_events?: string[];
}

/**
 * Check the live webhook endpoint exists, is unique, and has the right events.
 *
 * Parses the JSON structurally rather than searching the raw text. Text search
 * could not attribute events to a specific endpoint — events present on ANY
 * endpoint satisfied the check — and it could not see the failure mode that
 * actually bit us: two enabled endpoints on the same URL. Railway holds one
 * signing secret, so a duplicate means every event is delivered twice and one
 * copy fails signature verification.
 */
export function checkWebhookEndpoint(execFn?: ExecFn): CheckResult {
  const run = execFn ?? exec;
  const r = run("stripe webhook_endpoints list --live");
  if (r.exitCode !== 0) {
    return { id: "stripe.webhook", label: "Webhook endpoint", status: "fail", detail: "Cannot list webhook endpoints" };
  }

  let endpoints: StripeWebhookEndpoint[];
  try {
    const parsed = JSON.parse(r.stdout) as { data?: StripeWebhookEndpoint[] };
    endpoints = parsed.data ?? [];
  } catch {
    return { id: "stripe.webhook", label: "Webhook endpoint", status: "fail", detail: "Cannot parse webhook endpoint list" };
  }

  const enabled = endpoints.filter(
    (e) => e.url === WEBHOOK_URL && e.livemode === true && e.status === "enabled",
  );

  if (enabled.length === 0) {
    return {
      id: "stripe.webhook",
      label: "Webhook endpoint",
      status: "fail",
      detail: "Endpoint not found",
      fix: `Create webhook endpoint for ${WEBHOOK_URL}`,
    };
  }

  if (enabled.length > 1) {
    return {
      id: "stripe.webhook",
      label: "Webhook endpoint",
      status: "fail",
      detail: `${enabled.length} enabled endpoints share ${WEBHOOK_URL} — only one signing secret is configured, so deliveries from the others fail signature verification`,
      fix: `Disable all but one: ${enabled.slice(1).map((e) => e.id).join(", ")}`,
    };
  }

  const events = new Set(enabled[0].enabled_events ?? []);
  const missing = EXPECTED_WEBHOOK_EVENTS.filter((evt) => !events.has(evt));
  if (missing.length === 0) {
    return {
      id: "stripe.webhook",
      label: "Webhook endpoint",
      status: "pass",
      detail: `${EXPECTED_WEBHOOK_EVENTS.length} events configured`,
    };
  }
  return {
    id: "stripe.webhook",
    label: "Webhook endpoint",
    status: "warn",
    detail: `Missing events: ${missing.join(", ")}`,
    fix: "Run: litt stripe repair",
  };
}

/**
 * Verify live Stripe prices match expected amounts.
 */
export function checkStripePrices(): CheckResult[] {
  const results: CheckResult[] = [];

  // Creator
  const creatorR = exec("stripe prices retrieve price_1U36qFJ53kgx4fp5avhUOuBH --live");
  if (creatorR.exitCode === 0) {
    try {
      const p = JSON.parse(creatorR.stdout);
      const exp = EXPECTED_PRICES.creator;
      if (p.active && p.unit_amount === exp.amount && p.type === exp.mode) {
        results.push({ id: "stripe.price.creator", label: "Creator price", status: "pass", detail: `$${exp.amount / 100}/mo, active` });
      } else {
        results.push({ id: "stripe.price.creator", label: "Creator price", status: "fail", detail: `amount=${p.unit_amount} active=${p.active} type=${p.type}` });
      }
    } catch {
      results.push({ id: "stripe.price.creator", label: "Creator price", status: "fail", detail: "Cannot parse price" });
    }
  } else {
    results.push({ id: "stripe.price.creator", label: "Creator price", status: "fail", detail: "Cannot retrieve price" });
  }

  // Pro
  const proR = exec("stripe prices retrieve price_1U36qFJ53kgx4fp52s6oy53l --live");
  if (proR.exitCode === 0) {
    try {
      const p = JSON.parse(proR.stdout);
      const exp = EXPECTED_PRICES.pro;
      if (p.active && p.unit_amount === exp.amount && p.type === exp.mode) {
        results.push({ id: "stripe.price.pro", label: "Pro price", status: "pass", detail: `$${exp.amount / 100}/mo, active` });
      } else {
        results.push({ id: "stripe.price.pro", label: "Pro price", status: "fail", detail: `amount=${p.unit_amount} active=${p.active} type=${p.type}` });
      }
    } catch {
      results.push({ id: "stripe.price.pro", label: "Pro price", status: "fail", detail: "Cannot parse price" });
    }
  } else {
    results.push({ id: "stripe.price.pro", label: "Pro price", status: "fail", detail: "Cannot retrieve price" });
  }

  // Founder
  const founderR = exec("stripe prices retrieve price_1U066EJ53kgx4fp5ZLKsk6wp --live");
  if (founderR.exitCode === 0) {
    try {
      const p = JSON.parse(founderR.stdout);
      const exp = EXPECTED_PRICES.founder;
      if (p.active && p.unit_amount === exp.amount && p.type === exp.mode) {
        results.push({ id: "stripe.price.founder", label: "Founder price", status: "pass", detail: `$${exp.amount / 100} one-time, active` });
      } else {
        results.push({ id: "stripe.price.founder", label: "Founder price", status: "fail", detail: `amount=${p.unit_amount} active=${p.active} type=${p.type}` });
      }
    } catch {
      results.push({ id: "stripe.price.founder", label: "Founder price", status: "fail", detail: "Cannot parse price" });
    }
  } else {
    results.push({ id: "stripe.price.founder", label: "Founder price", status: "fail", detail: "Cannot retrieve price" });
  }

  return results;
}

// ─── Terminal & Studio Checks ──────────────────────────────────────────

/**
 * Check that the terminal service is configured on Railway.
 *
 * Canonical resolution contract (OR fallback — any one satisfies):
 *   1. TERMINAL_PUBLIC_URL            — canonical env var (preferred)
 *   2. NEXT_PUBLIC_TERMINAL_WS_URL    — browser-side WebSocket URL
 *   3. NEXT_PUBLIC_TERMINAL_HTTP_URL  — browser-side HTTP fallback
 *
 * A pass requires at least one env var to be set with a non-empty value.
 * Never prints values.
 */
export function checkTerminalService(
  envMap?: EnvVarMap | null,
  execFn?: ExecFn,
): CheckResult {
  const vars = envMap !== undefined ? envMap : getRailwayEnvVars({ execFn }).vars;
  if (vars === null) {
    return { id: "terminal.service", label: "Terminal service", status: "fail", detail: "Cannot read Railway variables" };
  }
  const source = hasAnyNonEmpty(vars, [
    "TERMINAL_PUBLIC_URL",
    "NEXT_PUBLIC_TERMINAL_WS_URL",
    "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  ]);
  if (source) {
    return { id: "terminal.service", label: "Terminal service", status: "pass", detail: `URLs configured (${source})` };
  }
  return {
    id: "terminal.service",
    label: "Terminal service",
    status: "fail",
    detail: "Terminal URLs not configured",
    fix: "Set TERMINAL_PUBLIC_URL (or NEXT_PUBLIC_TERMINAL_WS_URL / NEXT_PUBLIC_TERMINAL_HTTP_URL) in Railway production (cli service)",
  };
}

/**
 * Check Studio prerequisites — env vars for Clerk, Supabase, Stripe.
 *
 * Contracts (OR fallback per service):
 *   - Clerk:    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY OR CLERK_SECRET_KEY
 *   - Supabase: NEXT_PUBLIC_SUPABASE_URL OR SUPABASE_URL
 *   - Stripe:   STRIPE_SECRET_KEY
 *
 * Each must be present and non-empty. Reports only the missing services
 * (never values). A single missing service fails ONLY that service's check,
 * not the others.
 */
export function checkStudioPrerequisites(
  envMap?: EnvVarMap | null,
  execFn?: ExecFn,
): CheckResult {
  const vars = envMap !== undefined ? envMap : getRailwayEnvVars({ execFn }).vars;
  if (vars === null) {
    return { id: "studio.prereqs", label: "Studio prerequisites", status: "fail", detail: "Cannot read Railway variables" };
  }
  const hasClerk = hasAnyNonEmpty(vars, ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"]) !== null;
  const hasSupabase = hasAnyNonEmpty(vars, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) !== null;
  const hasStripe = hasNonEmpty(vars, "STRIPE_SECRET_KEY");
  const missing: string[] = [];
  if (!hasClerk) missing.push("Clerk");
  if (!hasSupabase) missing.push("Supabase");
  if (!hasStripe) missing.push("Stripe");
  if (missing.length === 0) {
    return { id: "studio.prereqs", label: "Studio prerequisites", status: "pass", detail: "Clerk, Supabase, Stripe configured" };
  }
  return {
    id: "studio.prereqs",
    label: "Studio prerequisites",
    status: "fail",
    detail: `Missing: ${missing.join(", ")}`,
    fix: `Set ${missing.join(", ")} env vars in Railway production (cli service)`,
  };
}

// ─── Aggregation ───────────────────────────────────────────────────────

/**
 * Run all production checks and return grouped results.
 * This is the canonical check set used by `litt production doctor`
 * and `litt production finish`.
 */
export async function runAllChecks(): Promise<CheckGroup[]> {
  const groups: CheckGroup[] = [];

  // Repository
  groups.push({
    name: "Repository",
    results: [checkGitMain(), checkGitClean(), checkGitSynced()],
  });

  // Railway
  groups.push({
    name: "Railway",
    results: [checkRailwayAuth(), checkRailwayProject()],
  });

  // Production
  groups.push({
    name: "Production",
    results: [await checkProductionHealth(), await checkProductionSHA()],
  });

  // Stripe
  groups.push({
    name: "Stripe",
    results: [
      checkStripeAuth(),
      checkStripeSecretKey(),
      checkStripePublishableKey(),
      checkWebhookSecret(),
      checkWebhookEndpoint(),
      ...checkStripePrices(),
    ],
  });

  // Terminal
  groups.push({
    name: "Terminal",
    results: [checkTerminalService()],
  });

  // Studio
  groups.push({
    name: "Studio",
    results: [checkStudioPrerequisites()],
  });

  return groups;
}

/**
 * Summarize check results into a single pass/fail verdict.
 */
export function summarizeChecks(groups: CheckGroup[]): {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  blocked: number;
  verdict: "pass" | "fail" | "warn";
  firstFailure?: CheckResult;
} {
  let passed = 0, failed = 0, warnings = 0, blocked = 0;
  let firstFailure: CheckResult | undefined;

  for (const group of groups) {
    for (const result of group.results) {
      switch (result.status) {
        case "pass": passed++; break;
        case "fail":
          failed++;
          if (!firstFailure) firstFailure = result;
          break;
        case "warn": warnings++; break;
        case "blocked":
          blocked++;
          if (!firstFailure) firstFailure = result;
          break;
        case "skip": break;
      }
    }
  }

  const total = passed + failed + warnings + blocked;
  const verdict = failed > 0 || blocked > 0 ? "fail" : warnings > 0 ? "warn" : "pass";

  return { total, passed, failed, warnings, blocked, verdict, firstFailure };
}
