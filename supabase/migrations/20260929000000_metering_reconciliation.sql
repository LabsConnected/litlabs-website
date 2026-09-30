-- Canonical metering reconciliation (P0) — READ-ONLY reporting view.
--
-- P0 invariant (Larry): per logical user action there are N cost_events
-- (one per provider attempt — retries/failovers count) but exactly ONE
-- billable usage_event (billable=true). Failed attempts: billable=false.
--
-- This view therefore distinguishes:
--   * LiTT's REAL cost  → SUM over cost_events (ALL attempts, billable or not)
--   * Customer consumption → COUNT/SUM over billable usage_events only,
--     with charged bits joined from credit_ledger via usage_event_id
--   * P0 violation check → per original_request_id, billable_count must be
--     <= 1; violating logical actions are counted in multi_billable_actions
--
-- Grain: one row per UTC day × plan × capability.
--
-- Money labeling: margin_micros_modeled values the charged bits at the
-- $1/1K-bit PRICING MODEL (1 bit = 1000 micros). That conversion is a
-- pricing model, NOT validated fact — labeled `modeled` everywhere.
--
-- Defensive: every join is a LEFT JOIN with COALESCE defaults, so missing
-- subscriptions / cost rows / ledger rows degrade to zeros, never to
-- dropped rows. Plan falls back to 'starter' when no active/trialing
-- subscription exists.
--
-- NOTE: this migration is written but NOT applied by the metering P0 —
-- the coordinator owns migration sequencing. It is idempotent
-- (CREATE OR REPLACE VIEW).

CREATE OR REPLACE VIEW public.metering_daily_reconciliation AS
WITH user_plans AS (
  -- Latest active/trialing subscription per user. The production
  -- subscriptions table keys the plan in `plan` (not `plan_id`) with
  -- unique(user_id); DISTINCT ON keeps this correct even if that
  -- constraint ever relaxes.
  SELECT DISTINCT ON (s.user_id)
    s.user_id,
    COALESCE(NULLIF(s.plan, ''), 'starter') AS plan
  FROM public.subscriptions s
  WHERE s.status IN ('active', 'trialing')
  ORDER BY s.user_id, s.updated_at DESC NULLS LAST, s.created_at DESC
),
event_cost AS (
  -- Pre-aggregate per usage event to avoid join fanout when a usage event
  -- carries more than one cost row.
  SELECT
    usage_event_id,
    COALESCE(SUM(provider_cost_micros), 0)::BIGINT AS provider_cost_micros,
    COUNT(*) AS cost_event_count
  FROM public.cost_events
  GROUP BY usage_event_id
),
event_charges AS (
  -- Ledger debits linked to a usage event (stamped via usage_event_id).
  -- Debits are the charges; credits (grants/refunds) are excluded.
  SELECT
    usage_event_id,
    COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE 0 END), 0)::BIGINT AS charged_bits,
    COUNT(*) FILTER (WHERE direction = 'debit') AS charge_rows
  FROM public.credit_ledger
  WHERE usage_event_id IS NOT NULL
  GROUP BY usage_event_id
),
violations AS (
  -- P0 invariant check: per logical action (original_request_id) at most
  -- ONE billable usage_event. Counts the violating actions per
  -- day × plan × capability so the report flags double-billing bugs.
  SELECT day, plan, capability, COUNT(*)::BIGINT AS multi_billable_actions
  FROM (
    SELECT
      (ue.created_at AT TIME ZONE 'UTC')::DATE AS day,
      COALESCE(up.plan, 'starter') AS plan,
      ue.capability,
      ue.original_request_id
    FROM public.usage_events ue
    LEFT JOIN user_plans up ON up.user_id = ue.user_id
    WHERE ue.billable = TRUE
      AND ue.original_request_id IS NOT NULL
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) > 1
  ) d
  GROUP BY 1, 2, 3
)
SELECT
  (ue.created_at AT TIME ZONE 'UTC')::DATE AS day,
  COALESCE(up.plan, 'starter') AS plan,
  ue.capability,
  -- Volume
  COUNT(*)::BIGINT AS usage_events,
  COUNT(*) FILTER (WHERE ue.billable)::BIGINT AS billable_usage_events,
  COALESCE(SUM(ec.cost_event_count), 0)::BIGINT AS cost_events,
  -- LiTT's real cost: every provider attempt, billable or not.
  COALESCE(SUM(ec.provider_cost_micros), 0)::BIGINT AS provider_cost_micros,
  -- Customer consumption: charged bits behind billable events only.
  COALESCE(SUM(
    CASE WHEN ue.billable THEN COALESCE(ech.charged_bits, 0) ELSE 0 END
  ), 0)::BIGINT AS charged_bits,
  -- Margin, MODELED at $1/1K bits (1 bit = 1000 micros) — pricing model,
  -- not validated fact.
  (
    COALESCE(SUM(
      CASE WHEN ue.billable THEN COALESCE(ech.charged_bits, 0) ELSE 0 END
    ), 0) * 1000
    - COALESCE(SUM(ec.provider_cost_micros), 0)
  )::BIGINT AS margin_micros_modeled,
  -- P0 invariant violations in this bucket (0 = healthy).
  COALESCE(v.multi_billable_actions, 0)::BIGINT AS multi_billable_actions
FROM public.usage_events ue
LEFT JOIN user_plans up ON up.user_id = ue.user_id
LEFT JOIN event_cost ec ON ec.usage_event_id = ue.usage_event_id
LEFT JOIN event_charges ech ON ech.usage_event_id = ue.usage_event_id
LEFT JOIN violations v
  ON v.day = (ue.created_at AT TIME ZONE 'UTC')::DATE
  AND v.plan = COALESCE(up.plan, 'starter')
  AND v.capability = ue.capability
GROUP BY 1, 2, 3, v.multi_billable_actions;

COMMENT ON VIEW public.metering_daily_reconciliation IS
  'P0 canonical metering reconciliation: per UTC day x plan x capability — '
  'provider_cost_micros sums cost_events (LiTT real cost, all attempts); '
  'charged_bits sums credit_ledger debits behind billable usage_events only '
  '(customer consumption); multi_billable_actions counts logical actions '
  '(original_request_id) with >1 billable usage_event (P0 invariant '
  'violation). margin_micros_modeled values bits at the $1/1K-bit PRICING '
  'MODEL — modeled, not validated fact.';
