#!/usr/bin/env bash
# Disposable Postgres + PostgREST for billing concurrency proofs.
#
# Docker (Windows or Linux; cygpath is optional):
#   billing-disposable-db.sh up   <path-to-supabase/migrations> [tag]
#   billing-disposable-db.sh down [tag]
#
# Safety: never touches the Supabase CLI stack (supabase_*_Prod, port 54321/54322).
# Postgres binds 127.0.0.1:55432, PostgREST 127.0.0.1:55431, data lives on tmpfs.
# PostgREST has no /rest/v1 prefix, so a tiny loopback proxy on :55321 adds it.
#
# Linux CI (GitHub service Postgres on 127.0.0.1:5432, no Docker images):
#   billing-disposable-db.sh
# Creates litlabs_billing and litlabs_billing_race, applies the billing
# migrations, and starts /tmp/postgrest plus scripts/rest-proxy.mjs.
set -euo pipefail
export MSYS_NO_PATHCONV=1

if [[ "${1:-}" == "up" || "${1:-}" == "down" ]]; then
  CMD="$1"
  if [[ "$CMD" == "up" ]]; then MIG="${2:?migrations dir}"; TAG="${3:-r1}"; else TAG="${2:-r1}"; fi
  NET="litt-billing-net-$TAG"; PG="litt-billing-pg-$TAG"; REST="litt-billing-rest-$TAG"
  SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
  IMAGE_PG="public.ecr.aws/supabase/postgres:17.6.1.156"
  IMAGE_REST="public.ecr.aws/supabase/postgrest:v14.15"

  if [[ "$CMD" == "down" ]]; then
    docker stop "$REST" "$PG" 2>/dev/null || true
    echo "stopped. remove with: docker rm $REST $PG && docker network rm $NET"
    exit 0
  fi

  docker network create "$NET" >/dev/null
  docker run -d --name "$PG" --network "$NET" -p 127.0.0.1:55432:5432 \
    --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=isolated-test-only "$IMAGE_PG" >/dev/null
  for _ in $(seq 1 60); do
    docker exec "$PG" psql -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1 && break
    sleep 2
  done

  # Stand-ins for objects the full Supabase stack (storage-api, gotrue) normally provides.
  docker exec "$PG" psql -U supabase_admin -d postgres -q -c "
    create schema if not exists storage;
    create table if not exists storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table if not exists storage.objects(id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid, metadata jsonb);
    alter table storage.objects enable row level security;
    grant all on all tables in schema storage to postgres;
    create or replace function auth.jwt() returns jsonb language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb \$\$;
    grant execute on all functions in schema auth to postgres, service_role, authenticated, anon;
    alter role authenticator with password 'isolated-test-only';" >/dev/null 2>&1

  if command -v cygpath >/dev/null 2>&1; then
    MIG_HOST="$(cygpath -w "$MIG")"
  else
    MIG_HOST="$MIG"
  fi
  docker cp "$MIG_HOST" "$PG:/tmp/mig"
  docker exec "$PG" bash -c 'cd /tmp/mig; n=0; for f in $(ls *.sql | sort); do
    out=$(psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f" 2>&1 >/dev/null) || { echo "MIGRATION FAILED: $f"; echo "$out" | grep -v NOTICE | head -4; exit 1; }
    n=$((n+1)); done; echo "migrations applied: $n of $(ls *.sql | wc -l)"'

  docker run -d --name "$REST" --network "$NET" -p 127.0.0.1:55431:3000 \
    -e PGRST_DB_URI="postgres://authenticator:isolated-test-only@$PG:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" "$IMAGE_REST" >/dev/null
  sleep 6
  cat <<EOT
READY (start the :55321 proxy separately: node rest-proxy.mjs)
  SUPABASE_DB_URL=postgresql://postgres:isolated-test-only@127.0.0.1:55432/postgres
  SUPABASE_LOCAL_API_URL=http://127.0.0.1:55321
  SUPABASE_JWT_SECRET=$SECRET
EOT
  exit 0
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ADMIN_URL="${BILLING_REPLAY_ADMIN_URL:-postgresql://litlabs_test:litlabs_test@127.0.0.1:5432/postgres}"
RACE_DB="${BILLING_DISPOSABLE_DB:-litlabs_billing_race}"
BILLING_DB="${BILLING_CONCURRENCY_DB:-litlabs_billing}"
POSTGREST_BIN="${POSTGREST_BIN:-/tmp/postgrest}"
JWT_SECRET="${SUPABASE_JWT_SECRET:-local-webhook-fixture-secret-not-a-credential}"
CONF="${BILLING_POSTGREST_CONF:-/tmp/billing-postgrest.conf}"

if [[ "$ADMIN_URL" =~ [Pp][Rr][Oo][Dd] || "$RACE_DB" =~ [Pp][Rr][Oo][Dd] || "$BILLING_DB" =~ [Pp][Rr][Oo][Dd] ]]; then
  echo "refusing a prod-named database" >&2
  exit 1
fi
if [[ ! "$RACE_DB" =~ ^[a-z_]+$ || ! "$BILLING_DB" =~ ^[a-z_]+$ ]]; then
  echo "database names must be lowercase identifiers" >&2
  exit 1
fi

sql_path() {
  local file="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$file"
  else
    printf '%s\n' "$file"
  fi
}

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 <<EOT
DO \$roles\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'litlabs_test';
  END IF;
END
\$roles\$;
ALTER ROLE service_role NOLOGIN BYPASSRLS;
ALTER ROLE authenticator NOINHERIT LOGIN PASSWORD 'litlabs_test';
GRANT anon, authenticated, service_role TO authenticator;
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname IN ('${RACE_DB}', '${BILLING_DB}') AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${RACE_DB};
DROP DATABASE IF EXISTS ${BILLING_DB};
CREATE DATABASE ${RACE_DB};
CREATE DATABASE ${BILLING_DB};
EOT

admin_base="${ADMIN_URL%/*}"
RACE_URL="${admin_base}/${RACE_DB}"
BILLING_URL="${admin_base}/${BILLING_DB}"

psql "$BILLING_URL" -v ON_ERROR_STOP=1 <<EOT
CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  clerk_id text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL
);
CREATE TABLE public.subscriptions (
  user_id uuid PRIMARY KEY,
  status text,
  stripe_subscription_id text,
  stripe_customer_id text
);
CREATE TABLE public.generation_jobs (
  id uuid PRIMARY KEY,
  user_id uuid,
  request_id text,
  created_at timestamptz,
  status text,
  refund_status text,
  provider text,
  model text,
  modality text,
  actual_provider_cost_cents integer,
  prompt text NOT NULL
);
EOT

psql "$RACE_URL" -v ON_ERROR_STOP=1 <<EOT
CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id text UNIQUE NOT NULL,
  email text UNIQUE NOT NULL,
  name text
);
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text,
  status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.wallets (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0
);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
EOT

migrations=(
  "supabase/migrations/20260725000000_credit_ledger_beta_pricing.sql"
  "supabase/migrations/20260726193000_unify_litbits_ledger.sql"
  "supabase/migrations/20261014000000_subscriptions_stripe_subscription_id_unique.sql"
  "supabase/migrations/20261015000000_subscriptions_cancel_at_period_end.sql"
  "supabase/migrations/20261015120000_media_cap_holds.sql"
  "supabase/migrations/20261015140000_subscriptions_last_stripe_event_created.sql"
  "supabase/migrations/20261015160000_checkout_reservations.sql"
  "supabase/migrations/20261015170000_billing_subscription_conflicts.sql"
  "supabase/migrations/20261015180000_media_cap_hold_expiry.sql"
  "supabase/migrations/20261015200000_apply_subscription_event.sql"
  "supabase/migrations/20261015210000_checkout_session_lease.sql"
  "supabase/migrations/20261015220000_schedule_media_cap_sweep.sql"
)

for mig in "${migrations[@]}"; do
  psql "$RACE_URL" -v ON_ERROR_STOP=1 -f "$(sql_path "$ROOT/$mig")"
done

psql "$RACE_URL" -v ON_ERROR_STOP=1 <<EOT
GRANT USAGE ON SCHEMA public TO authenticator, anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
NOTIFY pgrst, 'reload schema';
EOT

if [[ ! -x "$POSTGREST_BIN" ]]; then
  echo "PostgREST binary is missing at $POSTGREST_BIN" >&2
  exit 1
fi

cat > "$CONF" <<EOT
db-uri = "postgres://authenticator:litlabs_test@127.0.0.1:5432/${RACE_DB}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "${JWT_SECRET}"
server-host = "127.0.0.1"
server-port = 55431
EOT

if [[ -f /tmp/billing-postgrest.pid ]]; then
  kill "$(cat /tmp/billing-postgrest.pid)" >/dev/null 2>&1 || true
  rm -f /tmp/billing-postgrest.pid
fi
if [[ -f /tmp/billing-rest-proxy.pid ]]; then
  kill "$(cat /tmp/billing-rest-proxy.pid)" >/dev/null 2>&1 || true
  rm -f /tmp/billing-rest-proxy.pid
fi

nohup "$POSTGREST_BIN" "$CONF" > /tmp/billing-postgrest.log 2>&1 &
echo $! > /tmp/billing-postgrest.pid
nohup node "$ROOT/scripts/rest-proxy.mjs" > /tmp/billing-rest-proxy.log 2>&1 &
echo $! > /tmp/billing-rest-proxy.pid

ready=0
for _ in $(seq 1 50); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:55321/rest/v1/ || true)"
  if [[ "$code" != "000" && -n "$code" ]]; then
    ready=1
    break
  fi
  sleep 0.2
done
if [[ "$ready" != "1" ]]; then
  echo "PostgREST proxy did not accept connections" >&2
  cat /tmp/billing-postgrest.log >&2 || true
  exit 1
fi

cat > /tmp/billing-disposable.env <<EOT
BILLING_REPLAY_ADMIN_URL=${ADMIN_URL}
BILLING_TEST_DATABASE_URL=${BILLING_URL}
SUPABASE_DB_URL=${RACE_URL}
SUPABASE_LOCAL_API_URL=http://127.0.0.1:55321
SUPABASE_JWT_SECRET=${JWT_SECRET}
EOT

echo "disposable billing database ready: ${RACE_DB} via http://127.0.0.1:55321"
