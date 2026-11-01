/**
 * litt pc tasks — scheduled-task health report (Windows Task Scheduler).
 *
 * Read-only. Lists the LiTT-managed task fleet (or every task with
 * --all): state, last run, decoded last result, next run, triggers, and
 * — crucially — whether the task's action process is actually alive,
 * because "Ready" in Task Scheduler does not mean "healthy".
 *
 * Nothing here registers, enables, disables, starts, stops, or deletes
 * tasks. Findings are reported; remediation is a separate decision.
 */

import { ok, fail, warn, info, header, label, value, c } from "../lib/utils.js";
import {
  probeScheduledTasks,
  classifyTaskHealth,
  decodeTaskResult,
  summarizeTriggers,
  isManagedTask,
  findActionCollisions,
  type SchedTask,
  type TaskSnapshot,
  type HealthLevel,
} from "../lib/pc-tasks.js";

const ICON: Record<HealthLevel, string> = {
  healthy: `${c.green}✓${c.reset}`,
  info: `${c.blue}ℹ${c.reset}`,
  warning: `${c.yellow}!${c.reset}`,
  critical: `${c.red}✗${c.reset}`,
  disabled: `${c.gray}–${c.reset}`,
  unknown: `${c.gray}?${c.reset}`,
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `today ${t}`;
  return `${d.toLocaleDateString([], { month: "2-digit", day: "2-digit" })} ${t}`;
}

function taskRows(t: SchedTask, snap: TaskSnapshot, nowMs: number): void {
  const h = classifyTaskHealth(t, nowMs);
  const res = t.state === "Running" ? "running" : decodeTaskResult(t.lastResult);
  console.log(`${ICON[h.level]} ${value(t.name, c.bold)} ${c.gray}${t.state}${c.reset}`);

  console.log(
    `    ${c.gray}sched:${c.reset} ${summarizeTriggers(t)}` +
      `  ${c.gray}· last:${c.reset} ${fmtWhen(t.lastRun)}` +
      `  ${c.gray}· result:${c.reset} ${res}` +
      `  ${c.gray}· next:${c.reset} ${fmtWhen(t.nextRun)}`,
  );

  for (const a of t.actions) {
    const exe = a.exe.replace(/^.*[\\/]/, "");
    const argShort = (a.args || "").replace(/^.*[\\/]([\w\-.]+\.(?:ps1|vbs|pyw?|js|mjs|cjs|bat|cmd)).*$/i, "$1");
    console.log(`    ${c.gray}action:${c.reset} ${exe} ${argShort}`.trim());
  }

  if (t.procs.length > 0) {
    for (const p of t.procs) {
      const up = p.cpuSec > 0 ? `${p.cpuSec}s cpu` : "idle";
      console.log(`    ${c.gray}proc:${c.reset}   ${p.name} pid ${p.pid} · ${up} · ${p.wsMb}MB`);
    }
  }
  console.log(`    ${c.gray}health:${c.reset} ${h.summary}`);
}

export async function pcTasksCommand(args: string[]): Promise<number> {
  const showAll = args.includes("--all") || args.includes("-a");
  const asJson = args.includes("--json");

  if (process.platform !== "win32") {
    info("pc tasks reads Windows Task Scheduler — non-Windows platforms report nothing.");
    return 0;
  }

  const snap = probeScheduledTasks();
  if (!snap) {
    fail("Task Scheduler probe failed — no data returned");
    return 1;
  }

  const nowMs = Date.now();
  const all = snap.tasks;
  const managed = all.filter(isManagedTask);
  const shown = showAll ? all : managed;

  if (asJson) {
    const enriched = shown.map((t) => ({
      ...t,
      health: classifyTaskHealth(t, nowMs),
      triggersSummary: summarizeTriggers(t),
      lastResultDecoded: decodeTaskResult(t.lastResult),
    }));
    console.log(JSON.stringify({ boot: snap.boot, generatedAt: new Date().toISOString(), tasks: enriched }, null, 2));
    return 0;
  }

  header("PC Scheduled Tasks");

  // ── Task rows ────────────────────────────────────────────────────
  const enabled = shown.filter((t) => t.state !== "Disabled");
  const disabled = shown.filter((t) => t.state === "Disabled");

  for (const t of enabled) taskRows(t, snap, nowMs);
  if (disabled.length > 0) {
    console.log(`\n${c.gray}Disabled (kept for record — no triggers can fire):${c.reset}`);
    for (const t of disabled) {
      console.log(`  ${c.gray}– ${t.name} :: ${t.actions[0]?.args?.replace(/^.*[\\/]/, "") ?? t.actions[0]?.exe ?? "?"}${c.reset}`);
    }
  }

  // ── Duplicates / collisions ──────────────────────────────────────
  header("Duplicates & Conflicts");
  const collisions = findActionCollisions(showAll ? all : managed);
  const managedCollisions = collisions.filter((col) =>
    col.tasks.some((name) => managed.some((m) => m.name === name)),
  );
  if (managedCollisions.length === 0) {
    ok("No duplicate managed tasks — each enabled LiTT task launches a distinct payload");
  } else {
    for (const col of managedCollisions) {
      warn(`Same payload under ${col.tasks.length} tasks: ${col.tasks.join(" + ")}`);
      console.log(`    ${c.gray}${col.key}${c.reset}`);
    }
  }

  // Trigger-time conflicts inside the managed set: two enabled tasks
  // that can fire in the same window on the same day.
  const scheduled = managed.filter((t) => t.enabled && t.state !== "Disabled" && t.nextRun);
  const soonPairs: string[] = [];
  // Tasks with no execution limit get a conservative duration estimate —
  // LiTT-BackupDaily routinely archives for hours. Flag a pair when the
  // second task fires before the first could plausibly have finished.
  const UNBOUNDED_RUN_SEC = 3 * 3600;
  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]!, b = scheduled[j]!;
      const ta = Date.parse(a.nextRun!), tb = Date.parse(b.nextRun!);
      const first = ta <= tb ? a : b;
      const runMs = (first.execTimeoutSec || UNBOUNDED_RUN_SEC) * 1000;
      if (Math.abs(ta - tb) < runMs) {
        soonPairs.push(`${a.name} (${fmtWhen(a.nextRun)}) vs ${b.name} (${fmtWhen(b.nextRun)})`);
      }
    }
  }
  if (soonPairs.length === 0) {
    ok("No conflicting next-run windows among enabled managed tasks");
  } else {
    for (const p of soonPairs) warn(`Possible overlap: ${p}`);
  }

  // ── Findings ─────────────────────────────────────────────────────
  const healths = shown.map((t) => ({ t, h: classifyTaskHealth(t, nowMs) }));
  const counts = new Map<HealthLevel, number>();
  for (const { h } of healths) counts.set(h.level, (counts.get(h.level) ?? 0) + 1);
  const problems = healths.filter(({ h }) => h.level === "warning" || h.level === "critical");

  header("Findings");
  const summary = (["critical", "warning", "healthy", "info", "disabled"] as HealthLevel[])
    .filter((l) => counts.get(l))
    .map((l) => `${counts.get(l)} ${l}`)
    .join(" · ");
  console.log(`${label("Fleet:")} ${value(`${shown.length} tasks shown — ${summary}`)}`);
  if (snap.boot) {
    console.log(`${label("Boot:")} ${fmtWhen(snap.boot)}`);
  }
  if (problems.length === 0) {
    ok("All shown tasks healthy");
  } else {
    for (const { t, h } of problems) {
      (h.level === "critical" ? fail : warn)(`${t.name} — ${h.summary}`);
    }
    console.log(`\n${c.dim}No tasks were modified. Remediation (re-enable, re-register, restart) is a separate explicit decision.${c.reset}`);
  }
  if (!showAll && all.length > managed.length) {
    info(`${all.length - managed.length} non-managed tasks hidden — pass --all to include them`);
  }
  return 0;
}
