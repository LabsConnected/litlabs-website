#!/usr/bin/env bash
# Print the billing migration order and, when a database URL is set,
# run the read-only preflight. This script does not apply migrations.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$ROOT/scripts/billing-migration-precheck.sql"

cat <<'EOF'
Billing migrations run before the application code.

Order:
  1. supabase/migrations/20261014000000_subscriptions_stripe_subscription_id_unique.sql
  2. supabase/migrations/20261015000000_subscriptions_cancel_at_period_end.sql
  3. supabase/migrations/20261015120000_media_cap_holds.sql

Rollback, after the matching code is reverted:
  20261014000000: DROP INDEX IF EXISTS public.subscriptions_stripe_subscription_id_uidx;
  20261015000000: ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;
                  (leave current_period_end; it predated the migration)
  20261015120000: DROP FUNCTION public.release_media_cap_hold(uuid, text);
                  DROP FUNCTION public.claim_media_cap_slot(uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz);
                  DROP FUNCTION public.media_job_is_free(text, text, integer);
                  DROP TABLE public.media_cap_holds;
EOF

if [[ "${1:-}" == "--print" ]]; then
  exit 0
fi

DB_URL="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo "preflight queries not executed: set DATABASE_URL or pass --print" >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL"
echo "preflight ok"
