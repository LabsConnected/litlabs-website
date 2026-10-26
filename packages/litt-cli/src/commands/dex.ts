/**
 * `litt dex` — Dex SUPER Stage 1A: local-only diagnostics.
 *
 * Read-only Windows (and partially cross-platform) machine diagnostics:
 *
 *   litt dex status    — composite: cpu, ram, procs, ollama, project
 *   litt dex cpu       — CPU model, cores, busy fraction, loadavg
 *   litt dex ram       — memory totals and pressure
 *   litt dex procs     — top processes by working set (Windows)
 *   litt dex ollama    — local model daemon reachability + route tier
 *   litt dex project   — detected project + git state
 *   litt dex shot      — screenshot to <LiTT home>/dex/shots (requires --yes)
 *
 * Stage 1A boundaries — enforced by construction, not just policy:
 *   - no Twilio, no Funnel, no HTTP listener, no remote control
 *   - no shell strings — subprocesses are structured argv only
 *   - read-only diagnostics; the only write side-effects are the
 *     audit JSONL and --yes-consented screenshots, both under
 *     <LiTT home>/dex/ (outside any git worktree)
 *   - every verb is appended to a secret-redacted audit log
 */

import {
  c,
  detectProject,
  fail,
  header,
  label,
  ok,
  resolveProjectCwd,
  value,
  warn,
} from "../lib/utils.js";
import { getGitState } from "../lib/git-state.js";
import { probeLocalLane } from "../lib/local-lane.js";
import { collectMetrics, type DexMetrics } from "../lib/dex/metrics.js";
import { listProcesses } from "../lib/dex/processes.js";
import { captureScreenshot } from "../lib/dex/screenshot.js";
import { dexShotsDir } from "../lib/dex/dex-home.js";
import { audit } from "../lib/dex/audit.js";
import type { RuntimeSession } from "../lib/runtime-session.js";

const VERBS = ["status", "cpu", "ram", "procs", "ollama", "project", "shot"] as const;
type Verb = (typeof VERBS)[number];

function usage(): number {
  header("Dex — local diagnostics (Stage 1A)");
  console.log(`  ${value("litt dex status", c.bold)}   composite report`);
  console.log(`  ${value("litt dex cpu", c.bold)}      processor + load`);
  console.log(`  ${value("litt dex ram", c.bold)}      memory`);
  console.log(`  ${value("litt dex procs", c.bold)}    top processes (Windows)`);
  console.log(`  ${value("litt dex ollama", c.bold)}   local model daemon`);
  console.log(`  ${value("litt dex project", c.bold)}  project + git state`);
  console.log(`  ${value("litt dex shot", c.bold)}     screenshot ${c.dim}(requires --yes)${c.reset}`);
  console.log(`\n  ${c.dim}Local-only. No listeners, no remote control, no network side-effects.${c.reset}`);
  return 0;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

function printCpu(m: DexMetrics): void {
  console.log(`${label("CPU:")} ${value(m.cpu.model)} ${c.dim}(${m.cpu.cores} cores)${c.reset}`);
  console.log(`${label("Busy:")} ${value(`${Math.round(m.cpu.busyFraction * 100)}%`, c.bold)} ${c.dim}(~100ms sample)${c.reset}`);
  if (m.cpu.loadavg) {
    console.log(`${label("Load:")} ${m.cpu.loadavg.map((n) => n.toFixed(2)).join(" / ")} ${c.dim}(1/5/15m)${c.reset}`);
  } else {
    console.log(`${label("Load:")} ${c.dim}n/a on Windows — busy% shown instead${c.reset}`);
  }
}

function printRam(m: DexMetrics): void {
  const pct = Math.round(m.memory.usedFraction * 100);
  console.log(
    `${label("RAM:")} ${value(`${m.memory.usedMb} / ${m.memory.totalMb} MB`, c.bold)} ` +
      `${c.dim}(${pct}% used, ${m.memory.freeMb} MB free)${c.reset}`,
  );
}

async function reportProcs(): Promise<boolean> {
  const result = await listProcesses();
  if (!result.ok) {
    warn(`Processes unavailable — ${result.reason}`);
    return false;
  }
  console.log(`${label("Procs:")} ${result.total} total — top ${result.top.length} by memory:`);
  for (const p of result.top) {
    console.log(`  ${String(p.pid).padStart(7)}  ${(p.memKb / 1024).toFixed(0).padStart(6)} MB  ${p.name}`);
  }
  return true;
}

async function reportOllama(): Promise<boolean> {
  const lane = await probeLocalLane();
  if (!lane.available) {
    warn(`Ollama unavailable — ${lane.reason ?? "no endpoint answered"}`);
    return false;
  }
  const route = lane.routeLabel ? ` via ${lane.routeLabel}` : "";
  console.log(`${label("Ollama:")} ${value("available", c.green)}${route}`);
  console.log(`${label("Endpoint:")} ${lane.endpoint}`);
  console.log(`${label("Models:")} ${lane.models.length === 0 ? "none installed" : lane.models.join(", ")}`);
  return true;
}

function reportProject(): boolean {
  const detected = detectProject(resolveProjectCwd());
  const projectName = String(detected.packageJson?.name ?? detected.dirName);
  console.log(`${label("Project:")} ${value(projectName, c.bold)}`);
  console.log(`${label("Root:")} ${detected.rootDir}`);
  const git = getGitState(detected.rootDir);
  if (!git.isGitRepo) {
    warn("Not a git repository — git state unavailable.");
    return true; // still a truthful report about the project dir
  }
  const dirty = git.clean ? `${value("clean", c.green)}` : `${value(`${git.changed} changed, ${git.untracked} untracked`, c.yellow)}`;
  console.log(`${label("Git:")} ${git.branch ?? "(detached)"} — ${dirty}`);
  return true;
}

async function runVerb(verb: Verb, rest: string[]): Promise<number> {
  const t0 = Date.now();
  let exitCode = 0;
  let detail = "";

  switch (verb) {
    case "cpu": {
      header("Dex — CPU");
      const m = await collectMetrics();
      printCpu(m);
      console.log(`${label("Uptime:")} ${fmtUptime(m.uptimeSec)}`);
      detail = `busy=${Math.round(m.cpu.busyFraction * 100)}%`;
      break;
    }
    case "ram": {
      header("Dex — Memory");
      const m = await collectMetrics();
      printRam(m);
      detail = `used=${m.memory.usedMb}MB/${m.memory.totalMb}MB`;
      break;
    }
    case "procs": {
      header("Dex — Processes");
      const good = await reportProcs();
      exitCode = good ? 0 : 1;
      detail = good ? "listed" : "unavailable";
      break;
    }
    case "ollama": {
      header("Dex — Ollama");
      const good = await reportOllama();
      // Unavailable is an honest answer, not a crash — exit 0, marked clearly.
      detail = good ? "available" : "unavailable";
      break;
    }
    case "project": {
      header("Dex — Project");
      reportProject();
      detail = "reported";
      break;
    }
    case "shot": {
      header("Dex — Screenshot");
      if (!rest.includes("--yes") && !rest.includes("-y")) {
        warn("Explicit consent required: rerun as `litt dex shot --yes`.");
        console.log(`  ${c.dim}Captures the full virtual screen to ${dexShotsDir()}. Nothing leaves this machine.${c.reset}`);
        exitCode = 1;
        detail = "consent-missing";
        break;
      }
      const result = await captureScreenshot();
      if (!result.ok) {
        fail(`Screenshot unavailable — ${result.reason}`);
        exitCode = 1;
        detail = "unavailable";
      } else {
        ok(`Saved ${result.path} (${Math.round(result.bytes / 1024)} KB)`);
        detail = `saved ${result.path}`;
      }
      break;
    }
    case "status": {
      header("Dex — System Status");
      const m = await collectMetrics();
      console.log(`${label("Host:")} ${m.hostname} ${c.dim}(${m.platform}/${m.arch}, up ${fmtUptime(m.uptimeSec)})${c.reset}`);
      printCpu(m);
      printRam(m);
      await reportProcs();
      await reportOllama();
      reportProject();
      detail = "composite";
      break;
    }
  }

  audit({ verb, ok: exitCode === 0, ms: Date.now() - t0, detail });
  return exitCode;
}

export async function dexCommand(args: string[], _session?: RuntimeSession): Promise<number> {
  const verb = args[0] as Verb | undefined;
  // `litt dex`, `litt dex --help`, `litt dex <verb> --help` all print
  // usage and never execute — dex owns its subcommand help.
  if (!verb || args.includes("--help") || args.includes("-h")) return usage();
  if (!VERBS.includes(verb)) {
    fail(`Unknown dex verb: ${verb}`);
    console.error(`  Supported: ${VERBS.join(", ")}`);
    return 1;
  }
  try {
    return await runVerb(verb, args.slice(1));
  } catch (err) {
    // A diagnostic that crashes reports honestly, never a stack-only failure.
    const msg = err instanceof Error ? err.message : String(err);
    fail(`dex ${verb} failed — ${msg}`);
    audit({ verb, ok: false, ms: 0, detail: `error: ${msg}` });
    return 1;
  }
}
