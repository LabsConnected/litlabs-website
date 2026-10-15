#!/usr/bin/env bash
# Run the Stripe webhook scenarios against local Supabase in test mode.
# Scenarios 1-8 are the original billing flows. Scenario 9 covers partial
# refunds (one idempotency key per refund id, plus a replay). Scenario 10
# resends an older invoice.paid after cancellation and checks the status
# stays canceled. Scenario 13 posts checkout with no Clerk session: the
# route must refuse (401). The 409 already-subscribed contract is the
# checkout unit test — this harness has no authenticated browser session.
# A missing admin database client cannot be exercised here
# without dropping the local database; that case is a unit test.
#
# Prerequisites on the machine where you run this (not CI):
#   Docker, the Supabase CLI, the Stripe CLI, psql, Node 22, pnpm install
#   STRIPE_TEST_SECRET_KEY=sk_test_...
#
# What it does:
#   1. Refuses to start unless STRIPE_TEST_SECRET_KEY starts with sk_test_.
#   2. Starts local Supabase (supabase start) and uses only its local URL.
#   3. Starts `stripe listen`, forwarding to the local webhook.
#   4. Starts the Next.js app with that listen signing secret.
#   5. Triggers each scenario and prints the HTTP status plus database rows.
#
# Subscriptions, payment failure, cancellation, and same-event replays go
# through `stripe listen`. Invalid signatures cannot, because listen always
# signs. A second event id for one invoice, and a credit pack for an unknown
# clerk, are signed with the listen secret and posted to the same webhook:
# Stripe will not mint those two payloads on its own.
#
# The key is never printed. Live keys and non-local databases are refused.
# This script does not apply migrations to a hosted database.
#
# Usage (from the repository root):
#   STRIPE_TEST_SECRET_KEY=sk_test_... bash scripts/stripe-e2e-local.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${STRIPE_E2E_PORT:-3011}"
WEBHOOK_URL="http://127.0.0.1:${PORT}/api/stripe/webhook"
DRIVER="$ROOT/scripts/stripe-e2e-driver.mjs"
WORKDIR=""
LISTEN_LOG=""
APP_LOG=""
FAILURES=0
GRANT_BROKEN=0
GRANT_BACKUP=""
APP_PID=""
LISTEN_PID=""
DB_URL=""
RUN_ID="e2e$(date +%Y%m%d%H%M%S)"

CREATOR_CLERK="${RUN_ID}_creator"
PRO_CLERK="${RUN_ID}_pro"
FAIL_CLERK="${RUN_ID}_fail"
CANCEL_CLERK="${RUN_ID}_cancel"
GRANTFAIL_CLERK="${RUN_ID}_grantfail"
REFUND_CLERK="${RUN_ID}_refund"
MISSING_CLERK="${RUN_ID}_missing"
CANCEL_PAID_EVENT=""

declare -a RESULTS=()

say() {
  printf '\n=== %s ===\n' "$*"
}

die() {
  printf 'stripe-e2e-local: %s\n' "$*" >&2
  exit 1
}

refuse_key() {
  local key="${STRIPE_TEST_SECRET_KEY:-}"
  if [[ -z "$key" ]]; then
    die "STRIPE_TEST_SECRET_KEY is not set. Refusing to run."
  fi
  if [[ "$key" != sk_test_* ]]; then
    die "STRIPE_TEST_SECRET_KEY must start with sk_test_. Refusing to run."
  fi
  case "$key" in
    *sk_live_*) die "STRIPE_TEST_SECRET_KEY contains sk_live_. Refusing to run." ;;
  esac
}

require_tools() {
  local missing=()
  local tool
  for tool in supabase stripe psql node pnpm python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing+=("$tool")
    fi
  done
  if ((${#missing[@]} > 0)); then
    die "missing required tools: ${missing[*]}"
  fi
  if ! node -e "require('stripe')" >/dev/null 2>&1; then
    echo "Installing dependencies with pnpm (stripe package is required)..."
    pnpm install --frozen-lockfile
  fi
}

assert_safe_id() {
  [[ "$1" =~ ^[A-Za-z0-9_]+$ ]] || die "unsafe identifier: $1"
}

psql_q() {
  psql -X -v ON_ERROR_STOP=1 "$DB_URL" "$@"
}

load_supabase_env() {
  local env_file="$WORKDIR/supabase.env"
  if ! supabase status -o env >"$env_file" 2>"$WORKDIR/supabase-status.err"; then
    if ! supabase status --output env >"$env_file" 2>>"$WORKDIR/supabase-status.err"; then
      cat "$WORKDIR/supabase-status.err" >&2 || true
      die "supabase status failed. Is the local stack running?"
    fi
  fi
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#export }"
    line="${line%$'\r'}"
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    val="${val%\"}"
    val="${val#\"}"
    case "$key" in
      API_URL) API_URL="$val" ;;
      DB_URL) DB_URL="$val" ;;
      SERVICE_ROLE_KEY) SERVICE_ROLE_KEY="$val" ;;
      ANON_KEY) ANON_KEY="$val" ;;
    esac
  done <"$env_file"
  [[ -n "${API_URL:-}" && -n "${DB_URL:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] || die "supabase status did not report API_URL, DB_URL, and SERVICE_ROLE_KEY"
  case "$API_URL" in
    http://127.0.0.1:*|http://localhost:*) ;;
    *) die "Refusing non-local Supabase API URL" ;;
  esac
  case "$DB_URL" in
    *127.0.0.1*|*localhost*) ;;
    *) die "Refusing non-local database URL" ;;
  esac
  case "$API_URL$DB_URL" in
    *rokbfvuoqildggnhappy*) die "Refusing production Supabase project" ;;
  esac
}

insert_users() {
  local clerk email
  for clerk in "$CREATOR_CLERK" "$PRO_CLERK" "$FAIL_CLERK" "$CANCEL_CLERK" "$GRANTFAIL_CLERK" "$REFUND_CLERK"; do
    assert_safe_id "$clerk"
    email="${clerk}@example.com"
    psql_q -v clerk="$clerk" -v email="$email" <<'SQL'
INSERT INTO public.users (clerk_id, email, name)
VALUES (:'clerk', :'email', :'clerk')
ON CONFLICT (clerk_id) DO NOTHING;
SQL
  done
}

start_listen() {
  local -a listen_args
  local help cmd
  listen_args=(
    listen
    --api-key "$STRIPE_TEST_SECRET_KEY"
    --forward-to "$WEBHOOK_URL"
  )
  help="$(stripe listen --help 2>&1 || true)"
  if grep -q -- '--all-snapshot' <<<"$help"; then
    listen_args+=(--all-snapshot)
  fi
  if grep -q -- '--api-version' <<<"$help"; then
    listen_args+=(--api-version "2025-08-27.basil")
  elif grep -q -- '--latest' <<<"$help"; then
    listen_args+=(--latest)
  fi
  : >"$LISTEN_LOG"
  cmd="$(printf '%q ' stripe "${listen_args[@]}")"
  # A pty keeps the CLI from block-buffering the signing secret and HTTP lines.
  python3 - "$LISTEN_LOG" "$cmd" <<'PY' &
import os, pty, signal, sys
log_path, command = sys.argv[1], sys.argv[2]
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", "-lc", command])

def stop(_signum, _frame):
    try:
        os.killpg(pid, signal.SIGTERM)
    except OSError:
        pass
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
with open(log_path, "ab", buffering=0) as handle:
    while True:
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        handle.write(chunk)
        handle.flush()
try:
    os.waitpid(pid, 0)
except ChildProcessError:
    pass
PY
  LISTEN_PID=$!
  local secret="" i
  for i in $(seq 1 40); do
    secret="$(grep -oE 'whsec_[A-Za-z0-9]+' "$LISTEN_LOG" | head -n 1 || true)"
    if [[ -n "$secret" ]]; then
      STRIPE_WEBHOOK_SECRET="$secret"
      export STRIPE_WEBHOOK_SECRET
      return 0
    fi
    if ! kill -0 "$LISTEN_PID" 2>/dev/null; then
      cat "$LISTEN_LOG" >&2 || true
      die "stripe listen exited before printing a signing secret"
    fi
    sleep 1
  done
  cat "$LISTEN_LOG" >&2 || true
  die "timed out waiting for the stripe listen signing secret"
}

start_app() {
  if (echo >/dev/tcp/127.0.0.1/"$PORT") >/dev/null 2>&1; then
    die "port ${PORT} is already in use. Set STRIPE_E2E_PORT to a free port."
  fi
  export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
  export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-}"
  export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
  export SUPABASE_SECRET_KEY="$SERVICE_ROLE_KEY"
  export STRIPE_SECRET_KEY="$STRIPE_TEST_SECRET_KEY"
  export STRIPE_PRICE_CREATOR_BETA="$CREATOR_PRICE"
  export STRIPE_PRICE_PRO_BUILDER_BETA="$PRO_PRICE"
  export STRIPE_WEBHOOK_SECRET
  node scripts/dev-network.mjs --turbo -p "$PORT" >"$APP_LOG" 2>&1 &
  APP_PID=$!
  local i code
  for i in $(seq 1 180); do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      tail -n 80 "$APP_LOG" >&2 || true
      die "the Next.js app exited before the webhook was ready"
    fi
    code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$WEBHOOK_URL" || true)"
    if [[ "$code" == "400" ]]; then
      return 0
    fi
    sleep 1
  done
  tail -n 80 "$APP_LOG" >&2 || true
  die "timed out waiting for ${WEBHOOK_URL} to reject an unsigned request with 400"
}

clear_kv() {
  CUSTOMER=""
  SUBSCRIPTION=""
  INVOICE=""
  INVOICE_PAID_EVENT=""
  INVOICE_FAILED_EVENT=""
  SUBSCRIPTION_CREATED_EVENT=""
  DELETED_EVENT=""
  HTTP_STATUS=""
  EVENT_ID=""
  STATUS=""
  CHARGE=""
  REFUND=""
  REFUND_EVENT=""
  PAYMENT_INTENT=""
}

run_driver() {
  clear_kv
  local out="$WORKDIR/driver.out"
  if ! node "$DRIVER" "$@" >"$out"; then
    cat "$out" >&2 || true
    return 1
  fi
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    case "$key" in
      CUSTOMER) CUSTOMER="$val" ;;
      SUBSCRIPTION) SUBSCRIPTION="$val" ;;
      INVOICE) INVOICE="$val" ;;
      INVOICE_PAID_EVENT) INVOICE_PAID_EVENT="$val" ;;
      INVOICE_FAILED_EVENT) INVOICE_FAILED_EVENT="$val" ;;
      SUBSCRIPTION_CREATED_EVENT) SUBSCRIPTION_CREATED_EVENT="$val" ;;
      DELETED_EVENT) DELETED_EVENT="$val" ;;
      HTTP_STATUS) HTTP_STATUS="$val" ;;
      EVENT_ID) EVENT_ID="$val" ;;
      CREATOR_PRICE) CREATOR_PRICE="$val" ;;
      PRO_PRICE) PRO_PRICE="$val" ;;
      STATUS) STATUS="$val" ;;
      CHARGE) CHARGE="$val" ;;
      REFUND) REFUND="$val" ;;
      REFUND_EVENT) REFUND_EVENT="$val" ;;
      PAYMENT_INTENT) PAYMENT_INTENT="$val" ;;
    esac
  done <"$out"
}

remember_sub() {
  [[ -n "${1:-}" ]] || return 0
  printf '%s\n' "$1" >>"$WORKDIR/subs.txt"
}

# Prints "<hit count> <last status>" for one event id in the listen log.
# A resend of the same id increases the count, so callers can wait for the
# new delivery instead of reading the previous HTTP status.
listen_meta() {
  local event_id="$1"
  python3 - "$LISTEN_LOG" "$event_id" <<'PY'
import re, sys
path, event_id = sys.argv[1], sys.argv[2]
try:
    text = open(path, "r", errors="replace").read()
except FileNotFoundError:
    print("0")
    sys.exit(0)
text = re.sub(r"\x1b\[[0-9;]*m", "", text)
count = 0
last = ""
pending = False
for line in text.splitlines():
    if "-->" in line and event_id in line:
        pending = True
        continue
    if "<--" in line and event_id in line:
        match = re.search(r"\[(\d{3})\]", line)
        if match:
            count += 1
            last = match.group(1)
        elif re.search(r"ERROR|ECONNREFUSED|Failed", line):
            count += 1
            last = "ERROR"
        else:
            continue
        pending = False
print(("%s %s" % (count, last)).strip())
PY
}

wait_new_http() {
  local event_id="$1"
  local baseline="$2"
  local seconds="${3:-90}"
  local start now meta count status
  start="$(date +%s)"
  while true; do
    meta="$(listen_meta "$event_id")"
    count="${meta%% *}"
    if [[ "$meta" == *" "* ]]; then
      status="${meta#* }"
    else
      status=""
    fi
    if [[ "${count:-0}" =~ ^[0-9]+$ && "$count" -gt "$baseline" && "$status" =~ ^[0-9]{3}$ ]]; then
      printf '%s' "$status"
      return 0
    fi
    now="$(date +%s)"
    if (( now - start >= seconds )); then
      if [[ -n "$status" ]]; then
        printf '%s' "$status"
      else
        printf 'TIMEOUT'
      fi
      return 0
    fi
    sleep 1
  done
}

hit_count() {
  local meta count
  meta="$(listen_meta "$1")"
  count="${meta%% *}"
  if [[ ! "$count" =~ ^[0-9]+$ ]]; then
    count=0
  fi
  printf '%s' "$count"
}

resend_event() {
  local event_id="$1"
  [[ -n "$event_id" ]] || return 0
  stripe events resend "$event_id" --api-key "$STRIPE_TEST_SECRET_KEY" \
    >"$WORKDIR/resend.out" 2>&1 || {
      cat "$WORKDIR/resend.out" >&2 || true
      return 1
    }
}

print_listen_lines() {
  local event_id="$1"
  echo "----- stripe listen (${event_id}) -----"
  python3 - "$LISTEN_LOG" "$event_id" <<'PY'
import re, sys
path, event_id = sys.argv[1], sys.argv[2]
text = open(path, "r", errors="replace").read()
text = re.sub(r"\x1b\[[0-9;]*m", "", text)
lines = [line for line in text.splitlines() if event_id in line]
print("\n".join(lines[-6:]) if lines else "(no listen lines yet)")
PY
}

show_user() {
  local label="$1"
  local clerk="$2"
  assert_safe_id "$clerk"
  echo "----- ${label}: credit_ledger and subscription for ${clerk} -----"
  psql_q -P pager=off -v clerk="$clerk" <<'SQL'
SELECT cl.amount, cl.direction, cl.category, cl.balance_bucket, cl.idempotency_key
FROM public.credit_ledger cl
JOIN public.users u ON u.id = cl.user_id
WHERE u.clerk_id = :'clerk'
ORDER BY cl.idempotency_key;

SELECT s.plan, s.status, s.stripe_subscription_id
FROM public.subscriptions s
JOIN public.users u ON u.id = s.user_id
WHERE u.clerk_id = :'clerk';
SQL
}

show_events() {
  local id list=""
  echo "----- stripe_events -----"
  if (("$#" == 0)); then
    echo "(no event ids)"
    return 0
  fi
  for id in "$@"; do
    [[ -z "$id" ]] && continue
    assert_safe_id "$id"
    list+="'${id}',"
  done
  list="${list%,}"
  if [[ -z "$list" ]]; then
    echo "(no event ids)"
    return 0
  fi
  psql_q -P pager=off -c \
    "SELECT stripe_event_id, event_type, result FROM public.stripe_events WHERE stripe_event_id IN (${list}) ORDER BY stripe_event_id;"
}

sql_value() {
  psql_q -tA -c "$1" | tr -d '[:space:]'
}

ledger_count() {
  local clerk="$1"
  assert_safe_id "$clerk"
  sql_value "SELECT COUNT(*) FROM public.credit_ledger cl JOIN public.users u ON u.id = cl.user_id WHERE u.clerk_id = '${clerk}' AND cl.direction = 'credit';"
}

ledger_sum() {
  local clerk="$1"
  assert_safe_id "$clerk"
  sql_value "SELECT COALESCE(SUM(cl.amount),0) FROM public.credit_ledger cl JOIN public.users u ON u.id = cl.user_id WHERE u.clerk_id = '${clerk}' AND cl.direction = 'credit';"
}

sub_field() {
  local clerk="$1"
  local column="$2"
  assert_safe_id "$clerk"
  [[ "$column" == "plan" || "$column" == "status" ]] || die "bad column"
  sql_value "SELECT COALESCE(${column},'') FROM public.subscriptions s JOIN public.users u ON u.id = s.user_id WHERE u.clerk_id = '${clerk}' LIMIT 1;"
}

event_result() {
  local event_id="$1"
  [[ -z "$event_id" ]] && { printf ''; return 0; }
  assert_safe_id "$event_id"
  sql_value "SELECT COALESCE(result,'') FROM public.stripe_events WHERE stripe_event_id = '${event_id}';"
}

record() {
  local id="$1" status="$2" http="$3" detail="$4"
  RESULTS+=("${id}|${status}|${http}|${detail}")
  if [[ "$status" != "PASS" ]]; then
    FAILURES=$((FAILURES + 1))
  fi
  echo "SCENARIO ${id}: ${status} http=${http} ${detail}"
}

app_notes() {
  local event_id="$1"
  [[ -z "$event_id" ]] && return 0
  echo "----- app log (${event_id}) -----"
  grep -F "$event_id" "$APP_LOG" | tail -n 8 || echo "(no app log line)"
}

wait_listen_quiet() {
  local quiet="${1:-8}"
  local max="${2:-90}"
  local start now last size change
  start="$(date +%s)"
  last="$(wc -c <"$LISTEN_LOG" | tr -d ' ')"
  change="$start"
  while true; do
    sleep 1
    size="$(wc -c <"$LISTEN_LOG" | tr -d ' ')"
    now="$(date +%s)"
    if [[ "$size" != "$last" ]]; then
      last="$size"
      change="$now"
    fi
    if (( now - change >= quiet || now - start >= max )); then
      return 0
    fi
  done
}

scenario_subscribe_grant() {
  local number="$1" label="$2" clerk="$3" plan="$4" price="$5" expect_amount="$6"
  say "scenario ${number}: ${label}"
  if ! run_driver subscribe --clerk "$clerk" --plan "$plan" --price "$price" --card visa; then
    record "$number" "FAIL" "driver" "stripe subscription create failed"
    return 0
  fi
  remember_sub "$SUBSCRIPTION"
  local created_http="" paid_http="" baseline
  if [[ -n "$SUBSCRIPTION_CREATED_EVENT" ]]; then
    created_http="$(wait_new_http "$SUBSCRIPTION_CREATED_EVENT" 0 90)"
    print_listen_lines "$SUBSCRIPTION_CREATED_EVENT"
  fi
  if [[ -z "$INVOICE_PAID_EVENT" ]]; then
    show_user "$label" "$clerk"
    record "$number" "FAIL" "missing" "invoice.paid event was not created"
    return 0
  fi
  paid_http="$(wait_new_http "$INVOICE_PAID_EVENT" 0 90)"
  if [[ "$paid_http" == "ERROR" || "$paid_http" == "TIMEOUT" ]]; then
    baseline="$(hit_count "$INVOICE_PAID_EVENT")"
    resend_event "$INVOICE_PAID_EVENT" || true
    paid_http="$(wait_new_http "$INVOICE_PAID_EVENT" "$baseline" 60)"
  fi
  print_listen_lines "$INVOICE_PAID_EVENT"
  app_notes "$INVOICE_PAID_EVENT"
  show_user "$label" "$clerk"
  show_events "$SUBSCRIPTION_CREATED_EVENT" "$INVOICE_PAID_EVENT"
  local count sum got_plan got_status
  count="$(ledger_count "$clerk")"
  sum="$(ledger_sum "$clerk")"
  got_plan="$(sub_field "$clerk" plan)"
  got_status="$(sub_field "$clerk" status)"
  if [[ "$paid_http" == "200" && "$count" == "1" && "$sum" == "$expect_amount" && "$got_plan" == "$plan" && "$got_status" == "active" ]]; then
    record "$number" "PASS" "$paid_http" "ledger=${sum} plan=${got_plan} status=${got_status} created_http=${created_http:-n/a}"
  else
    record "$number" "FAIL" "$paid_http" "ledger_count=${count} ledger_sum=${sum} plan=${got_plan} status=${got_status} created_http=${created_http:-n/a}"
  fi
}

scenario_duplicate() {
  say "scenario 3: duplicate invoice.paid does not double-credit"
  if [[ -z "${CREATOR_PAID_EVENT:-}" || -z "${CREATOR_INVOICE:-}" ]]; then
    record "3" "FAIL" "n/a" "creator invoice.paid event is missing"
    return 0
  fi
  local before baseline replay_http
  before="$(ledger_count "$CREATOR_CLERK")"
  baseline="$(hit_count "$CREATOR_PAID_EVENT")"
  resend_event "$CREATOR_PAID_EVENT" || true
  replay_http="$(wait_new_http "$CREATOR_PAID_EVENT" "$baseline" 60)"
  print_listen_lines "$CREATOR_PAID_EVENT"
  local body="$WORKDIR/dup-body.txt"
  if ! run_driver post --kind duplicate-invoice --source-event "$CREATOR_PAID_EVENT" \
    --url "$WEBHOOK_URL" --run "$RUN_ID" --body-file "$body"; then
    record "3" "FAIL" "driver" "second event id was not posted"
    return 0
  fi
  local dup_http="$HTTP_STATUS" dup_event="$EVENT_ID"
  echo "----- direct POST second event id -----"
  echo "http=${dup_http} event=${dup_event}"
  echo "body=$(head -c 300 "$body" 2>/dev/null || true)"
  show_user "duplicate" "$CREATOR_CLERK"
  show_events "$CREATOR_PAID_EVENT" "$dup_event"
  local after sum dup_result
  after="$(ledger_count "$CREATOR_CLERK")"
  sum="$(ledger_sum "$CREATOR_CLERK")"
  dup_result="$(event_result "$dup_event")"
  if [[ "$replay_http" == "200" && "$dup_http" == "200" && "$before" == "1" && "$after" == "1" && "$sum" == "7500" && "$dup_result" == "processed" ]]; then
    record "3" "PASS" "replay=${replay_http} second=${dup_http}" "ledger_rows=${after} sum=${sum}"
  else
    record "3" "FAIL" "replay=${replay_http} second=${dup_http}" "before=${before} after=${after} sum=${sum} second_result=${dup_result}"
  fi
}

scenario_failed_payment() {
  say "scenario 4: failed payment sets past_due and grants nothing"
  if ! run_driver subscribe --clerk "$FAIL_CLERK" --plan creator_beta --price "$CREATOR_PRICE" --card charge_fail; then
    record "4" "FAIL" "driver" "failing-card subscription was not created"
    return 0
  fi
  remember_sub "$SUBSCRIPTION"
  local failed_event="$INVOICE_FAILED_EVENT"
  local created_event="$SUBSCRIPTION_CREATED_EVENT"
  if [[ -n "$created_event" ]]; then
    wait_new_http "$created_event" 0 60 >/dev/null || true
  fi
  wait_listen_quiet 6 45
  local http="" baseline
  if [[ -z "$failed_event" ]]; then
    show_user "failed payment" "$FAIL_CLERK"
    record "4" "FAIL" "missing" "invoice.payment_failed was not created"
    return 0
  fi
  # Deliver payment_failed after the other subscription events have drained
  # so the past_due write is the last status write.
  baseline="$(hit_count "$failed_event")"
  resend_event "$failed_event" || true
  http="$(wait_new_http "$failed_event" "$baseline" 60)"
  if [[ "$http" != "200" ]]; then
    baseline="$(hit_count "$failed_event")"
    resend_event "$failed_event" || true
    http="$(wait_new_http "$failed_event" "$baseline" 45)"
  fi
  print_listen_lines "$failed_event"
  app_notes "$failed_event"
  show_user "failed payment" "$FAIL_CLERK"
  show_events "$created_event" "$failed_event"
  local count status
  count="$(ledger_count "$FAIL_CLERK")"
  status="$(sub_field "$FAIL_CLERK" status)"
  if [[ "$http" == "200" && "$count" == "0" && "$status" == "past_due" ]]; then
    record "4" "PASS" "$http" "status=${status} ledger_rows=${count}"
  else
    record "4" "FAIL" "$http" "status=${status} ledger_rows=${count}"
  fi
}

scenario_cancel() {
  say "scenario 5: cancellation sets canceled"
  if ! run_driver subscribe --clerk "$CANCEL_CLERK" --plan creator_beta --price "$CREATOR_PRICE" --card visa; then
    record "5" "FAIL" "driver" "subscription create failed"
    return 0
  fi
  remember_sub "$SUBSCRIPTION"
  local sub="$SUBSCRIPTION"
  local paid="$INVOICE_PAID_EVENT"
  if [[ -n "$paid" ]]; then
    wait_new_http "$paid" 0 90 >/dev/null || true
  fi
  if ! run_driver cancel --subscription "$sub"; then
    record "5" "FAIL" "driver" "subscription cancel failed"
    return 0
  fi
  local deleted="$DELETED_EVENT"
  local http="missing"
  if [[ -n "$deleted" ]]; then
    http="$(wait_new_http "$deleted" 0 60)"
    print_listen_lines "$deleted"
  fi
  show_user "cancellation" "$CANCEL_CLERK"
  show_events "$deleted"
  CANCEL_PAID_EVENT="$paid"
  local status
  status="$(sub_field "$CANCEL_CLERK" status)"
  if [[ "$http" == "200" && "$status" == "canceled" ]]; then
    record "5" "PASS" "$http" "status=${status}"
  else
    record "5" "FAIL" "$http" "status=${status} deleted_event=${deleted:-missing}"
  fi
}

scenario_signatures() {
  say "scenario 6: invalid signature is 400, valid signature is 200"
  local missing_body="$WORKDIR/sig-missing.txt"
  local bad_body="$WORKDIR/sig-bad.txt"
  local ok_body="$WORKDIR/sig-ok.txt"
  if ! run_driver post --kind missing-signature --url "$WEBHOOK_URL" --run "$RUN_ID" --body-file "$missing_body"; then
    record "6" "FAIL" "driver" "missing-signature request failed"
    return 0
  fi
  local missing_http="$HTTP_STATUS" missing_event="$EVENT_ID"
  if ! run_driver post --kind invalid-signature --url "$WEBHOOK_URL" --run "$RUN_ID" --body-file "$bad_body"; then
    record "6" "FAIL" "driver" "invalid-signature request failed"
    return 0
  fi
  local bad_http="$HTTP_STATUS" bad_event="$EVENT_ID"
  if ! run_driver post --kind valid-noop --url "$WEBHOOK_URL" --run "$RUN_ID" --body-file "$ok_body"; then
    record "6" "FAIL" "driver" "valid signature request failed"
    return 0
  fi
  local ok_http="$HTTP_STATUS" ok_event="$EVENT_ID"
  echo "----- signature responses -----"
  echo "missing http=${missing_http} body=$(head -c 180 "$missing_body" 2>/dev/null || true)"
  echo "invalid http=${bad_http} body=$(head -c 180 "$bad_body" 2>/dev/null || true)"
  echo "valid http=${ok_http} body=$(head -c 180 "$ok_body" 2>/dev/null || true)"
  show_events "$missing_event" "$bad_event" "$ok_event"
  local missing_row bad_row ok_row
  missing_row="$(event_result "$missing_event")"
  bad_row="$(event_result "$bad_event")"
  ok_row="$(event_result "$ok_event")"
  if [[ "$missing_http" == "400" && "$bad_http" == "400" && "$ok_http" == "200" && -z "$missing_row" && -z "$bad_row" && "$ok_row" == "processed" ]]; then
    record "6" "PASS" "missing=${missing_http} invalid=${bad_http} valid=${ok_http}" "valid_event=${ok_row}"
  else
    record "6" "FAIL" "missing=${missing_http} invalid=${bad_http} valid=${ok_http}" "rows missing=${missing_row:-none} invalid=${bad_row:-none} valid=${ok_row:-none}"
  fi
}

scenario_race() {
  say "scenario 7: invoice.paid before the subscription row"
  if [[ -z "${PRO_PAID_EVENT:-}" || -z "${PRO_SUB:-}" ]]; then
    record "7" "FAIL" "n/a" "pro invoice.paid event is missing"
    return 0
  fi
  local before
  before="$(ledger_count "$PRO_CLERK")"
  assert_safe_id "$PRO_SUB"
  assert_safe_id "$PRO_PAID_EVENT"
  psql_q -v sub="$PRO_SUB" -v event="$PRO_PAID_EVENT" <<'SQL'
DELETE FROM public.subscriptions WHERE stripe_subscription_id = :'sub';
DELETE FROM public.stripe_events WHERE stripe_event_id = :'event';
SQL
  local rows_before
  rows_before="$(sql_value "SELECT COUNT(*) FROM public.subscriptions WHERE stripe_subscription_id = '${PRO_SUB}';")"
  echo "subscription rows before resend=${rows_before}"
  local baseline http
  baseline="$(hit_count "$PRO_PAID_EVENT")"
  resend_event "$PRO_PAID_EVENT" || true
  http="$(wait_new_http "$PRO_PAID_EVENT" "$baseline" 70)"
  print_listen_lines "$PRO_PAID_EVENT"
  app_notes "$PRO_PAID_EVENT"
  show_user "invoice before row" "$PRO_CLERK"
  show_events "$PRO_PAID_EVENT"
  local after sum result rows_after
  after="$(ledger_count "$PRO_CLERK")"
  sum="$(ledger_sum "$PRO_CLERK")"
  result="$(event_result "$PRO_PAID_EVENT")"
  rows_after="$(sql_value "SELECT COUNT(*) FROM public.subscriptions WHERE stripe_subscription_id = '${PRO_SUB}';")"
  if [[ "$before" == "$after" && "$sum" == "18000" && "$http" == "200" && "$result" == "processed" && "$rows_after" == "1" ]]; then
    record "7" "PASS" "$http" "granted once via fallback ledger=${sum} rows_before=${rows_before}"
  elif [[ "$before" == "$after" && "$sum" == "18000" && "$http" == "500" && -z "$result" ]]; then
    record "7" "PASS" "$http" "retryable failure, event not processed, ledger unchanged (${sum})"
  else
    record "7" "FAIL" "$http" "before=${before} after=${after} sum=${sum} event=${result:-absent} sub_rows=${rows_after}"
  fi
}

restore_grant() {
  if [[ "$GRANT_BROKEN" != "1" ]]; then
    return 0
  fi
  if [[ ! -s "$GRANT_BACKUP" ]]; then
    echo "stripe-e2e-local: grant_credits backup is missing" >&2
    return 1
  fi
  psql_q -f "$GRANT_BACKUP"
  GRANT_BROKEN=0
  local stub
  stub="$(sql_value "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'grant_credits' AND position('forced grant failure' in p.prosrc) > 0;")"
  if [[ "$stub" != "0" ]]; then
    echo "stripe-e2e-local: grant_credits still contains the scenario 8 stub" >&2
    return 1
  fi
}

install_grant_stub() {
  local existing
  existing="$(sql_value "SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'grant_credits' AND position('forced grant failure' in p.prosrc) > 0;")"
  if [[ "$existing" != "0" ]]; then
    die "grant_credits is already the forced-failure stub. Restore it before running this script."
  fi
  psql_q -tA -c "SELECT pg_get_functiondef('public.grant_credits(uuid,integer,text,text,text,text,text,text,timestamptz)'::regprocedure) || ';'" \
    >"$GRANT_BACKUP"
  [[ -s "$GRANT_BACKUP" ]] || die "failed to save grant_credits"
  psql_q <<'SQL'
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id UUID,
  p_amount INTEGER,
  p_category TEXT,
  p_balance_bucket TEXT,
  p_description TEXT,
  p_idempotency_key TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(granted BOOLEAN, total_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'forced grant failure for stripe e2e scenario 8';
END;
$$;
SQL
  GRANT_BROKEN=1
}

debit_keys() {
  local clerk="$1"
  assert_safe_id "$clerk"
  psql_q -tA -v clerk="$clerk" <<'SQL'
SELECT cl.amount || ' ' || cl.idempotency_key
FROM public.credit_ledger cl
JOIN public.users u ON u.id = cl.user_id
WHERE u.clerk_id = :'clerk' AND cl.direction = 'debit'
ORDER BY cl.idempotency_key;
SQL
}

scenario_partial_refunds() {
  say "scenario 9: partial refunds debit per refund id, and a replay does not debit again"
  assert_safe_id "$REFUND_CLERK"
  psql_q -v clerk="$REFUND_CLERK" <<'SQL'
INSERT INTO public.credit_ledger (
  user_id, amount, direction, category, balance_bucket, description, idempotency_key
)
SELECT u.id, 4000, 'credit', 'purchase', 'purchased',
       'e2e refund balance', 'e2e_refund_seed_' || u.clerk_id
FROM public.users u
WHERE u.clerk_id = :'clerk'
ON CONFLICT (idempotency_key) DO NOTHING;
SQL
  if ! run_driver create-pack-charge --clerk "$REFUND_CLERK" --amount 1000 --coins 4000; then
    record "9" "FAIL" "driver" "credit-pack charge was not created"
    return 0
  fi
  local charge="$CHARGE"
  if ! run_driver refund-part --charge "$charge" --amount 250; then
    record "9" "FAIL" "driver" "first partial refund failed"
    return 0
  fi
  local refund_a="$REFUND" event_a="$REFUND_EVENT" http_a="missing"
  if [[ -n "$event_a" ]]; then
    http_a="$(wait_new_http "$event_a" 0 90)"
    print_listen_lines "$event_a"
  fi
  if ! run_driver refund-part --charge "$charge" --amount 500; then
    record "9" "FAIL" "driver" "second partial refund failed"
    return 0
  fi
  local refund_b="$REFUND" event_b="$REFUND_EVENT" http_b="missing"
  if [[ -n "$event_b" ]]; then
    http_b="$(wait_new_http "$event_b" 0 90)"
    print_listen_lines "$event_b"
  fi
  local baseline replay_http="n/a"
  if [[ -n "$event_a" ]]; then
    baseline="$(hit_count "$event_a")"
    resend_event "$event_a" || true
    replay_http="$(wait_new_http "$event_a" "$baseline" 60)"
  fi
  show_user "partial refunds" "$REFUND_CLERK"
  echo "----- debit keys -----"
  debit_keys "$REFUND_CLERK"
  assert_safe_id "$refund_a"
  assert_safe_id "$refund_b"
  local debits key_a key_b
  debits="$(sql_value "SELECT COUNT(*) FROM public.credit_ledger cl JOIN public.users u ON u.id = cl.user_id WHERE u.clerk_id = '${REFUND_CLERK}' AND cl.direction = 'debit';")"
  key_a="$(sql_value "SELECT COUNT(*) FROM public.credit_ledger cl JOIN public.users u ON u.id = cl.user_id WHERE u.clerk_id = '${REFUND_CLERK}' AND cl.idempotency_key LIKE 'refund_${refund_a}:%';")"
  key_b="$(sql_value "SELECT COUNT(*) FROM public.credit_ledger cl JOIN public.users u ON u.id = cl.user_id WHERE u.clerk_id = '${REFUND_CLERK}' AND cl.idempotency_key LIKE 'refund_${refund_b}:%';")"
  if [[ "$http_a" == "200" && "$http_b" == "200" && "$replay_http" == "200" && "$debits" == "2" && "$key_a" == "1" && "$key_b" == "1" ]]; then
    record "9" "PASS" "a=${http_a} b=${http_b} replay=${replay_http}" "debits=${debits} keys=${refund_a},${refund_b}"
  else
    record "9" "FAIL" "a=${http_a} b=${http_b} replay=${replay_http}" "debits=${debits} key_a=${key_a} key_b=${key_b}"
  fi
}

scenario_late_invoice() {
  say "scenario 10: a delayed invoice.paid does not reactivate a canceled subscription"
  if [[ -z "$CANCEL_PAID_EVENT" ]]; then
    record "10" "FAIL" "n/a" "scenario 5 did not record an invoice.paid event"
    return 0
  fi
  assert_safe_id "$CANCEL_PAID_EVENT"
  local before
  before="$(ledger_count "$CANCEL_CLERK")"
  psql_q -v event="$CANCEL_PAID_EVENT" <<'SQL'
DELETE FROM public.stripe_events WHERE stripe_event_id = :'event';
SQL
  local still
  still="$(sql_value "SELECT COUNT(*) FROM public.stripe_events WHERE stripe_event_id = '${CANCEL_PAID_EVENT}';")"
  echo "stripe_events rows before resend=${still}"
  local baseline http
  baseline="$(hit_count "$CANCEL_PAID_EVENT")"
  resend_event "$CANCEL_PAID_EVENT" || true
  http="$(wait_new_http "$CANCEL_PAID_EVENT" "$baseline" 70)"
  print_listen_lines "$CANCEL_PAID_EVENT"
  app_notes "$CANCEL_PAID_EVENT"
  show_user "late invoice.paid" "$CANCEL_CLERK"
  show_events "$CANCEL_PAID_EVENT"
  local after status
  after="$(ledger_count "$CANCEL_CLERK")"
  status="$(sub_field "$CANCEL_CLERK" status)"
  if [[ "$still" == "0" && "$http" == "200" && "$status" == "canceled" && "$before" == "$after" ]]; then
    record "10" "PASS" "$http" "status=${status} ledger_rows=${after}"
  else
    record "10" "FAIL" "$http" "status=${status} before=${before} after=${after} event_cleared=${still}"
  fi
}

scenario_duplicate_checkout() {
  say "scenario 13: duplicate subscription checkout is blocked"
  local body="$WORKDIR/checkout-13.json"
  local code
  code="$(curl -s -o "$body" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${PORT}/api/billing/checkout" \
    -H 'content-type: application/json' \
    -d '{"planId":"creator_beta"}' || true)"
  echo "checkout body: $(cat "$body" 2>/dev/null || true)"
  # No Clerk session in this harness, so the route refuses before Stripe.
  # An authenticated active/trialing/past_due subscriber gets 409
  # (code already_subscribed) — asserted in billing-state-machine.test.ts.
  if [[ "$code" == "401" || "$code" == "409" ]]; then
    record "13" "PASS" "$code" "checkout refused before a second Stripe session"
  else
    record "13" "FAIL" "$code" "expected 401 without a session or 409 if already subscribed"
  fi
}

scenario_failed_grants() {
  say "scenario 8: failed credit grant returns 500 and is not marked processed"
  local body="$WORKDIR/pack-body.txt"
  if ! run_driver post --kind credit-pack-missing --url "$WEBHOOK_URL" \
    --run "$RUN_ID" --clerk "$MISSING_CLERK" --body-file "$body"; then
    record "8" "FAIL" "driver" "credit-pack request failed"
    return 0
  fi
  local pack_http="$HTTP_STATUS" pack_event="$EVENT_ID"
  echo "----- credit pack (missing user) -----"
  echo "http=${pack_http} event=${pack_event}"
  echo "body=$(head -c 300 "$body" 2>/dev/null || true)"
  show_events "$pack_event"
  local pack_row
  pack_row="$(event_result "$pack_event")"
  local pack_ok=0
  if [[ "$pack_http" == "500" && -z "$pack_row" ]]; then
    pack_ok=1
  fi

  install_grant_stub
  run_driver subscribe --clerk "$GRANTFAIL_CLERK" --plan creator_beta --price "$CREATOR_PRICE" --card visa || {
    restore_grant || true
    record "8" "FAIL" "driver" "subscription create failed while grant_credits was stubbed"
    return 0
  }
  remember_sub "$SUBSCRIPTION"
  local paid="$INVOICE_PAID_EVENT"
  local sub_http="missing"
  if [[ -n "$paid" ]]; then
    sub_http="$(wait_new_http "$paid" 0 70)"
    print_listen_lines "$paid"
    app_notes "$paid"
  fi
  show_user "failed subscription grant" "$GRANTFAIL_CLERK"
  show_events "$paid"
  local sub_row count
  sub_row="$(event_result "$paid")"
  count="$(ledger_count "$GRANTFAIL_CLERK")"
  restore_grant
  if [[ "$pack_ok" == "1" && "$sub_http" == "500" && -z "$sub_row" && "$count" == "0" ]]; then
    record "8" "PASS" "pack=${pack_http} subscription=${sub_http}" "neither event stored; ledger_rows=${count}"
  else
    record "8" "FAIL" "pack=${pack_http} subscription=${sub_http}" "pack_event=${pack_row:-absent} sub_event=${sub_row:-absent} ledger_rows=${count}"
  fi
}

cancel_created_subs() {
  [[ -f "$WORKDIR/subs.txt" ]] || return 0
  local sub
  while IFS= read -r sub; do
    [[ -z "$sub" ]] && continue
    node "$DRIVER" cancel --subscription "$sub" >"$WORKDIR/cancel.out" 2>&1 || true
  done <"$WORKDIR/subs.txt"
}

cleanup() {
  local status=$?
  if [[ "${CLEANED:-0}" == "1" ]]; then
    exit "$status"
  fi
  CLEANED=1
  set +e
  restore_grant
  local restore_status=$?
  cancel_created_subs
  if [[ -n "$APP_PID" ]]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  if [[ -n "$LISTEN_PID" ]]; then
    kill "$LISTEN_PID" 2>/dev/null || true
    wait "$LISTEN_PID" 2>/dev/null || true
  fi
  if [[ "$status" -eq 0 && "$restore_status" -ne 0 ]]; then
    status="$restore_status"
  fi
  echo
  echo "Logs: ${WORKDIR}"
  exit "$status"
}
prepare_workdir() {
  WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/stripe-e2e.XXXXXX")"
  chmod 700 "$WORKDIR"
  LISTEN_LOG="$WORKDIR/stripe-listen.log"
  APP_LOG="$WORKDIR/next-dev.log"
  GRANT_BACKUP="$WORKDIR/grant_credits.sql"
}

print_summary() {
  say "summary"
  local row id status http detail
  printf '%-10s %-6s %s\n' "SCENARIO" "RESULT" "HTTP / EVIDENCE"
  if (("${#RESULTS[@]}" == 0)); then
    echo "(no scenarios ran)"
    return 0
  fi
  for row in "${RESULTS[@]}"; do
    IFS='|' read -r id status http detail <<<"$row"
    printf '%-10s %-6s %s %s\n' "$id" "$status" "$http" "$detail"
  done
  echo "Failures: ${FAILURES}"
  echo "Run id: ${RUN_ID}"
}

main() {
  refuse_key
  prepare_workdir
  trap cleanup EXIT
  require_tools
  say "starting local Supabase"
  supabase start
  load_supabase_env
  insert_users
  say "creating or reusing test-mode prices"
  run_driver ensure-prices || die "could not create test-mode prices"
  [[ -n "$CREATOR_PRICE" && -n "$PRO_PRICE" ]] || die "price ids were not created"
  say "starting stripe listen"
  start_listen
  say "starting the app on port ${PORT}"
  start_app
  echo "Webhook: ${WEBHOOK_URL}"

  scenario_subscribe_grant 1 "creator checkout grants 7500" "$CREATOR_CLERK" creator_beta "$CREATOR_PRICE" 7500
  CREATOR_PAID_EVENT="$INVOICE_PAID_EVENT"
  CREATOR_INVOICE="$INVOICE"
  CREATOR_SUB="$SUBSCRIPTION"

  scenario_subscribe_grant 2 "pro checkout grants 18000" "$PRO_CLERK" pro_builder_beta "$PRO_PRICE" 18000
  PRO_PAID_EVENT="$INVOICE_PAID_EVENT"
  PRO_SUB="$SUBSCRIPTION"

  scenario_duplicate
  scenario_failed_payment
  scenario_cancel
  scenario_signatures
  scenario_race
  scenario_partial_refunds
  scenario_late_invoice
  scenario_failed_grants
  scenario_duplicate_checkout

  print_summary
  if ((FAILURES > 0)); then
    exit 1
  fi
}

main "$@"
