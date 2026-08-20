/**
 * LITT_PERF benchmark — measures key operator-experience code paths
 * without requiring the full Ink TUI (which needs a TTY).
 *
 * Exercises:
 *   - Intent classification (classifyIntent)
 *   - Local fast lane (tryLocalFastLane) — if available on this branch
 *   - Tool registry execution for read-only project queries
 *
 * Usage: node --import tsx packages/litt-cli/scripts/bench-litt-perf.mjs
 *
 * Output: $env:TEMP\litt-perf-baseline.log (and stdout)
 */

import { performance } from "node:perf_hooks";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Queries ───────────────────────────────────────────────────────

const QUERIES = [
  "whats up",
  "what branch am i on",
  "what framework is this",
  "inspect this repo and tell me the framework and branch",
  "scan this repo and tell me what needs attention",
  "exit",
];

// ─── Helpers ───────────────────────────────────────────────────────

function fmtMs(ms) {
  return ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(0)}ms`;
}

async function time(fn) {
  const t0 = performance.now();
  const result = await fn();
  const t1 = performance.now();
  return { ms: t1 - t0, result };
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const repoRoot = process.cwd();
  const lines = [];
  const log = (s) => { lines.push(s); console.log(s); };

  log("=== LITT_PERF BASELINE BENCHMARK ===");
  log(`Date: ${new Date().toISOString()}`);
  log(`Branch: ${await getBranch()}`);
  log(`Repo: ${repoRoot}`);
  log("");

  // ─── 1. Intent Classification ────────────────────────────────
  log("--- Intent Classification ---");
  const { classifyIntent } = await import("../src/lib/intent.ts");
  for (const q of QUERIES) {
    const { ms, result } = await time(() => classifyIntent(q));
    log(`  [${fmtMs(ms)}] "${q}" → ${result}`);
  }
  log("");

  // ─── 2. Local Fast Lane (if available) ───────────────────────
  log("--- Local Fast Lane ---");
  let fastLaneAvailable = false;
  let matchLocalFastPath = null;
  try {
    const mod = await import("../src/lib/local-fast-lane.ts");
    matchLocalFastPath = mod.matchLocalFastPath;
    fastLaneAvailable = typeof matchLocalFastPath === "function";
  } catch {
    // Module doesn't exist on this branch
  }

  if (fastLaneAvailable) {
    log("  (available)");
    const fastCtx = { cwd: repoRoot, projectName: "litlabs-website", mode: "act" };
    for (const q of QUERIES) {
      const { ms, result } = await time(() => matchLocalFastPath(q, fastCtx));
      const matched = result ? `LOCAL_MATCH (${result.route})` : "no match";
      log(`  [${fmtMs(ms)}] "${q}" → ${matched}`);
    }
  } else {
    log("  (not available on this branch)");
    for (const q of QUERIES) {
      log(`  [N/A] "${q}" → (would go through normal classifyIntent path)`);
    }
  }
  log("");

  // ─── 3. Read-Only Tool Execution ─────────────────────────────
  log("--- Read-Only Tool Execution (project.status, project.branch, project.inspect_package) ---");
  const { createDefaultRegistry, createShellExecutor: createShell } = await import("@litt/agent-core");
  const registry = createDefaultRegistry();
  const shell = createShell(repoRoot);
  const toolCtx = { cwd: repoRoot, projectId: null, userId: "bench", shell };

  const toolTests = [
    { id: "project.status", args: {} },
    { id: "project.branch", args: {} },
    { id: "project.inspect_package", args: {} },
  ];

  for (const { id, args } of toolTests) {
    const { ms, result } = await time(() => registry.execute(id, toolCtx, args));
    log(`  [${fmtMs(ms)}] ${id} → ${result.status}: ${result.message?.slice(0, 80)}`);
  }
  log("");

  // ─── 4. Combined "framework + branch" simulation ─────────────
  log("--- Combined READ: framework + branch (parallel tool calls) ---");
  const { ms: parallelMs } = await time(async () => {
    await Promise.all([
      registry.execute("project.inspect_package", toolCtx, {}),
      registry.execute("project.branch", toolCtx, {}),
    ]);
  });
  log(`  [${fmtMs(parallelMs)}] project.inspect_package + project.branch (parallel)`);
  const { ms: serialMs } = await time(async () => {
    await registry.execute("project.inspect_package", toolCtx, {});
    await registry.execute("project.branch", toolCtx, {});
  });
  log(`  [${fmtMs(serialMs)}] project.inspect_package + project.branch (serial)`);
  log("");

  // ─── Summary ─────────────────────────────────────────────────
  log("=== SUMMARY ===");
  log(`Queries tested: ${QUERIES.length}`);
  log(`Fast lane available: ${fastLaneAvailable}`);
  log("");

  // Write to temp file
  const outPath = join(tmpdir(), "litt-perf-baseline.log");
  writeFileSync(outPath, lines.join("\n"), "utf8");
  log(`Benchmark log written to: ${outPath}`);
}

async function getBranch() {
  try {
    const { execSync } = await import("node:child_process");
    return execSync("git branch --show-current", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
