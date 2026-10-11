#!/usr/bin/env bash
# Fail closed unless the service ID is listed in the project/environment. Read-only; never deploys.
# Usage: railway-validate.sh <project_id> <environment_id> <service_id>
set -euo pipefail
P="${1:?project id required}"; E="${2:?environment id required}"; S="${3:?service id required}"
out=$(railway service list --project "$P" --environment "$E" --json 2>&1) || {
  echo "::error::Could not list services for project $P / env $E. Refusing to deploy." >&2; exit 1; }
if ! printf '%s' "$out" | grep -q "\"$S\""; then
  echo "::error::Service $S not found in project $P / env $E. Refusing to deploy." >&2; exit 1
fi
echo "Target validated: service $S exists in project $P / env $E"
