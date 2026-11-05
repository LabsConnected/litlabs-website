import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regression coverage for scripts/ci/check-deployed-sha.mjs — the release
 * gate's deployed-SHA parity logic. Spawns the real script against a
 * synthetic git repo so the ancestry/lag logic is exercised end-to-end,
 * including the mid-rollout ancestor case that produced eight consecutive
 * hourly false failures (release-gate runs 41955317232 and predecessors).
 */

const SCRIPT = path.resolve(__dirname, "../scripts/ci/check-deployed-sha.mjs");

let repo: string;
let headSha: string;
let midSha: string;
let oldSha: string;
let sideSha: string;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function commit(file: string, content: string, message: string): string {
  writeFileSync(path.join(repo, file), content);
  git(["add", file]);
  git(["commit", "-m", message]);
  return git(["rev-parse", "HEAD"]);
}

function runGate(args: string[]) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: repo, encoding: "utf8" });
}

beforeAll(() => {
  repo = mkdtempSync(path.join(tmpdir(), "release-gate-"));
  git(["init", "-b", "main"]);
  git(["config", "user.email", "gate@test"]);
  git(["config", "user.name", "Gate Test"]);
  oldSha = commit("a.txt", "a", "c1");
  // 11 intervening commits so the oldest SHA sits outside the default
  // 10-commit deploy window.
  for (let i = 2; i <= 12; i++) commit("a.txt", `a${i}`, `c${i}`);
  midSha = git(["rev-parse", "HEAD~1"]);
  headSha = commit("a.txt", "final", "head");
  // A commit on a divergent branch — never merged into main.
  git(["checkout", "-b", "side", midSha]);
  sideSha = commit("side.txt", "side", "side-commit");
  git(["checkout", "main"]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-deployed-sha (auto mode — auto-deploy services like web)", () => {
  it("passes when deployed equals HEAD", () => {
    const r = runGate(["--service", "web", "--deployed", headSha, "--expect", headSha, "--mode", "auto"]);
    expect(r.status).toBe(0);
  });

  it("passes when deployed equals HEAD as an 8-char prefix", () => {
    const r = runGate(["--service", "web", "--deployed", headSha.slice(0, 8), "--expect", headSha, "--mode", "auto"]);
    expect(r.status).toBe(0);
  });

  it("passes a mid-rollout ancestor inside the deploy window", () => {
    const r = runGate(["--service", "web", "--deployed", midSha.slice(0, 8), "--expect", headSha, "--mode", "auto"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("mid-rollout");
  });

  it("fails a deployment lagging beyond the deploy window", () => {
    const r = runGate(["--service", "web", "--deployed", oldSha, "--expect", headSha, "--mode", "auto", "--lag", "10"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("lag exceeds deploy window");
  });

  it("honors a widened deploy window", () => {
    const r = runGate(["--service", "web", "--deployed", oldSha, "--expect", headSha, "--mode", "auto", "--lag", "20"]);
    expect(r.status).toBe(0);
  });

  it("fails a non-ancestor SHA (untracked deployment)", () => {
    const r = runGate(["--service", "web", "--deployed", sideSha, "--expect", headSha, "--mode", "auto"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("not an ancestor");
  });

  it("fails a SHA absent from repo history", () => {
    const r = runGate(["--service", "web", "--deployed", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", "--expect", headSha, "--mode", "auto"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("not found in repo history");
  });

  it("fails unknown/dev/unreachable reported SHAs", () => {
    for (const bad of ["unknown", "dev", ""]) {
      const r = runGate(["--service", "web", "--deployed", bad, "--expect", headSha, "--mode", "auto"]);
      expect(r.status).toBe(1);
    }
  });
});

describe("check-deployed-sha (manual mode — manual-deploy services like terminal)", () => {
  it("warns, not fails, on tracked drift", () => {
    const r = runGate(["--service", "terminal", "--deployed", midSha, "--expect", headSha, "--mode", "manual"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("lag=");
  });

  it("still fails untracked deployments", () => {
    const r = runGate(["--service", "terminal", "--deployed", sideSha, "--expect", headSha, "--mode", "manual"]);
    expect(r.status).toBe(1);
    const missing = runGate(["--service", "terminal", "--deployed", "unknown", "--expect", headSha, "--mode", "manual"]);
    expect(missing.status).toBe(1);
  });
});
