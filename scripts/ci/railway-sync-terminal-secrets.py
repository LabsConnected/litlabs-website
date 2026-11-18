#!/usr/bin/env python3
"""Sync TERMINAL_INTERNAL_SERVICE_KEY + TERMINAL_AUTH_SECRET from the
terminal-server service to the web service (@litlabs/litt-shell) on the
staging Railway project — values are passed via stdin and NEVER printed.

Prints only fingerprints (sha256_16 + length) before and after.
"""
import hashlib
import json
import subprocess
import sys

import os

SOURCE = os.environ.get("SYNC_SOURCE", "terminal-server")
TARGET = os.environ.get("SYNC_TARGET", "@litlabs/litt-shell")
RAILWAY_ENV = os.environ.get("RAILWAY_ENV") or None
VARS = ["TERMINAL_INTERNAL_SERVICE_KEY", "TERMINAL_AUTH_SECRET"]


def get_vars(service):
    proc = subprocess.run(
        ["railway", "variable", "list", "--service", service, "--json"]
        + (["--environment", RAILWAY_ENV] if RAILWAY_ENV else []),
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"ERROR: variable list failed for {service}")
        sys.exit(1)
    data = json.loads(proc.stdout)
    vals = {}

    def walk(o):
        if isinstance(o, dict):
            n, v = o.get("name"), o.get("value")
            if isinstance(n, str) and isinstance(v, str):
                vals[n] = v
            for k, v2 in o.items():
                if (
                    isinstance(k, str)
                    and k not in ("name", "value")
                    and k == k.upper()
                    and k.replace("_", "").isalnum()
                    and isinstance(v2, str)
                ):
                    vals.setdefault(k, v2)
                else:
                    walk(v2)
        elif isinstance(o, list):
            for i in o:
                walk(i)

    walk(data)
    return vals


def fp(v):
    return f"len={len(v)} sha256_16={hashlib.sha256(v.encode()).hexdigest()[:16]}"


def set_var(service, name, value):
    proc = subprocess.run(
        ["railway", "variable", "set", name, "--service", service, "--stdin"]
        + (["--environment", RAILWAY_ENV] if RAILWAY_ENV else []),
        input=value, capture_output=True, text=True,
    )
    if proc.returncode != 0:
        print(f"ERROR: set {name} on {service} failed: {proc.stderr.strip()[:200]}")
        sys.exit(1)
    print(f"  set {name} on {service} (value not shown)")


def main():
    src = get_vars(SOURCE)
    dst = get_vars(TARGET)
    for name in VARS:
        s, d = src.get(name, ""), dst.get(name, "")
        print(f"BEFORE {name}: source({SOURCE}) {fp(s) if s else '<absent>'} | target({TARGET}) {fp(d) if d else '<absent>'}")
        if not s:
            print(f"ERROR: {name} absent on {SOURCE} — aborting")
            sys.exit(1)
        if s == d:
            print(f"  {name} already in sync — skipping")
            continue
        set_var(TARGET, name, s)

    dst2 = get_vars(TARGET)
    ok = True
    for name in VARS:
        match = dst2.get(name, "") == src.get(name, "")
        ok = ok and match
        print(f"AFTER  {name}: {'MATCH' if match else 'STILL-MISMATCH'} target={fp(dst2.get(name,'')) if dst2.get(name) else '<absent>'}")
    print("VERDICT:", "SYNCED" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
