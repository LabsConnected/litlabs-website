#!/usr/bin/env python3
"""Read-only Railway variable fingerprint reporter.

Usage: railway-var-fingerprint.py <service> [VAR ...]

Runs `railway variable list --service <svc> --json`, then prints for each
requested var: presence, length, and a truncated SHA-256 fingerprint.
Secret values are NEVER printed. Non-secret URL vars listed in URL_VARS are
printed in full (they contain no credentials).
"""
import hashlib
import json
import subprocess
import sys

URL_VARS = {
    "TERMINAL_SERVER_INTERNAL_URL",
    "TERMINAL_SERVER_URL",
    "TERMINAL_PUBLIC_URL",
    "NEXT_PUBLIC_TERMINAL_HTTP_URL",
    "NEXT_PUBLIC_TERMINAL_WS_URL",
}


def collect_values(node, vals):
    if isinstance(node, dict):
        name = node.get("name")
        value = node.get("value")
        if isinstance(name, str) and isinstance(value, str):
            vals[name] = value
        for v in node.values():
            collect_values(v, vals)
    elif isinstance(node, list):
        for item in node:
            collect_values(item, vals)


def main():
    if len(sys.argv) < 2:
        print("usage: railway-var-fingerprint.py <service> [VAR ...]", file=sys.stderr)
        return 2
    service = sys.argv[1]
    wanted = sys.argv[2:] or ["TERMINAL_INTERNAL_SERVICE_KEY"]

    proc = subprocess.run(
        ["railway", "variable", "list", "--service", service, "--json"],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"SERVICE={service} ERROR variable-list-failed")
        return 0
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(f"SERVICE={service} ERROR json-parse-failed")
        return 0

    vals = {}
    collect_values(data, vals)
    print(f"SERVICE={service} var_count={len(vals)}")
    for name in sorted(vals):
        print(f"  HAS_VAR {name}")
    for name in sorted(set(wanted) | URL_VARS):
        value = vals.get(name)
        if value is None:
            print(f"  {name}: <absent>")
        elif name in URL_VARS:
            print(f"  {name}: {value}")
        else:
            fp = hashlib.sha256(value.encode()).hexdigest()[:16]
            print(f"  {name}: len={len(value)} sha256_16={fp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
