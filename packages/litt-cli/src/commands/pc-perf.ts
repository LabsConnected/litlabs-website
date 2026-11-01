/**
 * litt pc perf <light|dev|max> — switch workstation performance mode.
 *
 * Contract (from the mode spec):
 *   - Show current settings, explain proposed changes, support --dry-run.
 *   - Require confirmation for disruptive actions (model unload).
 *   - Reversible: the prior power scheme is recorded in pc-mode.json and
 *     restored when switching back to dev/max.
 *   - Preserve user data; never terminate applications automatically;
 *     report errors clearly.
 */

import { createInterface } from "node:readline/promises";
import { ok, fail, warn, info, header, label, value, c, exec } from "../lib/utils.js";
import { probeWindows, probeOllamaPsCli } from "../lib/pc-probe.js";
import { buildPerfPlan, MODE_META } from "../lib/pc-plan.js";
import { readPcState, writePcState, PC_MODES, type PcMode } from "../lib/pc-state.js";

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(a.trim());
  } finally {
    rl.close();
  }
}

export async function pcPerfCommand(args: string[]): Promise<number> {
  const mode = args.find((a) => PC_MODES.includes(a as PcMode)) as PcMode | undefined;
  const dryRun = args.includes("--dry-run") || args.includes("-n");
  const yes = args.includes("--yes") || args.includes("-y");
  const preload = args.includes("--preload");

  if (!mode) {
    console.error(`Usage: litt pc perf <${PC_MODES.join("|")}> [--dry-run] [--yes] [--preload]`);
    console.error(`  --dry-run   show the plan without applying anything`);
    console.error(`  --yes       skip confirmation for disruptive actions`);
    console.error(`  --preload   (max) warm-load the 64K model now instead of on first request`);
    return 1;
  }

  const meta = MODE_META[mode];
  header(`litt pc perf ${mode} — ${meta.title}`);
  console.log(`${c.gray}${meta.purpose}${c.reset}`);

  // Live probes so the plan reflects the real machine.
  const win = probeWindows();
  const loadedModels = probeOllamaPsCli().map((m) => m.name);
  const state = readPcState();

  const plan = buildPerfPlan(mode, {
    powerSchemeGuid: win?.powerSchemeGuid ?? null,
    loadedModels,
    savedPerfSchemeGuid: state?.restore.powerSchemeGuid ?? null,
    preload,
  });

  if (state) {
    console.log(`${label("Current mode:")} ${MODE_META[state.mode].title} (since ${state.appliedAt})`);
  } else {
    console.log(`${label("Current mode:")} none set`);
  }

  console.log(`\n${c.bold}Plan:${c.reset}`);
  let hasDisruptive = false;
  for (const a of plan.actions) {
    if (a.kind === "state") continue;
    const tag = a.disruptive ? `${c.yellow}[confirm]${c.reset}` : `${c.green}[apply]${c.reset}`;
    console.log(`  ${tag} ${a.label}`);
    if (a.disruptive) hasDisruptive = true;
  }
  for (const n of plan.notes) {
    console.log(`  ${c.gray}· ${n}${c.reset}`);
  }

  if (dryRun) {
    info("Dry run — nothing was changed.");
    return 0;
  }

  if (hasDisruptive && !yes) {
    const granted = await confirm(`Apply plan for ${meta.title}? (includes actions marked [confirm])`);
    if (!granted) {
      info("Aborted — no changes applied. Re-run with --yes to skip this prompt.");
      return 1;
    }
  }

  // ── Execute ──────────────────────────────────────────────────────
  const applied: string[] = [];
  let failures = 0;
  const restore: { powerSchemeGuid?: string; powerSchemeName?: string } = { ...(state?.restore ?? {}) };

  for (const a of plan.actions) {
    try {
      if (a.kind === "power-scheme" && a.target) {
        // Switching to Balanced under LIGHT: save the outgoing scheme so
        // dev/max can restore exactly what was running before.
        if (mode === "light" && win?.powerSchemeGuid) {
          restore.powerSchemeGuid = win.powerSchemeGuid;
          restore.powerSchemeName = win.powerScheme ?? undefined;
        }
        const r = exec(`powercfg /setactive ${a.target}`, { timeout: 8_000 });
        if (r.exitCode === 0) { ok(a.label); applied.push(a.label); }
        else { fail(`${a.label} — powercfg exited ${r.exitCode}`); failures++; }
      } else if (a.kind === "ollama-unload" && a.target) {
        const r = exec(`ollama stop ${a.target}`, { timeout: 15_000 });
        if (r.exitCode === 0) { ok(a.label); applied.push(a.label); }
        else { fail(`${a.label} — ${r.stderr || "ollama stop failed"}`); failures++; }
      } else if (a.kind === "ollama-preload" && a.target) {
        info(`Loading ${a.target} (one-token warmup, keep_alive 30m)…`);
        const res = await fetch("http://127.0.0.1:11434/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: a.target,
            prompt: "ping",
            stream: false,
            keep_alive: "30m",
            options: { num_predict: 1 },
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (res.ok) { ok(a.label); applied.push(a.label); }
        else { fail(`${a.label} — API ${res.status}`); failures++; }
      }
    } catch (err) {
      fail(`${a.label} — ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }

  // ── Persist state (always, even on partial failure — it's the audit) ──
  writePcState({
    version: 1,
    mode,
    appliedAt: new Date().toISOString(),
    previousMode: state?.mode ?? null,
    preferredModel: meta.preferredModel,
    restore,
    actions: applied,
  });
  ok(`Mode '${mode}' recorded in ~/.litt/pc-mode.json`);

  if (failures > 0) {
    warn(`${failures} action(s) failed — see messages above. Mode still recorded; re-run to retry.`);
    return 1;
  }

  // Post-apply snapshot for truthfulness.
  const after = probeWindows();
  if (after) {
    console.log(`${label("After:")} ${value(`${(after.totalGb - after.freeGb).toFixed(1)}/${after.totalGb} GB RAM · ${after.powerScheme ?? "?"}`)}`);
  }
  console.log(`\n${c.dim}Verify anytime with: litt pc status${c.reset}`);
  return 0;
}
