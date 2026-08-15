/**
 * Canonical billing contracts — barrel export.
 *
 * This is the single source of truth for LiTT billing vocabulary.
 * All billing-related code should import from here, not from
 * individual files or legacy type definitions.
 *
 * B1 defines contracts only. No runtime behavior is changed.
 */

// ── Monetary unit system ──
export type {
  UsdMicros,
  Bits,
  BasisPoints,
  ExchangeRateVersion,
  CostComponents,
} from "./monetary";

export {
  usdMicrosToBits,
  bitsToUsdMicros,
  fullyLoadedCostMicros,
  applyMargin,
  realizedMarginBps,
  LEGACY_EXCHANGE_RATES,
  EXCHANGE_RATE_DISCREPANCY,
} from "./monetary";

// ── Ledger entry types and reservation lifecycle ──
export type {
  LedgerEntryType,
  CreditBucket,
  LedgerEntry,
  ReservationStatus,
  Reservation,
  BalanceProjection,
  LedgerMutationRequest,
  LedgerMutationResult,
} from "./ledger";

export {
  validateAccountingInvariant,
  validateAvailableBalance,
  CATEGORY_TO_ENTRY_TYPE,
  ENTRY_TYPE_TO_CATEGORY,
} from "./ledger";

// ── Reservation calculator (pure functions) ──
export {
  projectBalance,
  simulateReservation,
  simulateSettlement,
  simulateRelease,
  simulateConcurrentReservationsUnsafe,
  simulateConcurrentReservationsSafe,
} from "./reservation-calculator";

// ── Billability classification ──
export type {
  BillabilityCause,
  BillabilityDecision,
} from "./billability";

export {
  isBillable,
  isLiittAbsorbed,
  shouldMeterProviderCost,
  createBillabilityDecision,
} from "./billability";

// ── Pricing versioning ──
export type {
  PricingVersion,
  PricingUnit,
  PricingCatalogEntry,
  RatingResult,
} from "./pricing";

export { LEGACY_CATALOGS } from "./pricing";

// ── Spend controls / budgets ──
export type {
  BudgetScope,
  BudgetEnforcement,
  SpendControl,
  BudgetCheckResult,
  SpendSnapshot,
  LowBalanceAlert,
} from "./spend-controls";

export {
  EXISTING_BUDGET_COLUMNS,
  EXISTING_UI_ONLY_BUDGETS,
} from "./spend-controls";

// ── Unified UsageEvent ──
export type {
  Capability,
  UsageEvent,
  CostEvent,
  RatingEvent,
  BillingCorrelation,
} from "./usage-event";

export { EXISTING_TABLE_MAPPING } from "./usage-event";
