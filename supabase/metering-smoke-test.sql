-- Canonical metering P0 — production smoke test (SELECT-only, read-only).
-- Run in the Supabase dashboard SQL editor after the metering PR deploys.
-- Proves: (1) usage_events rows land, (2) cost_events rows land,
-- (3) the P0 no-double-billing invariant holds (≤1 billable usage_event
-- per logical action even when retries/failovers occurred).

-- ── 1. usage_events landing (last 24h) ──────────────────────────────
SELECT
  COUNT(*) AS usage_events_24h,
  COUNT(*) FILTER (WHERE billable) AS billable_events,
  COUNT(DISTINCT original_request_id) FILTER (WHERE original_request_id IS NOT NULL) AS logical_actions,
  COUNT(DISTINCT provider) AS providers_seen,
  COUNT(DISTINCT capability) AS capabilities_seen
FROM public.usage_events
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- ── 2. cost_events landing (last 24h) ────────────────────────────────
SELECT
  COUNT(*) AS cost_events_24h,
  ROUND((SUM(provider_cost_micros) / 1000000.0)::numeric, 4) AS litt_cost_usd_24h,
  COUNT(DISTINCT usage_event_id) AS distinct_usage_events
FROM public.cost_events
WHERE created_at >= NOW() - INTERVAL '24 hours';

-- ── 3. P0 invariant: ≤1 billable usage_event per logical action ──────
-- Must return ZERO rows. Any row = a double-billing violation.
SELECT
  u.original_request_id,
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE u.billable) AS billable_events,
  ROUND((SUM(c.provider_cost_micros) / 1000000.0)::numeric, 4) AS litt_cost_usd
FROM public.usage_events u
LEFT JOIN public.cost_events c ON c.usage_event_id = u.usage_event_id
WHERE u.created_at >= NOW() - INTERVAL '24 hours'
  AND u.original_request_id IS NOT NULL
GROUP BY u.original_request_id
HAVING COUNT(*) FILTER (WHERE u.billable) > 1
ORDER BY attempts DESC
LIMIT 20;

-- ── 4. Retry/failover cost visibility (informational) ────────────────
-- Shows logical actions where LiTT incurred retry cost: attempts > 1.
SELECT
  u.original_request_id,
  u.feature AS sample_feature,
  COUNT(*) AS attempts,
  COUNT(*) FILTER (WHERE u.billable) AS billable_events,
  ROUND((SUM(c.provider_cost_micros) / 1000000.0)::numeric, 4) AS litt_cost_usd,
  SUM(CASE WHEN u.billable THEN 1 ELSE 0 END) AS customer_charges
FROM public.usage_events u
LEFT JOIN public.cost_events c ON c.usage_event_id = u.usage_event_id
WHERE u.created_at >= NOW() - INTERVAL '24 hours'
  AND u.original_request_id IS NOT NULL
GROUP BY u.original_request_id, u.feature
HAVING COUNT(*) > 1
ORDER BY SUM(c.provider_cost_micros) DESC NULLS LAST
LIMIT 20;

-- ── 5. Coverage by feature/capability (last 24h) ─────────────────────
SELECT
  split_part(billability_cause, ':', 2) AS feature,
  capability,
  COUNT(*) AS events,
  COUNT(*) FILTER (WHERE billable) AS billable,
  ROUND((SUM(input_tokens))::numeric, 0) AS input_tokens,
  ROUND((SUM(output_tokens))::numeric, 0) AS output_tokens
FROM public.usage_events
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY 1, 2
ORDER BY events DESC;
