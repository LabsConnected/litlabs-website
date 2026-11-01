#!/usr/bin/env bash
#
# qa-browser.sh — thin shim over the cross-platform launcher.
# Kept so existing entry points (package.json script, Codex CLI registration)
# keep working. All guard logic lives in qa-launch.mjs.
#
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/qa-launch.mjs" "$@"
