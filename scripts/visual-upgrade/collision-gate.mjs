#!/usr/bin/env node
/**
 * design collision gate — every visual-upgrade batch must run this before
 * touching a file.
 *
 * Usage:
 *   node scripts/visual-upgrade/collision-gate.mjs <file> [<file> ...]
 *   node scripts/visual-upgrade/collision-gate.mjs --prs 278,334,340 -- <file> ...
 *   git diff --name-only origin/main...HEAD | node scripts/visual-upgrade/collision-gate.mjs --stdin
 *
 * Exit 0: no open PR touches any listed file (or no open PRs at all).
 * Exit 1: at least one listed file is also changed by an open PR — the report
 *         names the PR(s). Sequence after that PR merges, or rebase onto it.
 * Exit 2: usage error / GitHub API failure.
 *
 * Auth: uses GH_TOKEN env when set; otherwise mints a surrogate for
 * custom.github via the dynamic_credentials helper (same flow the CI
 * watchers use). No raw credentials are read, stored, or printed.
 */
import { execFileSync } from "node:child_process";

const REPO = "LabsConnected/litlabs-website";
const API = "https://api.github.com";

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error(
    "usage: collision-gate.mjs [--prs 278,334] [--json] [--stdin] <file> [<file> ...]",
  );
  process.exit(2);
}

/* ---------------- auth ---------------- */

function surrogateBearer() {
  const code = [
    "import sys",
    "sys.path.insert(0, '/opt/hatch/skills/skill-creator/bin')",
    "from dynamic_credentials import dynamic_credential_entry",
    "print(dynamic_credential_entry('custom.github', 'access_token')['surrogate'])",
  ].join("\n");
  try {
    const s = execFileSync("python3", ["-c", code], { encoding: "utf8", timeout: 30000 }).trim();
    return s.startsWith("hsurr:") ? s : null;
  } catch {
    return null;
  }
}

async function gapi(path) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "litt-collision-gate" };
  const url = API + path;
  if (process.env.GH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  } else {
    // Surrogate is replaced with the real token on approved egress; never raw here.
    const surrogate = surrogateBearer();
    if (!surrogate) {
      console.error("error: no GH_TOKEN and surrogate minting failed");
      process.exit(2);
    }
    headers.Authorization = `Bearer ${surrogate}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    console.error(`error: GitHub API ${res.status} for ${path}`);
    process.exit(2);
  }
  return res.json();
}

async function prFiles(prNumber, cache) {
  if (!cache.has(prNumber)) {
    const files = await gapi(`/repos/${REPO}/pulls/${prNumber}/files?per_page=300`);
    cache.set(
      prNumber,
      new Set(files.map((f) => f.filename)),
    );
  }
  return cache.get(prNumber);
}

/* ---------------- main ---------------- */

async function main() {
  const raw = process.argv.slice(2);
  let prFilter = null;
  let asJson = false;
  let fromStdin = false;
  const files = [];

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--prs") prFilter = (raw[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--json") asJson = true;
    else if (a === "--stdin") fromStdin = true;
    else if (a === "--") files.push(...raw.slice(i + 1)), (i = raw.length);
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else files.push(a);
  }

  if (fromStdin) {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    files.push(...data.split(/\s+/).filter(Boolean));
  }
  if (files.length === 0) usage("no files given");

  const prs = await gapi(`/repos/${REPO}/pulls?state=open&per_page=100`);
  const wanted = prFilter ? prs.filter((p) => prFilter.includes(String(p.number))) : prs;
  if (prFilter) {
    const missing = prFilter.filter((n) => !prs.some((p) => String(p.number) === n));
    if (missing.length) console.error(`note: PRs not open (skipped): ${missing.join(", ")}`);
  }

  const cache = new Map();
  const collisions = [];
  for (const pr of wanted) {
    const changed = await prFiles(pr.number, cache);
    const hit = files.filter((f) => changed.has(f));
    if (hit.length) {
      collisions.push({
        pr: pr.number,
        title: pr.title,
        branch: pr.head?.ref,
        author: pr.user?.login,
        files: hit,
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ files, openPrsChecked: wanted.map((p) => p.number), collisions }, null, 2));
  } else {
    console.log(`checked ${files.length} file(s) against ${wanted.length} open PR(s)`);
    if (!collisions.length) {
      console.log("OK — no collisions");
    } else {
      console.log("COLLISIONS FOUND:");
      for (const c of collisions) {
        console.log(`\n  PR #${c.pr} "${c.title}" (${c.branch}, by ${c.author})`);
        for (const f of c.files) console.log(`    - ${f}`);
      }
      console.log("\nSequence these files after the PR merges, or rebase onto it.");
    }
  }
  process.exit(collisions.length ? 1 : 0);
}

main().catch((e) => {
  console.error("error:", e.message || e);
  process.exit(2);
});
