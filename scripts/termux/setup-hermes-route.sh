#!/data/data/com.termux/files/usr/bin/bash
# setup-hermes-route — configure Dex (LiTT on Termux) to prefer the
# Nitro 5 PC's Hermes model over Tailscale and fall back to the
# on-device model when the PC is unreachable.
#
# What it writes:
#   ~/.config/litt/termux.env  — route endpoints + models (managed block,
#                                idempotent; other keys preserved)
#   ~/.bashrc                  — "OLLAMA PC BLOCK" exporting the probe
#                                candidates so plain `litt` gets the same
#                                route order as `litt-local`
#
# Route order the litt CLI probe then applies (ollama-route.ts):
#   1. OLLAMA_LOCAL_URL  → PC Tailscale endpoint  (checked FIRST)
#   2. OLLAMA_LAN_URL    → on-device daemon       (checked SECOND)
#
# The probe re-runs per request, so the fallback and the reconnect are
# both automatic — no restart needed when the PC goes away or returns.
#
# Usage on the phone (after termux-sync pulls this file):
#   bash ~/litt-canonical/scripts/termux/setup-hermes-route.sh
#   bash ~/litt-canonical/scripts/termux/setup-hermes-route.sh --dry-run
#
set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

ENV_FILE="$HOME/.config/litt/termux.env"
ROUTES_FILE="$HOME/.config/litt/ollama-routes.env"
BASHRC="$HOME/.bashrc"
TS="$(date +%Y%m%d-%H%M%S)"

# ── Defaults (env overrides win; edit here if the network changes) ──
PC_LAN="${LITT_OLLAMA_LAN:-http://192.168.0.112:11434}"        # Nitro 5 on home Wi-Fi
PC_TAILSCALE="${LITT_OLLAMA_TAILSCALE:-http://100.107.123.73:11434}" # Nitro 5 Tailscale IP
PHONE_OLLAMA="${LITT_OLLAMA_DEVICE:-http://localhost:11434}"   # on-device daemon
PC_MODEL="${LITT_LOCAL_MODEL:-litt-hermes:32k}"                # everyday model on the PC
DEVICE_MODEL="${LITT_DEVICE_MODEL:-litt-oc-phone:1.7b-8k}"     # offline model on the phone
# ────────────────────────────────────────────────────────────────────

note() { printf '%s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '[dry-run] %s\n' "$*"
  else
    eval "$@"
  fi
}

note "=== LiTT Dex → PC Hermes route setup ==="
note "termux.env : $ENV_FILE"
note "bashrc     : $BASHRC"
note ""

# ── 0. Guards — variables that break the prefer-PC/fallback contract.
#
#   LITT_OLLAMA_URL : explicit override, short-circuits the probe to ONE
#                     endpoint — the device daemon would never be tried.
#   LITT_MODEL      : pins a single model tag. If it names a PC model,
#                     requests HARD-FAIL while the PC is down (the device
#                     daemon doesn't have it) instead of falling back;
#                     if it names the phone model, requests fail while
#                     the PC IS up (which only serves litt-hermes).
for f in "$ENV_FILE" "$ROUTES_FILE" "$BASHRC" "$HOME/.profile" "$HOME/.zshrc"; do
  for v in LITT_OLLAMA_URL LITT_MODEL; do
    if [ -f "$f" ] && grep -q "^[[:space:]]*export[[:space:]]\+$v=\|^[[:space:]]*$v=" "$f" 2>/dev/null; then
      note "⚠️  $v found in $f — it pins a single endpoint/model and"
      note "    DISABLES automatic PC↔device fallback. Remove that line, then re-run."
      exit 1
    fi
  done
done
for v in LITT_OLLAMA_URL LITT_MODEL; do
  if [ -n "${!v:-}" ]; then
    note "⚠️  $v is set in the current environment."
    note "    Unset it (it pins the route/model and breaks fallback), then re-run."
    exit 1
  fi
done

# ── 1. Back up before modifying.
mkdir -p "$HOME/.config/litt"
[ -f "$ENV_FILE" ]    && run "cp '$ENV_FILE' '$ENV_FILE.bak-$TS'"
[ -f "$ROUTES_FILE" ] && run "cp '$ROUTES_FILE' '$ROUTES_FILE.bak-$TS'"
[ -f "$BASHRC" ]      && run "cp '$BASHRC' '$BASHRC.bak-$TS'"
note "Backups written with suffix .bak-$TS (existing files only)."
note ""

# ── 2. ollama-routes.env managed block — CANONICAL route config, sourced
#      globally by .bashrc (and by litt-local) so every `litt` invocation
#      gets the same ordered candidates. Replace block if present.
touch "$ROUTES_FILE"
TMP_ROUTES="$(mktemp)"
awk '/^# >>> LITT DEX ROUTE >>>$/{skip=1} /^# <<< LITT DEX ROUTE <<<$/{skip=0;next} !skip' "$ROUTES_FILE" > "$TMP_ROUTES"
cat >> "$TMP_ROUTES" <<EOF
# >>> LITT DEX ROUTE >>>
# Dex route config — managed by scripts/termux/setup-hermes-route.sh.
# Probe candidates consumed by the litt CLI multi-route resolver
# (resolveOllamaRouteCandidates): tier endpoints…
export OLLAMA_TAILSCALE_URL="$PC_TAILSCALE"   # Nitro 5 via tailnet — anywhere
export OLLAMA_LAN_URL="$PC_LAN"               # Nitro 5 on home Wi-Fi
export OLLAMA_LOCAL_URL="$PHONE_OLLAMA"       # this phone's own daemon
# …and the order they're probed in. "tailscale,lan,local" = PC first
# (reachable from any network), then PC-LAN, then the on-device daemon
# as the offline fallback. The probe re-runs per request, so PC loss or
# recovery flips lanes automatically.
export OLLAMA_ROUTE_ORDER="tailscale,lan,local"
# <<< LITT DEX ROUTE <<<
EOF
run "cp '$TMP_ROUTES' '$ROUTES_FILE'"
rm -f "$TMP_ROUTES"
note "✓ ollama-routes.env route block written."

# ── 3. termux.env managed block — script-level probe targets + models.
touch "$ENV_FILE"
TMP_ENV="$(mktemp)"
awk '/^# >>> LITT DEX MODELS >>>$/{skip=1} /^# <<< LITT DEX MODELS <<<$/{skip=0;next} !skip' "$ENV_FILE" > "$TMP_ENV"
cat >> "$TMP_ENV" <<EOF
# >>> LITT DEX MODELS >>>
# Managed by scripts/termux/setup-hermes-route.sh.
export LITT_OLLAMA_LAN="$PC_LAN"
export LITT_OLLAMA_TAILSCALE="$PC_TAILSCALE"
export LITT_OLLAMA_DEVICE="$PHONE_OLLAMA"
export LITT_LOCAL_MODEL="$PC_MODEL"
export LITT_DEVICE_MODEL="$DEVICE_MODEL"
# <<< LITT DEX MODELS <<<
EOF
run "cp '$TMP_ENV' '$ENV_FILE'"
rm -f "$TMP_ENV"
note "✓ termux.env model block written."

# ── 4. .bashrc — ensure ollama-routes.env is sourced for plain `litt`
#        sessions (idempotent; many installs already have this line).
touch "$BASHRC"
if ! grep -q 'ollama-routes\.env' "$BASHRC"; then
  cat >> "$BASHRC" <<'EOF'
# >>> LITT OLLAMA ROUTES >>>
# Dex: ordered Ollama route candidates (PC-first, device fallback).
[ -f "$HOME/.config/litt/ollama-routes.env" ] && source "$HOME/.config/litt/ollama-routes.env"
# <<< LITT OLLAMA ROUTES <<<
EOF
  note "✓ .bashrc ollama-routes.env source line added."
else
  note "✓ .bashrc already sources ollama-routes.env."
fi

# ── 5. Verify: probe the candidates in the same order the CLI will.
note ""
note "=== VERIFY ==="
pc_ok=0
dev_ok=0
for label_ep in "PC LAN|$PC_LAN" "PC Tailscale|$PC_TAILSCALE" "device|$PHONE_OLLAMA"; do
  label="${label_ep%%|*}"; ep="${label_ep##*|}"
  if curl --max-time 3 -fsS "$ep/api/tags" >/dev/null 2>&1; then
    note "  ✓ $label reachable: $ep"
    case "$label" in PC*) pc_ok=1 ;; device) dev_ok=1 ;; esac
  else
    note "  ✗ $label unreachable: $ep"
    case "$label" in PC*) : ;; device) dev_ok=0 ;; esac
  fi
done

note ""
if [ "$pc_ok" = "1" ]; then
  note "Route: PC Hermes preferred ($PC_MODEL)."
elif [ "$dev_ok" = "1" ]; then
  note "Route: PC down — on-device fallback active ($DEVICE_MODEL)."
else
  note "Route: NOTHING reachable — start Ollama on the PC or the phone daemon."
fi
note ""
note "Reload your shell ('source ~/.bashrc') or run 'litt-local' to take"
note "the new route. 'litt-doctor' will show the active route under"
note "OLLAMA ROUTE."
