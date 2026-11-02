/**
 * PC scheduled tasks — read-only Windows Task Scheduler inspection for
 * `litt pc tasks` and the tasks section of `litt pc status`.
 *
 * Design contract (same as pc-probe):
 *  - On-demand only. One PowerShell spawn emits a JSON snapshot; every
 *    health decision is a pure function over that snapshot so the rules
 *    are unit-testable.
 *  - Failure-tolerant. A denied query degrades to null — never a crash,
 *    never a fabricated state.
 *  - Read-only. This module never registers, enables, disables, starts,
 *    or stops a task — Task Scheduler is queried, period.
 *  - Truthful. Task Scheduler's reported State is NOT used as proof of
 *    life: a task "Running" with no live action process, or a resident
 *    (unlimited-runtime) logon task in "Ready" with a dead process, is
 *    reported as what it actually is.
 */

import { exec } from "./utils.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface TaskAction {
  exe: string;
  args: string;
  wd: string;
}

export interface TaskTrigger {
  /** CIM class short name, e.g. "MSFT_TaskLogonTrigger". */
  type: string;
  /** ISO start boundary, "" when unset. */
  start: string;
  /** Weekly days-of-week bitmask (Sun=1 … Sat=64), 0 when n/a. */
  daysOfWeek: number;
  /** Repetition interval ("PT30M"), "" when none. */
  every: string;
  enabled: boolean;
}

export interface TaskProc {
  pid: number;
  name: string;
  cpuSec: number;
  wsMb: number;
  cmd: string | null;
}

export interface ActionFile {
  path: string;
  exists: boolean;
}

export interface SchedTask {
  name: string;
  path: string;
  state: string;
  enabled: boolean;
  lastRun: string | null;
  lastResult: number;
  nextRun: string | null;
  missed: number;
  actions: TaskAction[];
  triggers: TaskTrigger[];
  /** Settings.ExecutionTimeLimit in seconds; 0 = no limit. */
  execTimeoutSec: number;
  restartCount: number;
  multiInst: string;
  /** Script/file tokens extracted from action arguments. */
  tokens: string[];
  /** Live processes whose command line references a task token. */
  procs: TaskProc[];
  /** Action script paths + on-disk existence. */
  actionFiles: ActionFile[];
  /** Port this task is expected to serve, or null. */
  port: number | null;
  /** Local address where `port` accepted a TCP connect, null when closed. */
  portOn: string | null;
}

export interface TaskSnapshot {
  boot: string | null;
  /** Listening TCP ports (for service-style task health). */
  ports: number[];
  tasks: SchedTask[];
}

export type HealthLevel =
  | "healthy"
  | "info"
  | "warning"
  | "critical"
  | "disabled"
  | "unknown";

export interface TaskHealth {
  level: HealthLevel;
  /** One-line verdict shown next to the task. */
  summary: string;
}

// ─── Managed-task pattern ───────────────────────────────────────────
// A task belongs to the LiTT-managed fleet when its name or any action
// references the LiTT install paths / ollama launcher scripts.

export const MANAGED_TASK_RE =
  /litt|ollama|watchdog|agent.?hq|supervisor|stage2|LiTTTools/i;

export function isManagedTask(t: SchedTask): boolean {
  if (MANAGED_TASK_RE.test(t.name)) return true;
  return t.actions.some((a) => MANAGED_TASK_RE.test(`${a.exe} ${a.args}`));
}

// ─── Result decoding ────────────────────────────────────────────────

/** Well-known Task Scheduler result codes (HRESULT / Win32 / task-specific). */
const RESULT_NAMES: Record<number, string> = {
  0: "success",
  1: "incorrect function",
  2: "file not found",
  3: "path not found",
  10: "environment incorrect",
  267009: "task is currently running",
  267010: "task is disabled",
  267011: "task has not yet run",
  267012: "no more runs scheduled",
  267013: "task could not run (properties)",
  267014: "task terminated by user",
  267015: "task trigger removed/stopped",
  0x80070002: "file not found",
  0x80070005: "access denied",
  0x8007000e: "out of memory",
  0x80070520: "logon failure",
  0x800710e0: "operator refused elevation",
  0x800704dd: "not run — user not logged on",
  0x80041310: "cannot start — account",
  0x8004131f: "instance already running",
  0xc000013a: "terminated (kill/logoff)",
};

export function decodeTaskResult(code: number): string {
  // Normalize to unsigned 32-bit — LastTaskResult may arrive signed.
  const u = code >>> 0;
  if (u === 0) return "success";
  const signedHit = RESULT_NAMES[code];
  if (signedHit) return `${signedHit} (0x${u.toString(16)})`;
  const unsignedHit = RESULT_NAMES[u];
  if (unsignedHit) return `${unsignedHit} (0x${u.toString(16)})`;
  return `exit 0x${u.toString(16)}`;
}

const RESULT_RUNNING = 267009; // 0x41301 — scheduler says still running
const RESULT_NEVER_RAN = 267011; // 0x41303 — no execution history

// ─── Trigger summary ────────────────────────────────────────────────

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortTime(iso: string): string {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
}

/** "PT30M" → "30m", "PT12H" → "12h", "P1D" → "1d", "00:30:00" → "30m". Returns "" when unknown. */
export function humanDuration(iso8601: string): string {
  const ts = iso8601.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/); // TimeSpan "HH:MM[:SS]"
  if (ts) {
    const parts: string[] = [];
    const h = parseInt(ts[1]!, 10), mnt = parseInt(ts[2]!, 10), s = parseInt(ts[3] ?? "0", 10);
    if (h > 0) parts.push(`${h}h`);
    if (mnt > 0) parts.push(`${mnt}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join("") || "0s";
  }
  const m = iso8601.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return "";
  const parts: string[] = [];
  if (m[1]) parts.push(`${m[1]}d`);
  if (m[2]) parts.push(`${m[2]}h`);
  if (m[3]) parts.push(`${m[3]}m`);
  if (m[4]) parts.push(`${m[4]}s`);
  return parts.join("");
}

export function summarizeTriggers(t: SchedTask): string {
  const bits: string[] = [];
  for (const tr of t.triggers) {
    if (!tr.enabled) continue;
    switch (tr.type) {
      case "MSFT_TaskLogonTrigger":
        bits.push("at logon");
        break;
      case "MSFT_TaskBootTrigger":
        bits.push("at boot");
        break;
      case "MSFT_TaskDailyTrigger": {
        const at = shortTime(tr.start);
        bits.push(`daily${at ? ` ${at}` : ""}`);
        break;
      }
      case "MSFT_TaskWeeklyTrigger": {
        const days = DOW.filter((_, i) => tr.daysOfWeek & (1 << i)).join("/");
        const at = shortTime(tr.start);
        bits.push(`weekly ${days || "?"}${at ? ` ${at}` : ""}`);
        break;
      }
      case "MSFT_TaskTimeTrigger": {
        const every = humanDuration(tr.every);
        const at = shortTime(tr.start);
        bits.push(`once${at ? ` ${at}` : ""}${every ? `, repeats every ${every}` : ""}`);
        break;
      }
      case "MSFT_TaskIdleTrigger":
        bits.push("on idle");
        break;
      case "MSFT_TaskEventTrigger":
        bits.push("on event");
        break;
      case "MSFT_TaskRegistrationTrigger":
        bits.push("at registration");
        break;
      default:
        bits.push(tr.type.replace(/^MSFT_Task/, "").replace(/Trigger$/, "").toLowerCase() || tr.type);
    }
  }
  if (bits.length === 0) bits.push("no enabled triggers");
  return bits.join(" + ");
}

// ─── Endpoint expectation ───────────────────────────────────────────
// Managed tasks that stand up a TCP listener get a port check so the
// report can distinguish "script ran" from "service actually up".

const KNOWN_TASK_PORTS: { re: RegExp; port: number }[] = [
  { re: /agent\s*hq/i, port: 8790 },
];

/** Port a task is expected to keep listening on, or null. */
export function expectedPort(t: SchedTask): number | null {
  for (const k of KNOWN_TASK_PORTS) if (k.re.test(t.name)) return k.port;
  const hay = `${t.name} ${t.actions.map((a) => a.args).join(" ")}`;
  const m = hay.match(/\b(1\d{4}|8\d{3})\b/);
  if (m) {
    const p = parseInt(m[1], 10);
    if (p >= 1024 && p <= 65535) return p;
  }
  return null;
}

// ─── Health classification (pure) ───────────────────────────────────

function elapsedSec(nowMs: number, iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((nowMs - t) / 1000));
}

function fmtDur(sec: number): string {
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  const h = sec / 3600;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function hasTrigger(t: SchedTask, type: string): boolean {
  return t.triggers.some((tr) => tr.type === type && tr.enabled);
}

const LEVEL_ORDER: HealthLevel[] = ["unknown", "disabled", "healthy", "info", "warning", "critical"];

function worst(a: HealthLevel, b: HealthLevel): HealthLevel {
  return LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a;
}

/**
 * Classify one task. Combines scheduler-reported state with live
 * process evidence, the decoded last result, execution-limit elapsed
 * time, missing action files, and expected listeners.
 */
export function classifyTaskHealth(task: SchedTask, nowMs: number): TaskHealth {
  if (!task.enabled || task.state === "Disabled") {
    return { level: "disabled", summary: "disabled" };
  }

  let level: HealthLevel = "healthy";
  const notes: string[] = [];

  // ── Missing action files — the task cannot succeed ───────────────
  const missing = task.actionFiles.filter((f) => !f.exists);
  if (missing.length > 0) {
    level = worst(level, "critical");
    notes.push(`action file missing: ${missing.map((f) => f.path).join(", ")}`);
  }

  // ── Scheduler says Running ───────────────────────────────────────
  if (task.state === "Running") {
    const runFor = elapsedSec(nowMs, task.lastRun);
    if (task.procs.length > 0) {
      if (task.execTimeoutSec > 0 && runFor !== null) {
        if (runFor > task.execTimeoutSec) {
          level = worst(level, "critical");
          notes.push(`running ${fmtDur(runFor)} — past ${fmtDur(task.execTimeoutSec)} execution limit`);
        } else if (runFor > task.execTimeoutSec * 0.8) {
          level = worst(level, "warning");
          notes.push(`running ${fmtDur(runFor)} — approaching ${fmtDur(task.execTimeoutSec)} limit`);
        } else {
          notes.push(`running ${fmtDur(runFor)} (limit ${fmtDur(task.execTimeoutSec)})`);
        }
      } else {
        notes.push(`running${runFor !== null ? ` ${fmtDur(runFor)}` : ""} — no time limit`);
      }
    } else {
      level = worst(level, "warning");
      notes.push("state=Running but no action process found");
    }
  } else {
    // Not running now — judge the last exit.
    if (task.lastResult === RESULT_NEVER_RAN) {
      if (task.nextRun && Date.parse(task.nextRun) > nowMs) {
        level = worst(level, "info");
        notes.push("scheduled — first run pending");
      } else {
        level = worst(level, "warning");
        notes.push("never ran and nothing scheduled");
      }
    } else if (task.lastResult !== 0 && task.lastResult !== RESULT_RUNNING) {
      level = worst(level, "warning");
      notes.push(`last exit ${decodeTaskResult(task.lastResult)}`);
      // Resident-style task: logon/boot trigger + no run limit + dead
      // process. Windows only restarts these at the next trigger, so a
      // dead resident stays dead — surface it explicitly.
      if (
        task.execTimeoutSec === 0 &&
        (hasTrigger(task, "MSFT_TaskLogonTrigger") || hasTrigger(task, "MSFT_TaskBootTrigger")) &&
        task.procs.length === 0
      ) {
        notes.push("resident task not running (restarts only at next logon)");
      }
    }
  }

  // ── Expected listener — connect-probe truth, not socket tables ────
  const port = task.port ?? expectedPort(task);
  if (port !== null) {
    if (task.portOn) {
      notes.push(`:${port} reachable on ${task.portOn}`);
    } else {
      level = worst(level, "warning");
      notes.push(`expected :${port} refused on loopback and local IPs`);
    }
  }

  // ── Missed runs ──────────────────────────────────────────────────
  if (task.missed > 0) {
    level = worst(level, "warning");
    notes.push(`${task.missed} missed run${task.missed === 1 ? "" : "s"}`);
  }

  if (notes.length === 0) {
    if (task.lastResult === 0) return { level, summary: "ok" };
    return { level: level === "healthy" ? "unknown" : level, summary: "insufficient data" };
  }
  return { level, summary: notes.join(" · ") };
}

// ─── Duplicate / collision detection (pure) ─────────────────────────

export interface Collision {
  /** Shared normalized action key (script path or exe+args). */
  key: string;
  tasks: string[];
}

function actionKey(t: SchedTask): string | null {
  for (const a of t.actions) {
    const m = a.args.match(/[A-Za-z]:\\[^\s"']+?\.(?:ps1|vbs|pyw?|js|mjs|cjs|bat|cmd|exe)/i);
    if (m) return m[0].toLowerCase();
    const b = a.args.match(/(?<![\w\-.])([\w\-.]+\.(?:ps1|vbs|pyw?|bat|cmd))(?![\w\-.])/i);
    if (b) return b[1]!.toLowerCase();
  }
  const a = t.actions[0];
  if (a && a.exe) return `${a.exe} ${a.args}`.trim().toLowerCase();
  return null;
}

/**
 * Enabled tasks that launch the same script (or identical exe+args).
 * Two schedulers pointing at one payload is the classic duplicate-task
 * bug — same work twice, or dueling lockfiles.
 */
export function findActionCollisions(tasks: SchedTask[]): Collision[] {
  const byKey = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.enabled || t.state === "Disabled") continue;
    const k = actionKey(t);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), t.name]);
  }
  return [...byKey.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([key, names]) => ({ key, tasks: names }));
}

// ─── Probe (PowerShell → JSON) ──────────────────────────────────────

const PS_TASKS = `
$ErrorActionPreference = 'SilentlyContinue'
$boot = $null
try { $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('o') } catch {}
$ports = @(Get-NetTCPConnection -State Listen | Select-Object -ExpandProperty LocalPort -Unique)
$procInfo = @{}
Get-Process | ForEach-Object {
  $cpu = 0; try { if ($_.CPU) { $cpu = [math]::Round($_.CPU,1) } } catch {}
  $ws = 0; try { $ws = [int]($_.WorkingSet64/1MB) } catch {}
  $st = $null; try { $st = $_.StartTime.ToString('o') } catch {}
  $procInfo[[int]$_.Id] = @{ cpu=$cpu; ws=$ws; start=$st }
}
$raw = @{}
Get-CimInstance Win32_Process | ForEach-Object {
  $raw[[int]$_.ProcessId] = @{ cmd=$_.CommandLine; ppid=[int]$_.ParentProcessId; name=$_.Name }
}
$localAddrs = @('127.0.0.1') + @(
  Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\\.|169\\.254)' } |
    Select-Object -First 3 -ExpandProperty IPAddress
)

function Task-Tokens($task) {
  $tok = New-Object System.Collections.Generic.List[string]
  foreach ($a in $task.Actions) {
    if ($a.Arguments) {
      foreach ($m in [regex]::Matches($a.Arguments, '[A-Za-z]:\\\\[^\\s"'']+?\\.(ps1|vbs|pyw?|js|mjs|cjs|bat|cmd|exe)')) {
        $tok.Add([IO.Path]::GetFileName($m.Value))
      }
      foreach ($m in [regex]::Matches($a.Arguments, '(?<![\\w\\-.])([\\w\\-.]+\\.(ps1|vbs|pyw?|bat|cmd))(?![\\w\\-.])')) {
        $tok.Add([IO.Path]::GetFileName($m.Groups[1].Value))
      }
    }
  }
  if ($tok.Count -eq 0) {
    $exe = $task.Actions | Select-Object -First 1 -ExpandProperty Execute
    if ($exe -and $exe -notmatch '^(powershell|pwsh|wscript|cscript|cmd)(\\.exe)?$') {
      $tok.Add([IO.Path]::GetFileName($exe))
    }
  }
  $tok | Select-Object -Unique
}

function Task-Port($task) {
  if ($task.TaskName -match 'agent\\s*hq') { return 8790 }
  $hay = $task.TaskName + ' ' + (($task.Actions | ForEach-Object { $_.Arguments }) -join ' ')
  $m = [regex]::Match($hay, '\\b(1\\d{4}|8\\d{3})\\b')
  if ($m.Success) { return [int]$m.Value }
  return $null
}

function Port-OpenOn($port) {
  foreach ($a in $localAddrs) {
    try {
      $tc = New-Object Net.Sockets.TcpClient
      if ($tc.ConnectAsync($a, $port).Wait(700)) { $tc.Close(); return $a }
      $tc.Close()
    } catch {}
  }
  return $null
}

function Task-ScriptPaths($task) {
  $paths = New-Object System.Collections.Generic.List[string]
  foreach ($a in $task.Actions) {
    if ($a.Arguments) {
      foreach ($m in [regex]::Matches($a.Arguments, '[A-Za-z]:\\\\[^\\s"'']+?\\.(ps1|vbs|pyw?|js|mjs|cjs|bat|cmd)')) {
        $paths.Add($m.Value)
      }
    }
    if ($a.Execute -and $a.Execute -match '\\.(ps1|vbs|pyw?|bat|cmd)$' -and $a.Execute -match '^[A-Za-z]:\\\\') {
      $paths.Add($a.Execute)
    }
  }
  $paths | Select-Object -Unique
}

$out = @()
foreach ($t in (Get-ScheduledTask)) {
  $i = $null
  try { $i = $t | Get-ScheduledTaskInfo } catch {}
  $actions = @($t.Actions | ForEach-Object {
    $args = $_.Arguments
    if ($args) {
      $args = $args -replace '(KEY|TOKEN|SECRET|PASSWORD|PASS)=([^\\s"'']+)','$1=[R]'
      if ($args.Length -gt 160) { $args = $args.Substring(0,160) }
    }
    @{ exe=$_.Execute; args=$args; wd=$_.WorkingDirectory }
  })
  $triggers = @($t.Triggers | ForEach-Object {
    $ev = ''
    try { if ($_.Repetition -and $_.Repetition.Interval) { $ev = [string]$_.Repetition.Interval } } catch {}
    $sb = ''
    try { if ($_.StartBoundary) { $sb = ([datetime]$_.StartBoundary).ToString('o') } } catch {}
    @{ type=$_.CimClass.CimClassName; start=$sb; daysOfWeek=[int]($_.DaysOfWeek); every=$ev; enabled=[bool]$_.Enabled }
  })
  $tokens = @(Task-Tokens $t)
  $matchedIds = @{}
  if ($tokens.Count -gt 0) {
    foreach ($kv in $raw.GetEnumerator()) {
      $cmd = $kv.Value.cmd
      if (-not $cmd) { continue }
      foreach ($tok in $tokens) {
        $pat = "(^|[\\s\\\\/'"":=])" + [regex]::Escape($tok) + "($|[\\s'""])"
        if ($cmd -match $pat) { $matchedIds[[int]$kv.Key] = $true; break }
      }
    }
    # one level of children — the real worker is often a spawned script
    foreach ($kv in $raw.GetEnumerator()) {
      if ($matchedIds.ContainsKey($kv.Value.ppid)) { $matchedIds[[int]$kv.Key] = $true }
    }
  }
  $matched = @()
  foreach ($id in $matchedIds.Keys) {
    $e = $raw[$id]
    $pi = $procInfo[$id]
    $cl = $e.cmd
    if ($cl) {
      $cl = $cl -replace '(KEY|TOKEN|SECRET|PASSWORD|PASS)=([^\\s"'']+)','$1=[R]'
      if ($cl.Length -gt 140) { $cl = $cl.Substring(0,140) }
    }
    $matched += @{ pid=$id; name=$e.name; cpu=$pi.cpu; ws=$pi.ws; start=$pi.start; cmd=$cl }
  }
  $files = @()
  foreach ($p in (Task-ScriptPaths $t)) {
    $files += @{ path=$p; exists=[bool](Test-Path -LiteralPath $p) }
  }
  $ep = Task-Port $t
  $openOn = $null
  if ($ep) { $openOn = Port-OpenOn $ep }
  $lr = $null
  try { if ($i -and $i.LastRunTime -and ([datetime]$i.LastRunTime).Year -gt 2000) { $lr = ([datetime]$i.LastRunTime).ToString('o') } } catch {}
  $nr = $null
  try { if ($i -and $i.NextRunTime -and ([datetime]$i.NextRunTime).Year -gt 2000) { $nr = ([datetime]$i.NextRunTime).ToString('o') } } catch {}
  $timeout = 0
  try { if ($t.Settings.ExecutionTimeLimit) { $timeout = [int]$t.Settings.ExecutionTimeLimit.TotalSeconds } } catch {}
  $out += @{
    name=$t.TaskName; path=$t.TaskPath; state=[string]$t.State;
    enabled=[bool]$t.Settings.Enabled;
    lastRun=$lr; lastResult= $(if ($i) { [int64]$i.LastTaskResult } else { 0 });
    nextRun=$nr; missed= $(if ($i) { [int]$i.NumberOfMissedRuns } else { 0 });
    actions=$actions; triggers=$triggers;
    execTimeoutSec=$timeout;
    restartCount= $(if ($t.Settings.RestartCount) { [int]$t.Settings.RestartCount } else { 0 });
    multiInst=[string]$t.Settings.MultipleInstances;
    tokens=$tokens; procs=$matched; actionFiles=$files;
    port= $(if ($ep) { [int]$ep } else { $null });
    portOn= $(if ($ep) { $openOn } else { $null })
  }
}
@{ boot=$boot; ports=$ports; tasks=$out } | ConvertTo-Json -Depth 7 -Compress
`;

function arr<T>(x: T | T[] | null | undefined): T[] {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

/** One PowerShell spawn → full scheduled-task snapshot. Null on failure. */
export function probeScheduledTasks(): TaskSnapshot | null {
  if (process.platform !== "win32") return null;
  const r = exec(PS_TASKS, { timeout: 45_000 });
  if (!r.stdout) return null;
  try {
    const j = JSON.parse(r.stdout);
    return {
      boot: typeof j.boot === "string" ? j.boot : null,
      ports: arr<number>(j.ports).map((p) => Number(p) || 0),
      tasks: arr<Record<string, unknown>>(j.tasks).map((t) => ({
        name: String(t.name ?? ""),
        path: String(t.path ?? ""),
        state: String(t.state ?? "Unknown"),
        enabled: Boolean(t.enabled),
        lastRun: t.lastRun ? String(t.lastRun) : null,
        lastResult: Number(t.lastResult) || 0,
        nextRun: t.nextRun ? String(t.nextRun) : null,
        missed: Number(t.missed) || 0,
        actions: arr<Record<string, unknown>>(t.actions as never).map((a) => ({
          exe: String(a.exe ?? ""),
          args: String(a.args ?? ""),
          wd: String(a.wd ?? ""),
        })),
        triggers: arr<Record<string, unknown>>(t.triggers as never).map((tr) => ({
          type: String(tr.type ?? ""),
          start: String(tr.start ?? ""),
          daysOfWeek: Number(tr.daysOfWeek) || 0,
          every: String(tr.every ?? ""),
          enabled: tr.enabled !== false,
        })),
        execTimeoutSec: Number(t.execTimeoutSec) || 0,
        restartCount: Number(t.restartCount) || 0,
        multiInst: String(t.multiInst ?? ""),
        tokens: arr<string>(t.tokens as never).map(String),
        procs: arr<Record<string, unknown>>(t.procs as never).map((p) => ({
          pid: Number(p.pid) || 0,
          name: String(p.name ?? ""),
          cpuSec: Number(p.cpu) || 0,
          wsMb: Number(p.ws) || 0,
          cmd: p.cmd ? String(p.cmd) : null,
        })),
        actionFiles: arr<Record<string, unknown>>(t.actionFiles as never).map((f) => ({
          path: String(f.path ?? ""),
          exists: Boolean(f.exists),
        })),
        port: t.port === null || t.port === undefined ? null : Number(t.port) || null,
        portOn: t.portOn ? String(t.portOn) : null,
      })),
    };
  } catch {
    return null;
  }
}
