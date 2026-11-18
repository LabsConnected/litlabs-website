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
import os
import subprocess
import sys

URL_VARS = {
    "TERMINAL_SERVER_INTERNAL_URL",
    "TERMINAL_SERVER_URL",
    "TERMINAL_PUBLIC_URL",
    "NEXT_PUBLIC_TERMINAL_HTTP_URL",
    "NEXT_PUBLIC_TERMINAL_WS_URL",
    "RAILWAY_GIT_COMMIT_SHA",
    # Non-secret provider/config knobs — safe to print in full.
    "GROQ_REQUEST_TOKEN_CEILING",
    "OPENROUTER_MODEL",
    "OPENROUTER_LEGACY_TAIL_MODELS",
    "GEMINI_MODEL",
    "GEMINI_MODELS",
    "GEMINI_PRIMARY_MODEL",
    "GEMINI_DISABLED",
}


def collect_values(node, vals):
    if isinstance(node, dict):
        # Shape A: {"name": "K", "value": "V"}
        name = node.get("name")
        value = node.get("value")
        if isinstance(name, str) and isinstance(value, str):
            vals[name] = value
        # Shape B: {"KEY": "value", ...} — UPPER_SNAKE string->string entries
        for k, v in node.items():
            if (
                isinstance(k, str)
                and k not in ("name", "value")
                and k.replace("_", "").isalnum()
                and k == k.upper()
                and isinstance(v, str)
                and k not in vals
            ):
                vals[k] = v
            else:
                collect_values(v, vals)
    elif isinstance(node, list):
        for item in node:
            collect_values(item, vals)


def list_services():
    proc = subprocess.run(["railway", "status", "--json"], capture_output=True, text=True)
    names = []
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return names

    def walk(o):
        if isinstance(o, dict):
            for k in ("name", "serviceName"):
                v = o.get(k)
                if isinstance(v, str) and v and v not in names:
                    names.append(v)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for i in o:
                walk(i)
    walk(data)
    return names


ALL_SERVICES = [
    "@litlabs/litt-shell",
    "terminal-server",
    "@litt/agent-core",
    "@litt/companion",
    "@litt/models",
    "litlabs-voice-proxy",
    "cli",
    "@litlabs/litt-cli",
]


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "--all-services":
        if len(sys.argv) > 2:
            wanted = sys.argv[2:]
        else:
            wanted = ["TERMINAL_INTERNAL_SERVICE_KEY", "TERMINAL_AUTH_SECRET"]
        for svc in ALL_SERVICES:
            subprocess.run(
                [sys.executable, __file__, svc] + wanted,
            )
        return 0
    service = sys.argv[1]
    wanted = sys.argv[2:] or ["TERMINAL_INTERNAL_SERVICE_KEY"]

    cmd = ["railway", "variable", "list", "--service", service, "--json"]
    env_name = os.environ.get("RAILWAY_ENV")
    if env_name:
        cmd += ["--environment", env_name]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip().replace("\n", " ")[:200]
        print(f"SERVICE={service} ERROR variable-list-failed rc={proc.returncode} {err}")
        return 0
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        print(f"SERVICE={service} ERROR json-parse-failed")
        return 0

    vals = {}
    collect_values(data, vals)
    print(f"SERVICE={service} var_count={len(vals)}")
    if not vals:
        # Debug shape only — keys, never values.
        def shape(o, depth=0):
            if depth > 4:
                return "..."
            if isinstance(o, dict):
                return {k: shape(v, depth + 1) for k, v in list(o.items())[:10]}
            if isinstance(o, list):
                return [shape(o[0], depth + 1)] if o else []
            return type(o).__name__
        print("  JSON_SHAPE:", json.dumps(shape(data))[:800])
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
