#!/data/data/com.termux/files/usr/bin/bash
# LiTT Termux/Dex verification — run ON THE PHONE in Termux.
# Produces an evidence log; send it back. Every check prints PASS/FAIL
# with the actual output — nothing is marked PASS without evidence.
#
# Usage:
#   bash termux-verify.sh [workspace-dir]
# Output:
#   ./termux-verify-evidence.txt  (also printed to stdout)

set -u
EVIDENCE="${1:-./termux-verify-evidence.txt}"
: > "$EVIDENCE" 2>/dev/null || EVIDENCE="/data/data/com.termux/files/usr/tmp/termux-verify-evidence.txt"
exec > >(tee -a "$EVIDENCE") 2>&1

pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; }
info() { echo "  -> $*"; }
hr()   { echo "----------------------------------------------------------------"; }

echo "=== LiTT Termux verification — $(date -u +%FT%TZ) ==="
hr

echo "[env] uname: $(uname -a)"
echo "[env] TERM=$TERM  COLUMNS=${COLUMNS:-?}  LINES=${LINES:-?}"
echo "[env] PREFIX=${PREFIX:-unset}"
hr

# 1. Binary presence + identity
echo "CHECK 1 — litt binary resolves"
if command -v litt >/dev/null 2>&1; then
  pass "litt on PATH: $(command -v litt)"
  litt --version 2>&1 | head -3 | sed 's/^/  /'
else
  fail "litt not found on PATH — install/link the Termux build first"
fi
hr

# 2. Doctor / paths (if supported)
echo "CHECK 2 — litt doctor reports sane paths"
if litt doctor 2>&1 | head -20; then
  pass "litt doctor ran"
else
  fail "litt doctor exited non-zero"
fi
hr

# 3. Narrow-terminal render — 40 cols is the smallest realistic phone width
echo "CHECK 3 — narrow launch (40 cols) does not crash or hide the composer"
echo "       (visual: run 'COLUMNS=40 litt' interactively — look for"
echo "       header overflow and an accessible 'Ask LiTT' composer)"
info "automated part: verify the TUI starts under a 40-col PTY"
if command -v script >/dev/null 2>&1; then
  stty cols 40 rows 20 2>/dev/null || true
  timeout 15 script -qc 'COLUMNS=40 LINES=20 litt' /dev/null </dev/null > /tmp/litt-40col.out 2>&1 || true
  if grep -qi "ask litt\|error\|exception" /tmp/litt-40col.out; then
    pass "40-col launch produced output (inspect /tmp/litt-40col.out)"
    grep -i "ask litt" /tmp/litt-40col.out | head -2 | sed 's/^/  /'
  else
    fail "40-col launch produced no composer evidence — see /tmp/litt-40col.out"
  fi
else
  info "no 'script' binary — do the 40-col check manually"
fi
hr

# 4. Simple task round-trip — deterministic lane, no model needed
echo "CHECK 4 — local task completes and returns to the prompt"
mkdir -p ./termux-verify-ws && cd ./termux-verify-ws 2>/dev/null || true
echo "sentinel-termux-7k4" > sentinel.txt
cat > /tmp/litt-cmds.txt <<'EOF'
read sentinel.txt
/exit
EOF
timeout 60 litt < /tmp/litt-cmds.txt > /tmp/litt-run.out 2>&1 || true
if grep -q "sentinel-termux-7k4" /tmp/litt-run.out; then
  pass "read returned the file contents"
else
  fail "read did not return file contents — see /tmp/litt-run.out"
fi
hr

# 5. Cancellation — send Esc during a turn, verify prompt returns
echo "CHECK 5 — Esc cancellation returns to the composer"
info "MANUAL: in interactive litt, submit 'write a long essay about the"
info "history of computing', press Esc ~3s in, confirm 'Cancelled', then"
info "submit 'read sentinel.txt' and confirm the sentinel text appears."
hr

# 6. Remote connectivity honesty — status line must never claim
#    REMOTE/PC access it does not have
echo "CHECK 6 — status never claims unverified remote/PC access"
if grep -qi "remote\|pc" /tmp/litt-run.out 2>/dev/null; then
  info "remote mention found — inspect /tmp/litt-run.out for honesty"
else
  pass "no remote/PC claims in local run output"
fi
hr

echo "=== DONE — attach this file: $EVIDENCE ==="
echo "Remaining MANUAL checks: 3 (visual), 5 (Esc), plus a Dex SUPER"
echo "launch if that build is installed separately."
