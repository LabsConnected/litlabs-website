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
find_id() { # find_id <state> <id> → task file path
  find "$LITT_SUPERVISOR_DIR/$1" -name "*-$2.task" 2>/dev/null | head -1
}
find_tag() { # find_tag <state> <tag> → task file path
  local f
  for f in "$LITT_SUPERVISOR_DIR/$1"/*.task; do
    [ -e "$f" ] || continue
    [ "$(tget "$f" tag)" = "$2" ] && { printf '%s' "$f"; return 0; }
  done
  return 1
}
fid() { local f; f=$(find_id "$1" "$2"); [ -n "$f" ] && tget "$f" "$3"; }
ftag() { local f; f=$(find_tag "$1" "$2" || true); [ -n "$f" ] && tget "$f" "$3"; }
count_state() { find "$LITT_SUPERVISOR_DIR/$1" -name '*.task' 2>/dev/null | wc -l | tr -d ' '; }

enqueue_id() { # enqueue_id <args...> → prints task id, echoes full output to stderr-free stdout id only
  local out id
  out=$(bash "$SUP" enqueue "$@" 2>&1) || { printf '%s' "$out" >&2; return 1; }
  id=$(printf '%s\n' "$out" | sed -n 's/^\([0-9a-f]\{8\}\)  \[.*$/\1/p' | head -1)
  [ -n "$id" ] || { printf '%s' "$out" >&2; return 1; }
  printf '%s' "$id"
}

reset_due() { for f in "$LITT_SUPERVISOR_DIR"/queue/*.task; do [ -e "$f" ] && sed -i 's/^not_before=.*/not_before=0/' "$f"; done; }

move_to_running() { # move_to_running <id> <pid> — forge a claimed running record
  local id=$1 pid=$2 f rf
  f=$(find_id queue "$id"); [ -n "$f" ] || return 1
  rf="$LITT_SUPERVISOR_DIR/running/$(basename "$f")"
  mv "$f" "$rf"
  sed -i 's/^status=.*/status=running/; s/^pid=.*/pid='"$pid"'/' "$rf"
  grep -q '^pid=' "$rf" || printf 'pid=%s\n' "$pid" >>"$rf"
  rm -f "$LITT_SUPERVISOR_DIR/running/$id.starttime" \
        "$LITT_SUPERVISOR_DIR/running/$id.cancel" \
        "$LITT_SUPERVISOR_DIR/running/$id.rc"
  printf '%s' "$rf"
}

# --- enqueue + duplicate prevention ---------------------------------------
ID1=$(enqueue_id --tag t1 -- true) && ok "enqueue success ($ID1)" || bad "enqueue success"
out=$(bash "$SUP" enqueue --tag t1 -- true 2>&1) || ok "dedup rejected duplicate tag" || bad "dedup: duplicate tag accepted: $out"

# --- approval gate ---------------------------------------------------------
ID_DANGER=$(enqueue_id --tag danger -- git push origin main) && ok "dangerous cmd enqueued for approval ($ID_DANGER)" || bad "dangerous enqueue"
[ -n "$(find_tag awaiting danger || true)" ] && ok "dangerous cmd → awaiting approval" || bad "approval gate: not awaiting"

# --- run a trivial success -------------------------------------------------
bash "$SUP" run --once >/dev/null 2>&1
s=$(fid done "$ID1" status); check "success task reaches done" "done" "$s"

# --- memory-aware scheduling gate ------------------------------------------
ID_MEM=$(enqueue_id --tag memgate -- sleep 1) && ok "memgate task enqueued ($ID_MEM)" || bad "memgate enqueue"
out=$(LITT_SUPERVISOR_MIN_MEM_KB=999999999 bash "$SUP" run --once 2>&1)
printf '%s' "$out" | grep -q 'no due tasks' && [ -n "$(find_id queue "$ID_MEM")" ] \
  && ok "low-memory defers light task" || bad "memory gate: $out"
out=$(bash "$SUP" run --once 2>&1)
printf '%s' "$out" | grep -q "task $ID_MEM done" && ok "memory gate clears → task runs" || bad "memory gate clear: $out"
[ -f "$LITT_SUPERVISOR_DIR/reports/$ID_MEM.json" ] && grep -q '"status": "done"' "$LITT_SUPERVISOR_DIR/reports/$ID_MEM.json" \
  && ok "completion report written" || bad "completion report missing"

# --- bounded retries: false with max_attempts=3 → 3 launches, att=3/3 -----
ID_RETRY=$(enqueue_id --tag retry --max-attempts 3 -- false) && ok "retry task enqueued ($ID_RETRY)" || bad "retry enqueue"
for i in 1 2 3 4; do
  reset_due
  bash "$SUP" run --once >/dev/null 2>&1
done
s=$(fid failed "$ID_RETRY" status); a=$(fid failed "$ID_RETRY" attempts); m=$(fid failed "$ID_RETRY" max_attempts)
check "failing task dead-letters" "failed" "$s"
check "attempts == max (3/3)" "^3$" "$a"; check "max recorded" "^3$" "$m"
[ -f "$LITT_SUPERVISOR_DIR/reports/$ID_RETRY.json" ] && grep -q '"exit_code": 1' "$LITT_SUPERVISOR_DIR/reports/$ID_RETRY.json" \
  && ok "failed completion report has exit code" || bad "failed report missing exit_code"

# --- approve then cancel an awaiting/queued task ---------------------------
[ -n "$ID_DANGER" ] && {
  bash "$SUP" approve "$ID_DANGER" >/dev/null 2>&1 && ok "approve awaiting task" || bad "approve $ID_DANGER"
  bash "$SUP" cancel "$ID_DANGER" >/dev/null 2>&1 && ok "cancel approved queued task" || bad "cancel queued $ID_DANGER"
  s=$(fid done "$ID_DANGER" status); check "queued cancel records cancelled" "cancelled" "$s"
}

# --- pause/resume ----------------------------------------------------------
bash "$SUP" pause >/dev/null 2>&1 && bash "$SUP" status | grep -qi paused && ok "pause reflects in status" || bad "pause"
bash "$SUP" resume >/dev/null 2>&1 && ! bash "$SUP" status | grep -qi paused && ok "resume clears pause" || bad "resume"

# --- stale-PID recovery ----------------------------------------------------
ID_STALE=$(enqueue_id --tag stale -- sleep 60) && ok "stale task enqueued ($ID_STALE)" || bad "stale enqueue"
RF=$(move_to_running "$ID_STALE" 999999) && ok "forged running record" || bad "forge running record"
bash "$SUP" recover >/dev/null 2>&1
s=$(fid queue "$ID_STALE" status); check "dead-pid task requeued by recover" "pending" "$s"
# Remove it so later scheduling tests are not blocked by a 60s sleeper.
bash "$SUP" cancel "$ID_STALE" >/dev/null 2>&1 && ok "stale task cancelled after recovery check" || bad "cancel stale $ID_STALE"

# --- crash-safe completion adoption (no duplicate after supervisor death) --
sleep 30 & APID=$!
ID_ADOPT=$(enqueue_id --tag adopt -- sleep 30) && ok "adopt task enqueued ($ID_ADOPT)" || bad "adopt enqueue"
RF=$(move_to_running "$ID_ADOPT" "$APID") && ok "adopt running record forged" || bad "forge adopt record"
bash "$SUP" recover >/dev/null 2>&1
s=$(fid running "$ID_ADOPT" status); check "live orphaned pid left running" "running" "$s"
# Simulate the worker finishing while the supervisor was down: rcfile exists,
# then the pid disappears. Recovery must finish, not requeue/duplicate.
printf '0\n' >"$LITT_SUPERVISOR_DIR/running/$ID_ADOPT.rc"
kill "$APID" 2>/dev/null; wait "$APID" 2>/dev/null || true
bash "$SUP" recover >/dev/null 2>&1
s=$(fid done "$ID_ADOPT" status); rc=$(fid done "$ID_ADOPT" exit_code)
check "completed orphan finishes done (no duplicate)" "done" "$s"
check "adopted exit code preserved" "^0$" "$rc"

# --- cancel a live running task ---------------------------------------------
ID_LONG=$(enqueue_id --priority 9 --tag longrun -- sleep 30) && ok "longrun task enqueued ($ID_LONG)" || bad "longrun enqueue"
reset_due
( bash "$SUP" run --once >/dev/null 2>&1 & echo $! >"$ROOT_T/run.pid" )
# Poll for THIS task's claim — other queue noise must not satisfy the check.
claimed=""
for _ in $(seq 1 30); do
  [ -n "$(find_id running "$ID_LONG")" ] && { claimed=1; break; }
  sleep 1
done
if [ -n "$claimed" ]; then
  bash "$SUP" cancel "$ID_LONG" >/dev/null 2>&1
  s=""
  for _ in $(seq 1 30); do
    s=$(fid done "$ID_LONG" status)
    [ "$s" = "cancelled" ] && break
    sleep 1
  done
  check "cancelled task records cancelled status" "^cancelled$" "$s"
else
  bad "cancel: longrun task never claimed"
fi

# --- concurrent light agents + worktree serialization -----------------------
mkdir -p "$ROOT_T/repo1" "$ROOT_T/repo2"
git init -q "$ROOT_T/repo1"; git init -q "$ROOT_T/repo2"
ID_C1=$(enqueue_id --priority 9 --tag c1 --worktree "$ROOT_T/repo1" -- sleep 3) && ok "c1 enqueued ($ID_C1)" || bad "c1 enqueue"
ID_C2=$(enqueue_id --priority 9 --tag c2 --worktree "$ROOT_T/repo2" -- sleep 3) && ok "c2 enqueued ($ID_C2)" || bad "c2 enqueue"
ID_C3=$(enqueue_id --priority 9 --tag c3 --worktree "$ROOT_T/repo1" -- sleep 3) && ok "c3 enqueued ($ID_C3)" || bad "c3 enqueue"

( env LITT_SUPERVISOR_MAX_LIGHT=3 LITT_SUPERVISOR_INTERVAL=1 bash "$SUP" run >"$ROOT_T/resident.out" 2>&1 & echo $! >"$ROOT_T/resident.pid" )
running_count=""
for _ in $(seq 1 40); do
  running_count=$(count_state running)
  [ "$running_count" = "2" ] && break
  sleep 1
done
check "two light agents run concurrently in distinct worktrees" "^2$" "$running_count"
check "same-worktree third task stays queued" "pending" "$(ftag queue c3 status)"
bash "$SUP" cancel "$ID_C3" >/dev/null 2>&1 && ok "same-worktree queued task cancelled cleanly" || bad "cancel c3"
for _ in $(seq 1 40); do
  [ -n "$(find_id done "$ID_C1")" ] && [ -n "$(find_id done "$ID_C2")" ] && break
  sleep 1
done
check "concurrent agents both reach done" "done" "$(fid done "$ID_C1" status)"
check "second concurrent agent reaches done" "done" "$(fid done "$ID_C2" status)"
kill "$(cat "$ROOT_T/resident.pid")" 2>/dev/null || true
sleep 1

# --- journal ---------------------------------------------------------------
[ -s "$LITT_SUPERVISOR_DIR/state/supervisor.log" ] && ok "journal written" || bad "journal missing"

echo "----------------------------------------"
echo "PASS=$PASS FAIL=$FAIL"
rm -rf "$ROOT_T"
[ "$FAIL" -eq 0 ]
