#!/usr/bin/env bash
# Resolve an approved production deploy target to verified Railway IDs.
# Usage: railway-target.sh <target>   (prints KEY=VALUE lines; exits 1 on anything unknown)
# IDs verified read-only in the Railway dashboard on 2026-10-10.
set -euo pipefail

WEB_PROJECT="3d5b8abe-088c-4a6c-9b34-7054829247c9"   # litlabs-website
WEB_ENV="56de816e-3904-4b35-9dde-031303a6d5cb"       # production
TERM_PROJECT="69a241af-cd1b-4cf1-baff-f5a6a5a5d7d5"  # litlabs-terminal-server
TERM_ENV="41f9b3f4-c783-4288-a6d3-077b4e55858f"      # production

target="${1:-}"
case "$target" in
  website/terminal-server)       P=$WEB_PROJECT;  E=$WEB_ENV;  S="3c06dd64-e82f-4bb5-8c47-d65dede36af9" ;;
  website/litt-shell)            P=$WEB_PROJECT;  E=$WEB_ENV;  S="0fbedda0-0053-481c-9e4f-a3ea8100eb16" ;;
  website/cli)                   P=$WEB_PROJECT;  E=$WEB_ENV;  S="f71b9a86-cd1e-4c5a-ba00-b4efc0b6e119" ;;
  website/litt-models)           P=$WEB_PROJECT;  E=$WEB_ENV;  S="f9a906df-27df-433f-957d-c38862ba92ef" ;;
  website/voice-proxy)           P=$WEB_PROJECT;  E=$WEB_ENV;  S="879b842f-ed36-4b37-97cf-cbb9fd504b46" ;;
  terminal/web)                  P=$TERM_PROJECT; E=$TERM_ENV; S="a8a05220-e5ed-48f6-969d-1f82957341de" ;;
  terminal/litlabs-terminal-server) P=$TERM_PROJECT; E=$TERM_ENV; S="12f99b0a-e514-4c7c-99fe-651106b35e82" ;;
  terminal/litt-voice-worker)    P=$TERM_PROJECT; E=$TERM_ENV; S="763fe22d-f50e-4387-b26a-3f6918290b7a" ;;
  *) echo "::error::Unknown deploy target '$target'" >&2; exit 1 ;;
esac

uuid='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
for v in "$P" "$E" "$S"; do
  [[ "$v" =~ $uuid ]] || { echo "::error::Malformed or missing Railway ID for '$target'" >&2; exit 1; }
done
echo "project_id=$P"
echo "environment_id=$E"
echo "service_id=$S"
