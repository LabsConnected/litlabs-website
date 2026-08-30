/**
 * LITT_PERF multi-sample benchmark — runs N iterations per query
 * to get min/median/p95 statistics.
 *
 * Usage: node --import tsx packages/litt-cli/scripts/bench-litt-perf-multi.mjs
 */

import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";

function fmtMs(ms) { return ms < 1 ? `${ms.toFixed(2)}ms` : `${ms.toFixed(0)}ms`; }

const QUERIES = [
  "what branch am i on",
  "what project is this",
  "exit",
  "whats up",
  "what framework is this",
];

const REPEAT = 10;

function stats(name, samples) {
  samples.sort((a, b) => a - b);
  const min = samples[0];
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`  ${name.padEnd(42)} min=${fmtMs(min).padStart(8)} med=${fmtMs(median).padStart(8)} p95=${fmtMs(p95).padStart(8)} mean=${fmtMs(mean).padStart(8)}`);
}

async function main() {
  const repoRoot = process.cwd();
  const lines = [];

  lines.push("=== LITT_PERF MULTI-SAMPLE BENCHMARK ===");
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push(`Repo: ${repoRoot}`);
  lines.push(`Samples per query: ${REPEAT}`);
  lines.push("");

  const { classifyIntent } = await import("../src/lib/intent.ts");
  const { matchLocalFastPath } = await import("../src/lib/local-fast-lane.ts");
  const { createDefaultRegistry, createShellExecutor } = await import("@litt/agent-core");

  const registry = createDefaultRegistry();
  const shell = createShellExecutor(repoRoot);
  const toolCtx = { cwd: repoRoot, projectId: null, userId: "bench", shell };

  // ─── Intent Classification ───
  lines.push("--- Intent Classification ---");
  console.log("--- Intent Classification ---");
  for (const q of QUERIES) {
    const samples = [];
    for (let i = 0; i < REPEAT; i++) {
      const t0 = performance.now();
      await classifyIntent(q);
      const t1 = performance.now();
      samples.push(t1 - t0);
    }
    stats(q, samples);
    lines.push(`  ${q.padEnd(42)} min=${fmtMs(Math.min(...samples))} med=${fmtMs(samples[Math.floor(samples.length/2)])}`);
  }
  lines.push("");
  console.log("");

  // ─── Local Fast Lane ───
  lines.push("--- Local Fast Lane ---");
  console.log("--- Local Fast Lane ---");
  const fastCtx = { cwd: repoRoot, projectName: "litlabs-website", repoName: "main", mode: "act" };
  for (const q of QUERIES) {
    const samples = [];
    for (let i = 0; i < REPEAT; i++) {
      const t0 = performance.now();
      matchLocalFastPath(q, fastCtx);
      const t1 = performance.now();
      samples.push(t1 - t0);
    }
    stats(q, samples);
  }
  lines.push("");
  console.log("");

  // ─── Tool Execution ───
  lines.push("--- Tool Execution ---");
  console.log("--- Tool Execution ---");
  const tools = ["project.status", "project.branch", "project.inspect_package"];
  for (const id of tools) {
    const samples = [];
    for (let i = 0; i < REPEAT; i++) {
      const t0 = performance.now();
      await registry.execute(id, toolCtx, {});
      const t1 = performance.now();
      samples.push(t1 - t0);
    }
    stats(id, samples);
  }
  lines.push("");
  console.log("");

  // ─── Parallel READ ───
  lines.push("--- Parallel READ ---");
  console.log("--- Parallel READ ---");
  const parSamples = [];
  for (let i = 0; i < REPEAT; i++) {
    const t0 = performance.now();
    await Promise.all([
      registry.execute("project.inspect_package", toolCtx, {}),
      registry.execute("project.branch", toolCtx, {}),
    ]);
    const t1 = performance.now();
    parSamples.push(t1 - t0);
  }
  stats("inspect_package + branch (parallel)", parSamples);
  lines.push("");
  console.log("");

  // ─── Summary ───
  const summary = [
    "=== SUMMARY ===",
    `Queries tested: ${QUERIES.length}`,
    `Samples per query: ${REPEAT}`,
    "Fast lane available: true",
  ];
  console.log(summary.join("\n"));
  lines.push(...summary);

  const outPath = "C:\\Users\\litbi\\AppData\\Local\\Temp\\litt-perf-multi.log";
  writeFileSync(outPath, [...lines, ...summary].join("\n"), "utf8");
  console.log(`\nBenchmark log written to: ${outPath}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
