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

import { exec } from "./utils.js";
import { redactEnvValue, redact } from "./secret-redaction.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
export const RAILWAY_SERVICE_ID = "0fbedda0-0053-481c-9e4f-a3ea8100eb16";
export const RAILWAY_ENVIRONMENT_ID = "56de816e-3904-4b35-9dde-031303a6d5cb";
export const RAILWAY_SERVICE_NAME = "@litlabs/litt-shell";
export const PRODUCTION_DOMAIN = "https://www.litlabs.net";
export const HEALTH_ENDPOINT = "/api/health";
export const WEBHOOK_URL = "https://www.litlabs.net/api/stripe/webhook";

/**
 * Canonical repository root for git checks.
 *
 * Resolved relative to the CLI source location so checks work regardless
 * of where `litt` is invoked from. dist/lib/production-checks.js → dist/
 * → packages/litt-cli/ → repo root.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

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
  const branch = exec(`git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD`);
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
  const status = exec(`git -C "${REPO_ROOT}" status --porcelain`);
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
  const local = exec(`git -C "${REPO_ROOT}" rev-parse HEAD`);
  const remote = exec(`git -C "${REPO_ROOT}" rev-parse origin/main`);
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
    fix: `Run: git -C "${REPO_ROOT}" pull --ff-only origin main`,
  };
}

// ─── Railway Checks ────────────────────────────────────────────────────

export function checkRailwayAuth(): CheckResult {
  const r = exec("railway whoami 2>&1");
  if (r.exitCode === 0 && r.stdout.trim().length > 0) {
    return { id: "railway.auth", label: "Railway auth", status: "pass", detail: r.stdout.trim() };
  }
  return { id: "railway.auth", label: "Railway auth", status: "fail", detail: "Not authenticated", fix: "Run: railway login" };
}

export function checkRailwayProject(): CheckResult {
  const r = exec(`railway project list --json 2>&1`);
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
    const expected = expectedSHA ?? exec(`git -C "${REPO_ROOT}" rev-parse HEAD`).stdout.trim();
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
  const r = exec("stripe config --list 2>&1");
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
 * Check Railway env vars for Stripe key presence.
 * Never prints values — only presence/absence.
 */
export function checkStripeSecretKey(): CheckResult {
  const r = exec(`railway variables --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
  if (r.exitCode !== 0) {
    return { id: "stripe.secret", label: "Stripe secret key", status: "fail", detail: "Cannot read Railway variables" };
  }
  const output = redact(r.stdout);
  if (output.includes("STRIPE_SECRET_KEY=sk_")) {
    // Check if it's a live or test key (without revealing the value)
    const line = r.stdout.split("\n").find((l) => l.startsWith("STRIPE_SECRET_KEY="));
    if (line?.includes("sk_live_")) {
      return { id: "stripe.secret", label: "Stripe secret key", status: "pass", detail: "SET (live mode)" };
    }
    if (line?.includes("sk_test_")) {
      return { id: "stripe.secret", label: "Stripe secret key", status: "warn", detail: "SET (test mode — should be live for production)" };
    }
    return { id: "stripe.secret", label: "Stripe secret key", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.secret",
    label: "Stripe secret key",
    status: "fail",
    detail: "NOT SET",
    fix: "Set STRIPE_SECRET_KEY in Railway production environment",
  };
}

export function checkStripePublishableKey(): CheckResult {
  const r = exec(`railway variables --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
  if (r.exitCode !== 0) {
    return { id: "stripe.pk", label: "Stripe publishable key", status: "fail", detail: "Cannot read Railway variables" };
  }
  if (r.stdout.includes("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_")) {
    return { id: "stripe.pk", label: "Stripe publishable key", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.pk",
    label: "Stripe publishable key",
    status: "fail",
    detail: "NOT SET",
    fix: "Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in Railway",
  };
}

export function checkWebhookSecret(): CheckResult {
  const r = exec(`railway variables --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
  if (r.exitCode !== 0) {
    return { id: "stripe.whsec", label: "Webhook signing secret", status: "fail", detail: "Cannot read Railway variables" };
  }
  if (r.stdout.includes("STRIPE_WEBHOOK_SECRET=whsec_")) {
    return { id: "stripe.whsec", label: "Webhook signing secret", status: "pass", detail: "SET" };
  }
  return {
    id: "stripe.whsec",
    label: "Webhook signing secret",
    status: "fail",
    detail: "NOT SET",
    fix: "Reveal signing secret in Stripe Dashboard → Webhooks, then set STRIPE_WEBHOOK_SECRET in Railway",
  };
}

/**
 * Check the live webhook endpoint exists and has the right events.
 */
export function checkWebhookEndpoint(): CheckResult {
  const r = exec("stripe webhook_endpoints list --live 2>&1");
  if (r.exitCode !== 0) {
    return { id: "stripe.webhook", label: "Webhook endpoint", status: "fail", detail: "Cannot list webhook endpoints" };
  }
  if (!r.stdout.includes(WEBHOOK_URL)) {
    return { id: "stripe.webhook", label: "Webhook endpoint", status: "fail", detail: "Endpoint not found", fix: `Create webhook endpoint for ${WEBHOOK_URL}` };
  }
  // Check enabled events
  const hasAllEvents = EXPECTED_WEBHOOK_EVENTS.every((evt) => r.stdout.includes(evt));
  if (hasAllEvents) {
    return { id: "stripe.webhook", label: "Webhook endpoint", status: "pass", detail: `${EXPECTED_WEBHOOK_EVENTS.length} events configured` };
  }
  const missing = EXPECTED_WEBHOOK_EVENTS.filter((evt) => !r.stdout.includes(evt));
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
  const creatorR = exec("stripe prices retrieve price_1U36qFJ53kgx4fp5avhUOuBH --live 2>&1");
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
  const proR = exec("stripe prices retrieve price_1U36qFJ53kgx4fp52s6oy53l --live 2>&1");
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
  const founderR = exec("stripe prices retrieve price_1U066EJ53kgx4fp5ZLKsk6wp --live 2>&1");
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
 * Canonical resolution (from src/lib/terminal-url.ts):
 *   1. TERMINAL_PUBLIC_URL            — canonical env var (preferred)
 *   2. NEXT_PUBLIC_TERMINAL_WS_URL    — browser-side WebSocket URL
 *   3. NEXT_PUBLIC_TERMINAL_HTTP_URL  — browser-side HTTP fallback
 *   4. Legacy hardcoded production URL (fallback, not configuration)
 *
 * A pass requires at least one env var to be set with a non-empty value.
 */
export function checkTerminalService(): CheckResult {
  const r = exec(`railway variables --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
  if (r.exitCode !== 0) {
    return { id: "terminal.service", label: "Terminal service", status: "fail", detail: "Cannot read Railway variables" };
  }
  const lines = r.stdout.split("\n");
  const hasValue = (key: string): boolean => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return !!line && line.length > key.length + 1;
  };
  const hasCanonical = hasValue("TERMINAL_PUBLIC_URL");
  const hasWsUrl = hasValue("NEXT_PUBLIC_TERMINAL_WS_URL");
  const hasHttpUrl = hasValue("NEXT_PUBLIC_TERMINAL_HTTP_URL");
  if (hasCanonical || hasWsUrl || hasHttpUrl) {
    const source = hasCanonical ? "TERMINAL_PUBLIC_URL" : hasWsUrl ? "NEXT_PUBLIC_TERMINAL_WS_URL" : "NEXT_PUBLIC_TERMINAL_HTTP_URL";
    return { id: "terminal.service", label: "Terminal service", status: "pass", detail: `URLs configured (${source})` };
  }
  return {
    id: "terminal.service",
    label: "Terminal service",
    status: "fail",
    detail: "Terminal URLs not configured",
    fix: "Set TERMINAL_PUBLIC_URL (or NEXT_PUBLIC_TERMINAL_WS_URL) in Railway production",
  };
}

/**
 * Check Studio prerequisites — env vars and build artifacts.
 */
export function checkStudioPrerequisites(): CheckResult {
  const r = exec(`railway variables --service "${RAILWAY_SERVICE_NAME}" --environment production 2>&1`);
  if (r.exitCode !== 0) {
    return { id: "studio.prereqs", label: "Studio prerequisites", status: "fail", detail: "Cannot read Railway variables" };
  }
  const lines = r.stdout.split("\n");
  const hasValue = (key: string): boolean => {
    const line = lines.find((l) => l.startsWith(`${key}=`));
    return !!line && line.length > key.length + 1;
  };
  const hasClerk = hasValue("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") || hasValue("CLERK_SECRET_KEY");
  const hasSupabase = hasValue("NEXT_PUBLIC_SUPABASE_URL") || hasValue("SUPABASE_URL");
  const hasStripe = hasValue("STRIPE_SECRET_KEY");
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
    fix: `Set ${missing.join(", ")} env vars in Railway production`,
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
