#!/usr/bin/env bash
# litt-supervisor regression tests — exercises the persistent queue against
# an isolated LITT_SUPERVISOR_DIR. No real services, no network, no writes
# outside the temp root.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SUP="$HERE/bin/litt-supervisor"
ROOT_T="$(mktemp -d)"
export LITT_SUPERVISOR_DIR="$ROOT_T/sup"
PASS=0 FAIL=0

ok()   { PASS=$((PASS+1)); printf 'ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf 'FAIL %s\n' "$1"; }
check(){ # check <desc> <expected-substr-or-empty> <actual>
  if [ -n "$2" ] && ! printf '%s' "$3" | grep -q "$2"; then bad "$1"; else ok "$1"; fi
}

tget() { grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2-; }
field() { # field <state-dir> <id> <key> → value
  local f
  f=$(find "$LITT_SUPERVISOR_DIR/$1" -name "*.task" 2>/dev/null | head -1)
  [ -n "$f" ] && tget "$f" "$3"
}

# --- enqueue + duplicate prevention ---------------------------------------
out=$(bash "$SUP" enqueue --tag t1 -- true 2>&1) && ok "enqueue success" || bad "enqueue success: $out"
out=$(bash "$SUP" enqueue --tag t1 -- true 2>&1) || ok "dedup rejected duplicate tag" || bad "dedup: duplicate tag accepted"

# --- approval gate ---------------------------------------------------------
out=$(bash "$SUP" enqueue --tag danger -- git push origin main 2>&1)
printf '%s' "$out" | grep -qi 'approval' && [ -n "$(field awaiting '' id 2>/dev/null; find "$LITT_SUPERVISOR_DIR/awaiting" -name '*.task' | head -1)" ] \
  && ok "dangerous cmd → awaiting approval" || bad "approval gate: $out"

# --- run a trivial success -------------------------------------------------
bash "$SUP" run --once >/dev/null 2>&1
s=$(field done '' status); check "success task reaches done" "done" "$s"

# --- bounded retries: false with max_attempts=3 → 3 launches, att=3/3 -----
bash "$SUP" enqueue --tag retry --max-attempts 3 -- false >/dev/null 2>&1
for i in 1 2 3 4; do
  for f in "$LITT_SUPERVISOR_DIR"/queue/*.task; do [ -e "$f" ] && sed -i 's/^not_before=.*/not_before=0/' "$f"; done
  bash "$SUP" run --once >/dev/null 2>&1
done
s=$(field failed '' status); a=$(field failed '' attempts); m=$(field failed '' max_attempts)
check "failing task dead-letters" "failed" "$s"
check "attempts == max (3/3)" "^3$" "$a"; check "max recorded" "^3$" "$m"

# --- approve an awaiting task ---------------------------------------------
AWAIT_ID=$(find "$LITT_SUPERVISOR_DIR/awaiting" -name '*.task' -exec grep -m1 '^id=' {} \; | cut -d= -f2 | head -1)
[ -n "$AWAIT_ID" ] && { bash "$SUP" approve "$AWAIT_ID" >/dev/null 2>&1 && ok "approve awaiting task" || bad "approve $AWAIT_ID"; }

# --- pause/resume ----------------------------------------------------------
bash "$SUP" pause >/dev/null 2>&1 && bash "$SUP" status | grep -qi paused && ok "pause reflects in status" || bad "pause"
bash "$SUP" resume >/dev/null 2>&1 && ! bash "$SUP" status | grep -qi paused && ok "resume clears pause" || bad "resume"

# --- stale-PID recovery ----------------------------------------------------
bash "$SUP" enqueue --tag stale -- sleep 60 >/dev/null 2>&1
# Forge a running record with a dead pid
Q=$(find "$LITT_SUPERVISOR_DIR/queue" -name '*.task' | head -1)
if [ -n "$Q" ]; then
  ID=$(tget "$Q" id)
  mv "$Q" "$LITT_SUPERVISOR_DIR/running/"
  RF="$LITT_SUPERVISOR_DIR/running/$(basename "$Q")"
  sed -i 's/^status=.*/status=running/; s/^pid=.*/pid=999999/' "$RF"
  grep -q '^pid=' "$RF" || echo 'pid=999999' >>"$RF"
  bash "$SUP" recover >/dev/null 2>&1
  # dead pid + attempts 0 → requeued (not failed, not lost)
  s=$(field queue '' status); check "dead-pid task requeued by recover" "pending" "$s"
fi

# --- cancel ----------------------------------------------------------------
bash "$SUP" enqueue --tag longrun -- sleep 30 >/dev/null 2>&1
for f in "$LITT_SUPERVISOR_DIR"/queue/*.task; do [ -e "$f" ] && sed -i 's/^not_before=.*/not_before=0/' "$f"; done
( bash "$SUP" run --once >/dev/null 2>&1 & echo $! >"$ROOT_T/run.pid"; sleep 2 )
LR_ID=$(find "$LITT_SUPERVISOR_DIR/running" -name '*.task' -exec grep -m1 '^id=' {} \; 2>/dev/null | cut -d= -f2 | head -1)
if [ -n "$LR_ID" ]; then
  bash "$SUP" cancel "$LR_ID" >/dev/null 2>&1; wait "$(cat "$ROOT_T/run.pid")" 2>/dev/null
  s=$(field done '' status); check "cancelled task ends in done/cancelled" "cancelled\|done" "$s"
else
  bad "cancel: no running task found"
fi

# --- journal ---------------------------------------------------------------
[ -s "$LITT_SUPERVISOR_DIR/state/supervisor.log" ] && ok "journal written" || bad "journal missing"

echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
rm -rf "$ROOT_T"
[ "$FAIL" -eq 0 ]
