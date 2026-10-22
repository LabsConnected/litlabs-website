/**
 * Regression tests for the three documented false-success conditions in the
 * production deployment controls (#659):
 *
 *  1. Stale-PASS check-run race — a required-check gate that ordered runs by
 *     completed_at accepted an old success while a newer rerun was still
 *     queued/in_progress (or had failed). Gate is now a tested script that
 *     orders by started_at and requires status=completed, conclusion=success.
 *  2. Silent unverified deploy — the health-check step exited 0 with no
 *     signal for services that have no public health URL. Now an explicit
 *     ::warning:: + job-summary note marks the run UNVERIFIED.
 *  3. Audit-workflow false-"clean" — the detection workflow's trigger list
 *     and deploy-pattern matching were narrow enough that a real unauthorized
 *     deploy path (repository_dispatch, workflow_call indirection, package-
 *     runner or flag-separated railway invocations, GraphQL mutations) would
 *     still print "No unauthorized deployment paths found." The audit now
 *     flags any deploy-capable workflow outside deploy-production.yml.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts", "ci", "verify_required_checks.py");
const AUDIT_SCRIPT = join(REPO_ROOT, "scripts", "ci", "audit_deploy_paths.py");

const PYTHON_CANDIDATES: string[][] = [
  ["python3"],
  ["python"],
  ["py", "-3"],
];

function runPython(args: string[]): { status: number; output: string } {
  let lastError: unknown;
  for (const candidate of PYTHON_CANDIDATES) {
    const [cmd, ...prefix] = candidate;
    try {
      const output = execFileSync(cmd, [...prefix, ...args], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, output };
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        lastError = error;
        continue; // try next interpreter name
      }
      // Non-zero exit is a real result, not a spawn failure.
      return {
        status: typeof error?.status === "number" ? error.status : 1,
        output: `${error?.stdout ?? ""}${error?.stderr ?? ""}`,
      };
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No python interpreter found");
}

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "deploy-controls-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function runsFile(checkRuns: unknown[]): string {
  const dir = makeTempDir();
  const path = join(dir, "check-runs.json");
  writeFileSync(path, JSON.stringify(checkRuns));
  return path;
}

const run = (name: string, status: string, conclusion: string | null, startedAt: string, id = 1) => ({
  name,
  status,
  conclusion,
  started_at: startedAt,
  completed_at: status === "completed" ? startedAt : null,
  id,
});

const REQUIRED = "Build and Type Check|gitleaks";

describe("deploy-controls false-success regression", () => {
  it("script self-tests pass (embedded fixtures)", () => {
    expect(runPython([VERIFY_SCRIPT, "--self-test"]).status).toBe(0);
    expect(runPython([AUDIT_SCRIPT, "--self-test"]).status).toBe(0);
  });

  it("condition 1: stale PASS behind an in-flight rerun refuses deploy", () => {
    const file = runsFile([
      run("Build and Type Check", "completed", "success", "2026-10-21T00:00:00Z", 1),
      run("Build and Type Check", "in_progress", null, "2026-10-21T01:00:00Z", 2),
      run("gitleaks", "completed", "success", "2026-10-21T00:00:00Z", 3),
    ]);
    const result = runPython([VERIFY_SCRIPT, "--runs", file, "--required", REQUIRED]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("not completed");
  });

  it("condition 1: completed successes on the latest runs allow deploy", () => {
    const file = runsFile([
      run("Build and Type Check", "completed", "failure", "2026-10-21T00:00:00Z", 1),
      run("Build and Type Check", "completed", "success", "2026-10-21T01:00:00Z", 2),
      run("gitleaks", "completed", "success", "2026-10-21T00:30:00Z", 3),
    ]);
    expect(runPython([VERIFY_SCRIPT, "--runs", file, "--required", REQUIRED]).status).toBe(0);
  });

  it("condition 2: deploy workflow marks no-health-URL deploys explicitly UNVERIFIED", () => {
    const wf = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "deploy-production.yml"),
      "utf-8",
    );
    expect(wf).toContain("::warning::");
    expect(wf).toContain("GITHUB_STEP_SUMMARY");
    expect(wf).not.toContain("SHA verification skipped (verify manually in Railway)");
  });

  it("condition 1+2: deploy workflow gates through the scripted check gate", () => {
    const wf = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "deploy-production.yml"),
      "utf-8",
    );
    expect(wf).toContain("verify_required_checks.py");
    const script = readFileSync(VERIFY_SCRIPT, "utf-8");
    expect(script).toContain("started_at");
  });

  it("condition 3: audit flags every documented bypass shape", () => {
    const audit = readFileSync(AUDIT_SCRIPT, "utf-8");
    // Detection must cover the bypass forms that previously produced a clean report.
    for (const needle of ["up|deploy|redeploy", "serviceInstance(?:Deploy|Redeploy)", "deploymentTrigger"]) {
      expect(audit).toContain(needle);
    }
  });

  it("audit against the repository's real workflows is clean", () => {
    const result = runPython([AUDIT_SCRIPT, "--repo", REPO_ROOT]);
    expect(result.status).toBe(0);
    expect(result.output).toContain("No unauthorized deployment paths found");
  });

  it("audit workflow runs the script self-tests in CI", () => {
    const wf = readFileSync(
      join(REPO_ROOT, ".github", "workflows", "audit-deployment-controls.yml"),
      "utf-8",
    );
    expect(wf).toContain("--self-test");
    expect(wf).toContain("audit_deploy_paths.py");
  });
});
