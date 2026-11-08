#!/usr/bin/env node
/**
 * Release-gate deployed-SHA parity check.
 *
 * The hourly gate samples a deployed service's self-reported commit and
 * compares it against the source tree. Two distinct failure modes must
 * stay failing, and one legitimate transition must stop failing:
 *
 *   FAIL  deployed SHA is "unknown"/"dev"/unreachable — the service cannot
 *         report its provenance at all.
 *   FAIL  deployed SHA is not in repo history — a build shipped from code
 *         that was never committed to main (untracked deployment).
 *   FAIL  deployed SHA is not an ancestor of HEAD — code from a different
 *         branch/line is serving production (untracked deployment).
 *   FAIL  (auto mode) deployed ancestor lag exceeds the deploy window —
 *         the service's deploy pipeline is genuinely stuck, not mid-rollout.
 *   PASS  deployed == expected SHA.
 *   PASS  (auto mode) deployed is an ancestor within the deploy window —
 *         a rollout in flight: replicas drain at different times and the
 *         gate samples mid-transition (golden run 41955317232 observed
 *         web=ccaa4cec while terminal/source were already at 289fddde —
 *         the previous commit — mid-rollout, not a failure).
 *   WARN  (manual mode) deployed is a tracked ancestor lagging the
 *         expected SHA — manual-deploy services (terminal) legitimately
 *         sit behind main between human-approved deploys; drift is
 *         reported, not failed.
 *
 * Usage:
 *   node check-deployed-sha.mjs --service <name> --deployed <sha> \
 *     --expect <sha> --mode <auto|manual> [--lag <n>]
 *
 * Exit 0 = pass or warn. Exit 1 = fail. Requires a full clone
 * (fetch-depth: 0) for the ancestry and lag checks.
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const args = { lag: 10 };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  args.lag = Number.parseInt(String(args.lag), 10);
  if (!Number.isFinite(args.lag) || args.lag < 0) args.lag = 10;
  return args;
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function shaPrefixMatches(deployed, expected) {
  const d = String(deployed).toLowerCase();
  const e = String(expected).toLowerCase();
  return d.length >= 7 && (d === e || e.startsWith(d) || d.startsWith(e));
}

export function checkDeployedSha({ service, deployed, expect, mode, lag }) {
  const name = service ?? "service";
  const deployedSha = String(deployed ?? "").trim();
  const expectedSha = String(expect ?? "").trim();

  if (!deployedSha || deployedSha === "unknown" || deployedSha === "dev") {
    return {
      ok: false,
      warn: false,
      message: `${name} health endpoint did not report a real SHA (got: ${deployedSha || "empty"})`,
    };
  }
  if (!expectedSha) {
    return { ok: false, warn: false, message: `${name} expected SHA was not provided` };
  }

  if (shaPrefixMatches(deployedSha, expectedSha)) {
    return { ok: true, warn: false, message: `${name} SHA matches expected (${expectedSha.slice(0, 8)})` };
  }

  // A tracked deployment names a commit that exists in this repo.
  if (git(["cat-file", "-e", `${deployedSha}^{commit}`]) === null && git(["rev-parse", "--verify", `${deployedSha}^{commit}`]) === null) {
    return {
      ok: false,
      warn: false,
      message: `${name} SHA not found in repo history: ${deployedSha} — possible untracked deployment`,
    };
  }
  // A legitimate deployment is an ancestor of the source HEAD — anything
  // else is a different line of code serving production.
  const ancestry = git(["merge-base", "--is-ancestor", deployedSha, "HEAD"]);
  if (ancestry === null) {
    return {
      ok: false,
      warn: false,
      message: `${name} SHA is not an ancestor of main: deployed=${deployedSha} — untracked deployment`,
    };
  }

  const lagCount = Number.parseInt(git(["rev-list", "--count", `${deployedSha}..${expectedSha}`]) ?? "NaN", 10);

  if (mode === "manual") {
    if (!Number.isFinite(lagCount)) {
      return { ok: false, warn: false, message: `${name} lag could not be measured (${deployedSha}..${expectedSha})` };
    }
    return {
      ok: true,
      warn: lagCount > 0,
      message: lagCount > 0
        ? `${name} behind expected commit: deployed=${deployedSha} expected=${expectedSha.slice(0, 8)} lag=${lagCount} commit(s) — tracked drift (manual deploy service); deploy via its deploy workflow when approved, not a gate failure`
        : `${name} deployed SHA ${deployedSha} contains the expected commit — deployed newer than expected, not a failure`,
    };
  }

  // auto mode: bounded deploy window — a mid-rollout ancestor is a
  // legitimate transition; lag beyond the window is a stuck pipeline.
  if (!Number.isFinite(lagCount)) {
    return { ok: false, warn: false, message: `${name} lag could not be measured (${deployedSha}..${expectedSha})` };
  }
  if (lagCount === 0) {
    return {
      ok: true,
      warn: false,
      message: `${name} deployed SHA ${deployedSha} contains the expected commit — deployed at or newer than expected`,
    };
  }
  if (lagCount > lag) {
    return {
      ok: false,
      warn: false,
      message: `${name} SHA lag exceeds deploy window: deployed=${deployedSha} expected=${expectedSha.slice(0, 8)} lag=${lagCount} > ${lag} commit(s) — deployment appears stuck`,
    };
  }
  return {
    ok: true,
    warn: true,
    message: `${name} mid-rollout: deployed=${deployedSha} is ${lagCount} commit(s) behind expected ${expectedSha.slice(0, 8)} — within deploy window of ${lag}`,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv);
  const result = checkDeployedSha(args);
  const icon = result.ok ? (result.warn ? "⚠️" : "✅") : "❌";
  console.log(`${icon} ${result.message}`);
  process.exit(result.ok ? 0 : 1);
}
