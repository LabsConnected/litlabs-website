#!/usr/bin/env python3
"""Required-check gate for deploy-production.yml.

Reads a check-runs JSON payload (shape of the GitHub
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` response, i.e. an object
with a "check_runs" array, or a bare array of check-run objects) and decides,
per required check name, whether the *truly latest* run is a completed
success.

False-success condition this guards: a rerun that is queued or in_progress
has no completed_at, so ordering by completed_at hides it behind an older
completed success — the gate would accept a stale PASS while a fresh run is
in flight (or has since failed). We order by started_at instead (set the
moment a run is created) and refuse anything whose latest run is not a
completed "success".

Usage:
    verify_required_checks.py --runs runs.json --required "Check A|Check B"
    verify_required_checks.py --self-test

Exit code 0 = every required check is a completed success on the latest run.
Exit code 1 = refuse to deploy (any missing / in-flight / non-success check,
or a self-test failure).
"""

import argparse
import json
import sys


def load_runs(path):
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict):
        payload = payload.get("check_runs")
    if not isinstance(payload, list):
        raise ValueError("check-runs payload must be a list or an object with 'check_runs'")
    return payload


def evaluate_required_checks(check_runs, required_names):
    """Return (ok, messages). ok=True only if every name's latest run by
    started_at is completed with conclusion == "success"."""
    ok = True
    messages = []
    for name in required_names:
        candidates = [r for r in check_runs if isinstance(r, dict) and r.get("name") == name]
        if not candidates:
            ok = False
            messages.append(
                f"::error::Required check '{name}' has no run on this commit. Refusing to deploy."
            )
            continue
        latest = max(candidates, key=lambda r: (r.get("started_at") or "", r.get("id") or 0))
        status = latest.get("status")
        conclusion = latest.get("conclusion") or "missing"
        messages.append(f"{name}: status={status} conclusion={conclusion}")
        if status != "completed":
            ok = False
            messages.append(
                f"::error::Required check '{name}' latest run is '{status}', not completed. "
                "Refusing to deploy on a stale or in-progress result."
            )
        elif conclusion != "success":
            ok = False
            messages.append(
                f"::error::Required check '{name}' concluded '{conclusion}'. Refusing to deploy."
            )
    return ok, messages


def _run(name, status, conclusion, started_at, run_id=1):
    return {
        "name": name,
        "status": status,
        "conclusion": conclusion,
        "started_at": started_at,
        "completed_at": started_at if status == "completed" else None,
        "id": run_id,
    }


def self_test():
    cases = [
        # (description, check_runs, expected_ok)
        (
            "single completed success passes",
            [_run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z")],
            True,
        ),
        (
            "missing run refuses",
            [],
            False,
        ),
        (
            "stale PASS with in-flight rerun refuses (the race this fix closed)",
            [
                _run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "in_progress", None, "2026-10-21T01:00:00Z", 2),
            ],
            False,
        ),
        (
            "stale PASS with queued rerun refuses",
            [
                _run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "queued", None, "2026-10-21T01:00:00Z", 2),
            ],
            False,
        ),
        (
            "stale PASS with newer failed rerun refuses",
            [
                _run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "completed", "failure", "2026-10-21T01:00:00Z", 2),
            ],
            False,
        ),
        (
            "newer completed success after older failure passes",
            [
                _run("Build and Type Check", "completed", "failure", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "completed", "success", "2026-10-21T01:00:00Z", 2),
            ],
            True,
        ),
        (
            "cancelled latest run refuses",
            [
                _run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "completed", "cancelled", "2026-10-21T01:00:00Z", 2),
            ],
            False,
        ),
        (
            "same-name run from another suite still must be latest-completed-success",
            [
                _run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
                _run("Build and Type Check", "completed", "success", "2026-10-21T01:00:00Z", 2),
            ],
            True,
        ),
    ]
    failures = 0
    for description, check_runs, expected_ok in cases:
        ok, _ = evaluate_required_checks(check_runs, ["Build and Type Check"])
        if ok != expected_ok:
            failures += 1
            print(f"SELF-TEST FAIL: {description} (expected ok={expected_ok}, got {ok})")
        else:
            print(f"self-test pass: {description}")
    # multi-name gate: one green + one missing must refuse
    ok, _ = evaluate_required_checks(
        [_run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z")],
        ["Build and Type Check", "gitleaks"],
    )
    if ok:
        failures += 1
        print("SELF-TEST FAIL: multi-name gate accepted a missing required check")
    else:
        print("self-test pass: multi-name gate refuses on missing required check")
    if failures:
        print(f"{failures} self-test failure(s)")
        return 1
    print("verify_required_checks self-test: PASS")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", help="Path to check-runs JSON (API response or bare array)")
    parser.add_argument("--required", help="Pipe-separated required check names")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return self_test()
    if not args.runs or not args.required:
        parser.error("--runs and --required are required unless --self-test")

    try:
        check_runs = load_runs(args.runs)
    except Exception as exc:  # fail closed: unreadable payload is not a pass
        print(f"::error::Could not parse check-runs payload: {exc}. Refusing to deploy.")
        return 1

    required_names = [n for n in args.required.split("|") if n]
    ok, messages = evaluate_required_checks(check_runs, required_names)
    for message in messages:
        print(message)
    if not ok:
        print(
            "::error::A required CI check is not a green, completed run on this commit. "
            "Refusing to deploy."
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
