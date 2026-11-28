-- ============================================================
-- Publication integrity: per-publish verification token.
--
-- The deploy service verifies a deployment's live URL BEFORE marking
-- it ready. The serving read only answers `ready` deployments, so
-- verification used to require flipping the row to `ready` first —
-- publicly serving unverified content, and letting one transient
-- verification fetch permanently fail the deployment (2026-09-13).
--
-- verification_token breaks that circle: a fresh random token is
-- minted per publish and stored on the row; while the deployment is
-- `deploying`, the serving read answers ONLY requests carrying that
-- deployment's token. The row flips to `ready` only after artifact
-- read-back and the token-gated serving check both pass.
--
-- Nullable and additive: older rows leave it null (the gate never
-- opens for them). The deployment store tolerates the column being
-- absent (create retries without it; the serving read falls back to
-- the ready-only select), so code and migration can land in either
-- order.
-- ============================================================

ALTER TABLE public.user_project_deployments
  ADD COLUMN IF NOT EXISTS verification_token text;
