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
  4. supabase/migrations/20261015140000_subscriptions_last_stripe_event_created.sql
  5. supabase/migrations/20261015160000_checkout_reservations.sql
  6. supabase/migrations/20261015170000_billing_subscription_conflicts.sql
  7. supabase/migrations/20261015180000_media_cap_hold_expiry.sql

Rollback, after the matching code is reverted:
  20261014000000: DROP INDEX IF EXISTS public.subscriptions_stripe_subscription_id_uidx;
  20261015000000: ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;
                  (leave current_period_end; it predated the migration)
  20261015120000: DROP FUNCTION public.release_media_cap_hold(uuid, text);
                  DROP FUNCTION public.claim_media_cap_slot(uuid, text, text, text, text, integer, boolean, boolean, integer, integer, integer, integer, integer, timestamptz);
                  DROP FUNCTION public.media_job_is_free(text, text, integer);
                  DROP TABLE public.media_cap_holds;
  20261015140000: ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS last_stripe_event_created;
  20261015160000: DROP FUNCTION public.abort_checkout_reservation(text, uuid);
                  DROP FUNCTION public.commit_checkout_reservation(text, uuid, text, text, timestamptz);
                  DROP FUNCTION public.begin_checkout_reservation(text, uuid, text, text, timestamptz, integer);
                  DROP TABLE public.checkout_reservations;
  20261015170000: DROP TABLE public.billing_subscription_conflicts;
  20261015180000: DROP FUNCTION public.sweep_expired_media_cap_holds(timestamptz, interval);
                  DROP FUNCTION public.settle_media_cap_hold(uuid, text, timestamptz);
                  ALTER TABLE public.media_cap_holds DROP COLUMN IF EXISTS settled_at;
                  Restore claim_media_cap_slot from 20261015120000_media_cap_holds.sql.
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
