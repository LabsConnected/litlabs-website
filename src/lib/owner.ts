// Owner / Platform Admin entitlement and test-mode simulation.
//
// The platform owner (identified by LITTLABS_VAPI_OWNER_CLERK_ID) gets
// full access to every feature at or above Pro Builder Beta level, with
// an effectively unlimited project limit for testing.
//
// Owner billing: the owner is `billing_exempt: true`. Usage is still
// metered (tokens, provider cost, model, BITS-calculated are recorded
// to llm_usage_records), but the wallet is NEVER debited and
// insufficient-BITS checks are skipped. A monthly provider-spend
// safety ceiling (default $250) protects against runaway spend.
//
// The owner can also simulate any customer tier (Starter, Creator, Pro,
// or Zero-BITS) for testing without modifying Stripe or the real
// subscription. The simulation is stored in a short-lived cookie that
// only affects entitlement resolution, never the subscription table.
// Simulations exercise REAL billing checks — the owner's billing_exempt
// flag is ignored when a non-owner simulation is active.

import "server-only";
import type { Entitlements } from "@/lib/entitlements";
import type { PlanId } from "@/config/plans";

// ─── Owner identification ───────────────────────────────────────────

/**
 * Env var storing the Clerk user ID of the platform owner.
 * Reuses LITTLABS_VAPI_OWNER_CLERK_ID (already set in production).
 */
export const OWNER_CLERK_ID_ENV = "LITTLABS_VAPI_OWNER_CLERK_ID";

/**
 * The owner is billing-exempt: usage is metered but the wallet is never
 * debited and insufficient-BITS checks are skipped. This is the canonical
 * owner entitlement — NOT a fake 999999 balance.
 */
export const OWNER_BILLING_EXEMPT = true;

/**
 * Monthly provider-spend safety ceiling for the owner (USD).
 * Prevents runaway spend if a loop goes wrong. Configurable via
 * OWNER_MONTHLY_SPEND_CEILING_USD env var.
 */
export const OWNER_SPEND_CEILING_USD = Number(
  process.env.OWNER_MONTHLY_SPEND_CEILING_USD ?? "250",
);

/** Cookie name for the active test-mode simulation. */
export const OWNER_TEST_MODE_COOKIE = "litt_test_mode";

/**
 * Returns the owner's Clerk user ID from env, or null if not configured.
 * Checks LITTLABS_VAPI_OWNER_CLERK_ID first, then ADMIN_CLERK_IDS (first entry).
 */
export function getOwnerClerkId(): string | null {
  const id = process.env[OWNER_CLERK_ID_ENV];
  if (id && id.length > 0) return id;
  const adminIds = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminIds[0] ?? null;
}

/**
 * Returns true if the given Clerk user ID is the platform owner.
 * Checks both LITTLABS_VAPI_OWNER_CLERK_ID and ADMIN_CLERK_IDS.
 */
export function isOwnerClerkId(clerkId: string | null | undefined): boolean {
  if (!clerkId) return false;
  // Check LITTLABS_VAPI_OWNER_CLERK_ID
  const ownerId = process.env[OWNER_CLERK_ID_ENV];
  if (ownerId && clerkId === ownerId) return true;
  // Check ADMIN_CLERK_IDS (comma-separated list)
  const adminIds = (process.env.ADMIN_CLERK_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return adminIds.includes(clerkId);
}

// ─── Simulation types ───────────────────────────────────────────────

/**
 * The set of tiers the owner can simulate.
 * - "owner"         — full owner access (no simulation)
 * - "starter"       — Starter limits
 * - "creator_beta"  — Creator Beta limits
 * - "pro_builder_beta" — Pro Builder Beta limits
 * - "zero_bits"     — Owner access but balance treated as 0
 */
export type SimulatedPlan =
  | "owner"
  | "starter"
  | "creator_beta"
  | "pro_builder_beta"
  | "zero_bits";

/** All valid simulation options, in display order. */
export const SIMULATION_OPTIONS: { value: SimulatedPlan; label: string; description: string }[] = [
  { value: "owner", label: "OWNER", description: "Full owner access — all features, unlimited projects" },
  { value: "starter", label: "Starter", description: "1 project, 500 LiTTBits, no terminal/voice/premium" },
  { value: "creator_beta", label: "Creator Beta", description: "5 projects, 6K LiTTBits, voice + GitHub" },
  { value: "pro_builder_beta", label: "Pro Builder Beta", description: "25 projects, 20K LiTTBits, terminal + premium models" },
  { value: "zero_bits", label: "Zero-BITS Test", description: "Owner access but balance treated as 0 — tests insufficient-credit behavior" },
];

export const VALID_SIMULATIONS: ReadonlySet<SimulatedPlan> = new Set(SIMULATION_OPTIONS.map((o) => o.value));

/**
 * Maps a SimulatedPlan to the PlanId it should emulate for entitlement
 * purposes. "owner" and "zero_bits" both map to "pro_builder_beta" as
 * the base, with overrides applied separately.
 */
export function simulationToPlanId(sim: SimulatedPlan): PlanId {
  switch (sim) {
    case "starter":
      return "starter";
    case "creator_beta":
      return "creator_beta";
    case "pro_builder_beta":
      return "pro_builder_beta";
    case "owner":
    case "zero_bits":
      return "owner";
  }
}

// ─── Owner entitlements ─────────────────────────────────────────────

/**
 * The owner's real entitlements — at or above Pro Builder Beta, with
 * effectively unlimited project limit. All features enabled.
 *
 * `monthlyCredits` is 0 because the owner is `billing_exempt` — the
 * wallet is never checked or debited. Display "DEV ∞" instead of a
 * numeric balance.
 */
export const OWNER_ENTITLEMENTS: Entitlements = {
  planId: "owner",
  planName: "OWNER",
  activeProjectLimit: 999_999,
  monthlyCredits: 0, // billing_exempt — wallet not used
  privateProjects: true,
  github: true,
  terminal: true,
  voice: true,
  premiumModels: true,
  deployment: true,
  maxMissionSteps: 999,
  maxUploadBytes: 100_000_000,
  beta: true,
  founder: true,
};

// ─── Billing exemption ──────────────────────────────────────────────

/**
 * Returns true if the given Clerk user ID is the platform owner AND
 * billing-exempt for this request.
 *
 * The owner is billing-exempt (usage metered, wallet never debited,
 * insufficient-BITS checks skipped) UNLESS they are actively simulating
 * a customer tier (starter, creator_beta, pro_builder_beta, or
 * zero_bits). When simulating, the owner exercises the REAL billing
 * path so the simulation is meaningful.
 *
 * `simulation` is the active simulation (from getActiveSimulation or
 * passed explicitly for tests). When omitted, this function returns
 * true for any owner — callers that need simulation-aware exemption
 * should pass the resolved simulation.
 */
export function isBillingExempt(
  clerkId: string | null | undefined,
  simulation?: SimulatedPlan | null,
): boolean {
  if (!isOwnerClerkId(clerkId)) return false;
  // No simulation or "owner" simulation → billing-exempt
  if (!simulation || simulation === "owner") return true;
  // Simulating a customer tier or zero_bits → NOT exempt (real billing)
  return false;
}

// ─── Simulation cookie reader ───────────────────────────────────────

/**
 * Reads the active simulation from the request cookie.
 *
 * Uses next/headers cookies() which is only available inside App Router
 * request contexts (server components, API routes, route handlers).
 * Returns null if cookies are unavailable (e.g. background jobs, tests)
 * or if the cookie value is not a valid simulation.
 *
 * This is async because Next.js 16 cookies() is async.
 */
export async function getActiveSimulation(): Promise<SimulatedPlan | null> {
  try {
    // Dynamic import so tests that don't have next/headers can still
    // import the pure functions from this module.
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const value = cookieStore.get(OWNER_TEST_MODE_COOKIE)?.value;
    if (value && VALID_SIMULATIONS.has(value as SimulatedPlan)) {
      return value as SimulatedPlan;
    }
    return null;
  } catch {
    // Not in a request context — no simulation active.
    return null;
  }
}
