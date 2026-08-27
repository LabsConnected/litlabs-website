-- ============================================
-- User Deletion Lifecycle Support
--
-- Adds `deleted_at` column to users table for anonymization-based
-- account deletion (GDPR right-to-erasure compatible).
--
-- Strategy: anonymize PII + purge user content + retain billing/legal records.
-- The users row is KEPT (anonymized) to preserve FK integrity for:
--   - credit_reservations (RESTRICT, no CASCADE)
--   - tool_executions.approved_by (RESTRICT, no CASCADE)
--   - transactions (financial history)
--   - subscriptions (Stripe records)
--   - creator_earnings (financial)
--   - credit_ledger (financial ledger)
--   - audit_events (compliance)
--
-- Safe to re-run (IF NOT EXISTS).
-- ============================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index for quickly finding active (non-deleted) users
CREATE INDEX IF NOT EXISTS idx_users_deleted_at
  ON public.users(deleted_at)
  WHERE deleted_at IS NOT NULL;
