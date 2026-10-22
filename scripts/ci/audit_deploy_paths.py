#!/usr/bin/env python3
"""Audit deployment controls — detection only, never deploys.

Two jobs, both fail-closed:

1. Find deploy capability in any workflow other than the controlled one.
   A workflow has "deploy capability" if its text can drive a Railway
   deployment: the railway CLI deploy verbs (including behind flags or a
   package runner like `npx @railway/cli`) or Railway's deploy GraphQL
   mutations. Any deploy-capable workflow that is not
   deploy-production.yml is an unauthorized path — a nightly "clean" result
   while such a file exists is a false success.

2. Verify the controlled workflow itself still has every gate:
   workflow_dispatch-only triggers, the explicit authorization input, the
   protected `production` environment on the deploy job, the scripted
   required-checks gate (started_at ordering — see verify_required_checks.py),
   and an explicit ::warning:: + job-summary note when a service has no
   health URL (an unverified deploy must never look identical to a
   confirmed one).

Usage:
    audit_deploy_paths.py --repo <repo root>
    audit_deploy_paths.py --self-test
"""

import argparse
import glob
import os
import re
import sys

import yaml

CONTROLLED_WORKFLOW = "deploy-production.yml"
AUDIT_WORKFLOW = "audit-deployment-controls.yml"
DEPRECATED_WORKFLOW = "deploy-terminal.yml"

# Deploy capability: railway CLI deploy verbs (any flag order, any runner) or
# Railway deploy GraphQL mutations. Deliberately broad — this audit exists to
# catch paths a reviewer didn't notice.
DEPLOY_PATTERNS = [
    # railway ... up|deploy|redeploy on one line (covers `railway up`,
    # `railway --json up`, `npx @railway/cli up`, `railway redeploy --service x`)
    re.compile(r"\brailway\b[^#\n&|;]*\b(?:up|deploy|redeploy)\b", re.IGNORECASE),
    # Railway GraphQL deploy mutations (backboard / public API)
    re.compile(
        r"serviceInstance(?:Deploy|Redeploy)"
        r"|deploymentTrigger(?:Create|Deploy)"
        r"|environmentTriggersDeploy",
        re.IGNORECASE,
    ),
]


def _workflow_files(workflows_dir):
    files = sorted(
        glob.glob(os.path.join(workflows_dir, "*.yml"))
        + glob.glob(os.path.join(workflows_dir, "*.yaml"))
    )
    return files


def _has_deploy_capability(text):
    return any(pattern.search(text) for pattern in DEPLOY_PATTERNS)


def _triggers(doc):
    """Normalize the `on:` section to a set of trigger names. PyYAML parses
    the bare key `on` as True (YAML 1.1), so check both spellings."""
    on = doc.get(True, doc.get("on", {})) or {}
    if isinstance(on, str):
        return {on}
    if isinstance(on, list):
        return set(on)
    if isinstance(on, dict):
        return set(on.keys())
    return set()


def audit_unauthorized_paths(workflows_dir):
    """Return a list of findings (strings). Empty = clean."""
    findings = []
    for path in _workflow_files(workflows_dir):
        name = os.path.basename(path)
        if name in (CONTROLLED_WORKFLOW, AUDIT_WORKFLOW):
            continue
        with open(path, encoding="utf-8") as handle:
            text = handle.read()
        if not _has_deploy_capability(text):
            continue
        try:
            doc = yaml.safe_load(text) or {}
        except yaml.YAMLError:
            findings.append(
                f"{name}: deploy-capable workflow could not be parsed — refusing a clean result"
            )
            continue
        triggers = _triggers(doc)
        findings.append(
            f"{name}: contains deploy capability outside the controlled workflow "
            f"(triggers: {sorted(triggers) or 'none'})"
        )
        if "environment:" not in text:
            findings.append(
                f"{name}: deploy capability is not behind a protected environment"
            )
    return findings


def audit_controlled_workflow(workflows_dir):
    findings = []
    path = os.path.join(workflows_dir, CONTROLLED_WORKFLOW)
    if not os.path.exists(path):
        return [f"{CONTROLLED_WORKFLOW}: missing — no controlled deployment path exists"]
    with open(path, encoding="utf-8") as handle:
        text = handle.read()
    doc = yaml.safe_load(text) or {}
    triggers = _triggers(doc)
    if triggers != {"workflow_dispatch"}:
        findings.append(
            f"{CONTROLLED_WORKFLOW}: must trigger on workflow_dispatch only, found {sorted(triggers)}"
        )
    on = doc.get(True, doc.get("on", {})) or {}
    inputs = (on.get("workflow_dispatch") or {}).get("inputs") or {}
    if "authorization" not in inputs:
        findings.append(
            f"{CONTROLLED_WORKFLOW}: must require the explicit authorization input"
        )
    deploy = (doc.get("jobs") or {}).get("deploy") or {}
    env = deploy.get("environment")
    env_name = env.get("name") if isinstance(env, dict) else env
    if env_name != "production":
        findings.append(
            f"{CONTROLLED_WORKFLOW}: deploy job must use the protected `production` environment"
        )
    # Required-checks gate must run through the tested script so the
    # started_at / completed-status ordering can't be silently reverted.
    if "verify_required_checks.py" not in text:
        findings.append(
            f"{CONTROLLED_WORKFLOW}: required-checks gate must run "
            "scripts/ci/verify_required_checks.py (the started_at fail-closed gate)"
        )
    # A service with no health URL must be an explicit UNVERIFIED warning,
    # not a silent pass that looks identical to a confirmed deployment.
    if "::warning::" not in text or "GITHUB_STEP_SUMMARY" not in text:
        findings.append(
            f"{CONTROLLED_WORKFLOW}: services with no health URL must emit a "
            "::warning:: and a job-summary note (no silent unverified pass)"
        )

    deprecated = os.path.join(workflows_dir, DEPRECATED_WORKFLOW)
    if os.path.exists(deprecated):
        with open(deprecated, encoding="utf-8") as handle:
            old_text = handle.read()
        if _has_deploy_capability(old_text):
            findings.append(
                f"{DEPRECATED_WORKFLOW}: deprecated workflow still contains deploy capability"
            )
        try:
            old_doc = yaml.safe_load(old_text) or {}
            old_triggers = _triggers(old_doc)
            if "push" in old_triggers or "schedule" in old_triggers:
                findings.append(
                    f"{DEPRECATED_WORKFLOW}: must not have push/schedule triggers"
                )
        except yaml.YAMLError:
            findings.append(f"{DEPRECATED_WORKFLOW}: could not be parsed")
    return findings


def run_audit(repo_root):
    workflows_dir = os.path.join(repo_root, ".github", "workflows")
    findings = audit_unauthorized_paths(workflows_dir) + audit_controlled_workflow(workflows_dir)
    for finding in findings:
        print(f"::error::{finding}")
    if findings:
        return 1
    print("No unauthorized deployment paths found.")
    print(
        f"{CONTROLLED_WORKFLOW}: manual-only, authorization input present, "
        "production environment required, scripted fail-closed check gate, "
        "explicit unverified-deploy warning"
    )
    return 0


# --------------------------------------------------------------------------
# Self test: each fixture asserts an expected verdict against a temp dir.
# --------------------------------------------------------------------------

CONTROLLED_FIXTURE = """name: Deploy to Production (manual, CI-gated, approval-required)
on:
  workflow_dispatch:
    inputs:
      authorization:
        required: true
        type: string
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: python3 scripts/ci/verify_required_checks.py --runs runs.json --required "x"
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: production
    steps:
      - run: |
          if [ -z "$HEALTH_URL" ]; then
            echo "::warning::unverified" 
            echo "warn" >> "$GITHUB_STEP_SUMMARY"
          fi
"""


def _write(directory, name, text):
    with open(os.path.join(directory, name), "w", encoding="utf-8") as handle:
        handle.write(text)


def self_test():
    import tempfile

    failures = 0

    def check(description, extra_files, expect_findings):
        with tempfile.TemporaryDirectory() as tmp:
            wf_dir = os.path.join(tmp, ".github", "workflows")
            os.makedirs(wf_dir)
            _write(wf_dir, CONTROLLED_WORKFLOW, CONTROLLED_FIXTURE)
            for name, text in extra_files.items():
                _write(wf_dir, name, text)
            findings = audit_unauthorized_paths(wf_dir) + audit_controlled_workflow(wf_dir)
        got_bad = bool(findings)
        if got_bad != expect_findings:
            failures += 1
            print(f"SELF-TEST FAIL: {description} — findings={findings}")
        else:
            print(f"self-test pass: {description}")

    check("controlled workflow only is clean", {}, False)
    check(
        "push-triggered railway up is flagged",
        {"evil.yml": "on: push\njobs:\n  d:\n    steps:\n      - run: railway up --ci\n"},
        True,
    ),
    check(
        "scheduled npx @railway/cli deploy is flagged",
        {"evil.yml": "on: schedule\njobs:\n  d:\n    steps:\n      - run: npx --yes @railway/cli up\n"},
        True,
    ),
    check(
        "repository_dispatch with flags between railway and verb is flagged",
        {"evil.yml": "on: repository_dispatch\njobs:\n  d:\n    steps:\n      - run: railway --json up --service x\n"},
        True,
    ),
    check(
        "reusable-workflow indirection (workflow_call) is flagged",
        {"evil.yml": "on: workflow_call\njobs:\n  d:\n    steps:\n      - run: railway redeploy --service x\n"},
        True,
    ),
    check(
        "Railway GraphQL deploy mutation via curl is flagged",
        {"evil.yml": "on: schedule\njobs:\n  d:\n    steps:\n      - run: curl -X POST $B -d '{\"query\":\"mutation { serviceInstanceDeploy }\"}'\n"},
        True,
    ),
    check(
        "dispatch-only deploy without the protected environment is flagged",
        {"evil.yml": "on: workflow_dispatch\njobs:\n  d:\n    steps:\n      - run: railway up --ci\n"},
        True,
    ),
    check(
        "non-deploy railway command is clean",
        {"ok.yml": "on: push\njobs:\n  d:\n    steps:\n      - run: railway link --project $P --environment $E\n"},
        False,
    ),
    check(
        "unparseable deploy-capable workflow refuses clean",
        {"evil.yml": "on: [push\njobs:\n  d:\n    steps:\n      - run: railway up\n"},
        True,
    ),

    if failures:
        print(f"{failures} self-test failure(s)")
        return 1
    print("audit_deploy_paths self-test: PASS")
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".", help="Repository root")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    return run_audit(args.repo)


if __name__ == "__main__":
    sys.exit(main())
