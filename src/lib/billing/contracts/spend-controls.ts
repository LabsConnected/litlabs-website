/**
 * Canonical spend control / budget contracts.
 *
 * Enforcement must occur during reservation, not merely in React/localStorage.
 *
 * Current state: budget limits exist only in UI/settings (localStorage).
 * These contracts define what server-side enforcement should look like.
 * B1 defines the contracts; enforcement implementation is a later phase.
 */

import type { Bits } from "./monetary";

// ── Budget scope ───────────────────────────────────────────────────────

/**
 * The scope at which a budget applies.
 */
export type BudgetScope =
  /** Per single request/run. */
  | "per_request"
  /** Per day (rolling 24h or calendar day). */
  | "daily"
  /** Per month (billing cycle or calendar month). */
  | "monthly"
  /** Per agent/run configuration. */
  | "per_agent"
  /** Per organization. */
  | "organization"
  /** Per project. */
  | "project"
  /** Per API key. */
  | "api_key"
  /** Per model. */
  | "per_model"
  /** Per automation/work queue. */
  | "automation";

// ── Budget policy ──────────────────────────────────────────────────────

/**
 * What happens when a budget limit is reached.
 */
export type BudgetEnforcement =
  /** Hard stop — reject the request. */
  | "hard_stop"
  /** Soft warning — allow but notify. */
  | "soft_warning"
  /** Auto-top-up — trigger a purchase before rejecting. */
  | "auto_topup";

/**
 * A spend control / budget definition.
 */
export interface SpendControl {
  /** Unique ID. */
  id: string;
  /** User/account ID (null = platform-wide default). */
  userId: string | null;
  /** Scope of this budget. */
  scope: BudgetScope;
  /** Maximum BITS spendable within this scope's window. */
  maxBits: Bits;
  /** Enforcement behavior when limit is reached. */
  enforcement: BudgetEnforcement;
  /** Window in seconds (null = lifetime for per_request, 86400 for daily, etc.). */
  windowSeconds: number | null;
  /** Optional: restrict to a specific agent ID. */
  agentId: string | null;
  /** Optional: restrict to a specific model. */
  model: string | null;
  /** Optional: restrict to a specific project ID. */
  projectId: string | null;
  /** Optional: restrict to a specific API key ID. */
  apiKeyId: string | null;
  /** Whether this control is active. */
  active: boolean;
  /** Creation timestamp. */
  createdAt: string;
  /** Last updated timestamp. */
  updatedAt: string;
}

// ── Budget check result ────────────────────────────────────────────────

/**
 * Result of checking spend controls before a reservation.
 */
export interface BudgetCheckResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Which budget was violated (null if allowed). */
  violatedControlId: string | null;
  /** Which scope was violated. */
  violatedScope: BudgetScope | null;
  /** Current spend within the violated window. */
  currentSpend: Bits;
  /** The limit that was exceeded. */
  limit: Bits;
  /** The estimated request cost that triggered the check. */
  estimatedCost: Bits;
  /** Remaining budget within the window. */
  remaining: Bits;
  /** Enforcement action taken. */
  enforcement: BudgetEnforcement;
  /** Human-readable reason. */
  reason: string;
}

// ── Spend snapshot ─────────────────────────────────────────────────────

/**
 * A snapshot of current spend across all scopes for a user.
 * Used for UI display and budget enforcement checks.
 */
export interface SpendSnapshot {
  userId: string;
  /** Current spend in the current calendar day. */
  dailySpend: Bits;
  /** Current spend in the current billing cycle. */
  monthlySpend: Bits;
  /** Spend per agent (agentId → spend). */
  perAgent: Record<string, Bits>;
  /** Spend per model (model → spend). */
  perModel: Record<string, Bits>;
  /** Spend per project (projectId → spend). */
  perProject: Record<string, Bits>;
  /** Spend per API key (keyId → spend). */
  perApiKey: Record<string, Bits>;
  /** Currently held in pending reservations. */
  currentlyHeld: Bits;
  /** Timestamp of this snapshot. */
  snapshotAt: string;
}

// ── Low balance alert ──────────────────────────────────────────────────

/**
 * Low balance alert configuration.
 */
export interface LowBalanceAlert {
  /** Unique ID. */
  id: string;
  /** User/account ID. */
  userId: string;
  /** Threshold in BITS below which to alert. */
  thresholdBits: Bits;
  /** Whether to send an email notification. */
  notifyEmail: boolean;
  /** Whether to send an in-app notification. */
  notifyInApp: boolean;
  /** Whether to auto-trigger a top-up purchase. */
  autoTopup: boolean;
  /** Top-up amount in BITS (if autoTopup is true). */
  autoTopupAmount: Bits | null;
  /** Whether this alert is active. */
  active: boolean;
}

// ── Existing budget columns (EXISTS but UNUSED) ────────────────────────

/**
 * The following columns already exist in the database but are NOT enforced:
 *
 * user_agents.daily_budget_credits     INTEGER NOT NULL DEFAULT 0
 * user_agents.per_run_budget_credits   INTEGER NOT NULL DEFAULT 0
 * agent_work_queue.cost_cap_credits    INTEGER NOT NULL DEFAULT 100
 * agent_work_queue.credits_spent       INTEGER NOT NULL DEFAULT 0
 *
 * B1 defines the contracts. Enforcement implementation is a later phase.
 * These existing columns should eventually be replaced by SpendControl records.
 */
export const EXISTING_BUDGET_COLUMNS = {
  user_agents: ["daily_budget_credits", "per_run_budget_credits"],
  agent_work_queue: ["cost_cap_credits", "credits_spent"],
} as const;

// ── Existing UI-only budgets (NOT enforced) ────────────────────────────

/**
 * The following budget settings exist only in the UI (localStorage):
 *
 * src/app/settings/page.tsx (lines 1373-1452):
 *   - Daily spend limit (in dollars)
 *   - Monthly spend limit (in dollars)
 *   - Budget notification toggle
 *
 * These are NOT validated or enforced server-side.
 * B1 defines the server-side contracts. Migration of UI settings
 * to server-enforced SpendControl records is a later phase.
 */
export const EXISTING_UI_ONLY_BUDGETS = {
  file: "src/app/settings/page.tsx",
  lines: "1373-1452",
  storage: "localStorage (client-side only)",
  enforced: false,
} as const;
