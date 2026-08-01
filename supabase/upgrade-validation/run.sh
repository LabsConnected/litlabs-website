#!/usr/bin/env bash
# =============================================================================
# Production-style migration upgrade validation
# =============================================================================
# Validates the REAL upgrade path for the forward migration
# 20260801000000_create_agent_system_notifications.sql on top of a pre-forward
# database. This is NOT a pgTAP test and is NOT run by `supabase test db`.
#
# Flow (must pass WITHOUT repairing migration history — a validation test must
# not repair its own migration history to pass):
#   1. Reset to 20260728220000 (migration immediately before the forward one)
#   2. Run preconditions (assert pre-forward state + insert sentinel row)
#   3. Verify only the forward migration is pending
#   4. Apply the forward migration via `supabase migration up`
#   5. Run postconditions (table exists, sentinel survived, schema intact)
#   6. Re-run the ENTIRE forward migration SQL with ON_ERROR_STOP=1 (idempotency)
#   7. Run postconditions again (proves idempotency didn't break anything)
#   8. Cleanup sentinel data
#
# Exits non-zero on any failure. Designed to run inside the
# "Production-style migration upgrade" GitHub Actions job, which starts
# `supabase start` before invoking this script and stops it afterwards.
# =============================================================================
set -euo pipefail

RESET_VERSION="20260728220000"
FORWARD_VERSION="20260801000000"
FORWARD_MIGRATION="supabase/migrations/${FORWARD_VERSION}_create_agent_system_notifications.sql"
PRECONDITIONS="supabase/upgrade-validation/preconditions.sql"
POSTCONDITIONS="supabase/upgrade-validation/postconditions.sql"

# -----------------------------------------------------------------------------
# Discover the local Supabase Postgres container name (derived from project_id
# in supabase/config.toml, but discovered dynamically for robustness).
# -----------------------------------------------------------------------------
DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n1 || true)"
if [ -z "${DB_CONTAINER}" ]; then
  echo "FAIL: no running supabase_db_* container found. Run 'supabase start' first." >&2
  exit 1
fi
echo "Using Postgres container: ${DB_CONTAINER}"

psql_exec() {
  # Stream SQL from stdin into the local Postgres container, hard-failing on error.
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  # Print a single scalar value (no headers, no alignment).
  docker exec "${DB_CONTAINER}" psql -U postgres -d postgres -t -A -v ON_ERROR_STOP=1 -c "$1"
}

step() {
  echo
  echo "==================================================================="
  echo "  $1"
  echo "==================================================================="
}

# -----------------------------------------------------------------------------
# Step 1: Reset to the migration immediately before the forward migration.
# -----------------------------------------------------------------------------
step "Step 1: Reset local DB to version ${RESET_VERSION}"
npx supabase db reset --local --no-seed --version "${RESET_VERSION}"

# -----------------------------------------------------------------------------
# Step 2: Run preconditions (assert pre-forward state + insert sentinel).
# -----------------------------------------------------------------------------
step "Step 2: Run preconditions"
psql_exec < "${PRECONDITIONS}"

# -----------------------------------------------------------------------------
# Step 3: Verify ONLY the forward migration is pending.
#         (a) No migration newer than RESET_VERSION is recorded as applied.
#         (b) The forward migration is NOT yet in the migration history.
#         (c) Exactly one migration file on disk is newer than RESET_VERSION.
# -----------------------------------------------------------------------------
step "Step 3: Verify only the forward migration is pending"

NEWER_FILES="$(ls supabase/migrations/*.sql | awk -F/ '{print $NF}' \
  | awk -F_ '{if ($1 > "'${RESET_VERSION}'") print}' || true)"
NEWER_COUNT="$(printf '%s\n' "${NEWER_FILES}" | grep -c . || true)"
if [ "${NEWER_COUNT}" -ne 1 ]; then
  echo "FAIL: expected exactly 1 migration file newer than ${RESET_VERSION}, found ${NEWER_COUNT}:" >&2
  printf '%s\n' "${NEWER_FILES}" >&2
  exit 1
fi
echo "OK: exactly 1 migration file newer than ${RESET_VERSION} -> $(printf '%s' "${NEWER_FILES}")"

FORWARD_APPLIED="$(psql_scalar \
  "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${FORWARD_VERSION}';")"
if [ "${FORWARD_APPLIED}" != "0" ]; then
  echo "FAIL: forward migration ${FORWARD_VERSION} already recorded as applied (count=${FORWARD_APPLIED}) before 'migration up'" >&2
  exit 1
fi
echo "OK: forward migration ${FORWARD_VERSION} is pending (not yet applied)"

# -----------------------------------------------------------------------------
# Step 4: Apply the forward migration (and any other pending migrations).
#         --include-all applies migrations absent from the remote history table,
#         which is the production-style upgrade path.
# -----------------------------------------------------------------------------
step "Step 4: Apply pending migrations (supabase migration up --local --include-all)"
npx supabase migration up --local --include-all

# Confirm the forward migration is now recorded as applied.
FORWARD_APPLIED="$(psql_scalar \
  "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${FORWARD_VERSION}';")"
if [ "${FORWARD_APPLIED}" != "1" ]; then
  echo "FAIL: forward migration ${FORWARD_VERSION} not recorded as applied after 'migration up' (count=${FORWARD_APPLIED})" >&2
  exit 1
fi
echo "OK: forward migration ${FORWARD_VERSION} recorded as applied"

# -----------------------------------------------------------------------------
# Step 5: Run postconditions (table exists, sentinel survived, schema intact).
# -----------------------------------------------------------------------------
step "Step 5: Run postconditions (after upgrade)"
psql_exec < "${POSTCONDITIONS}"

# -----------------------------------------------------------------------------
# Step 6: Re-run the ENTIRE forward migration SQL with ON_ERROR_STOP=1.
#         This proves the migration is idempotent — safe to re-apply on a
#         database where it has already run (e.g. a repaired/replayed prod DB).
# -----------------------------------------------------------------------------
step "Step 6: Re-run entire forward migration SQL (idempotency, ON_ERROR_STOP=1)"
psql_exec < "${FORWARD_MIGRATION}"
echo "OK: idempotency re-run succeeded (exit 0)"

# -----------------------------------------------------------------------------
# Step 7: Run postconditions again (idempotency didn't break anything).
# -----------------------------------------------------------------------------
step "Step 7: Run postconditions again (after idempotency re-run)"
psql_exec < "${POSTCONDITIONS}"

# -----------------------------------------------------------------------------
# Step 8: Cleanup sentinel data.
# -----------------------------------------------------------------------------
step "Step 8: Cleanup sentinel data"
psql_exec <<'SQL'
DELETE FROM public.notifications WHERE content = 'SENTINEL_UPGRADE_TEST_ROW';
DELETE FROM public.users WHERE clerk_id = 'sentinel_upgrade_test';
SQL
echo "OK: sentinel data removed"

echo
echo "==================================================================="
echo "  ALL UPGRADE-VALIDATION STEPS PASSED"
echo "==================================================================="
