/**
 * LiTT RAM Watchdog — safety-first memory monitor and launch gate.
 *
 * Contract:
 *  - Monitoring and launch gating are always active. Gating FAILS CLOSED at
 *    the block threshold (default 2 GB available).
 *  - Automatic process termination is DISABLED by default and additionally
 *    requires a recorded live-safety-validation timestamp. Planning is the
 *    only thing this module ever does; it never kills a process itself.
 *  - A process may only be considered for cleanup when all four identity
 *    signals agree: PID, creation time, ownership claim, and command-line
 *    markers. Any missing/mismatched signal means "never touch".
 *  - Ollama models are never unloaded while a local AI request or a Studio
 *    generation is active.
 *
 * All filesystem and process access is injectable so every rule is testable
 * without touching the live machine.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { cpus, freemem, homedir, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { assertHostExecutionPermitted } from "@/lib/host-execution-guard";

// This module starts host processes (PowerShell probes). It is only
// reachable through the operator CLI (src/lib/ram-watchdog/cli.ts) and its
// test — nothing under src/app imports it — but the assert keeps every
// probe fail-closed if any server path ever invokes it in production.
// Applied per-call (not at module load) so unit tests can import pure
// helpers under NODE_ENV=test without requiring the opt-in env.
function powershellProbe(
  args: string[],
  opts: { encoding: "utf8"; timeout: number; windowsHide: boolean },
): string {
  assertHostExecutionPermitted("ram-watchdog/core");
  return execFileSync("powershell", args, opts);
}

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

export interface RamThresholds {
  /** Warn when available RAM drops to/below this (MB). */
  warnAvailableMb: number;
  /** Block new launches when available RAM is below this (MB). */
  blockAvailableMb: number;
}

export interface TerminationConfig {
  /** Hard off by default — the operator must opt in. */
  enabled: boolean;
  /** ISO timestamp set only after live safety validation passed. */
  safetyValidatedAt: string | null;
  /** Claim owners the watchdog is authorized to clean up. Empty = fail closed. */
  authorizedClaimOwners: string[];
  /** Process names that are never cleanup candidates. */
  protectedProcessNames: string[];
  /** Ports whose owning process is never a cleanup candidate. */
  protectedPorts: number[];
  /** Command-line fragments that mark a process as protected. */
  protectedCommandMarkers: string[];
}

export interface OllamaProtectionConfig {
  endpoint: string;
  /** Refuse unloads while activity is detected. */
  protectWhenActive: boolean;
  /** How long an activity marker stays valid without renewal. */
  activityTtlMs: number;
}

export interface LoggingConfig {
  maxBytes: number;
  maxFiles: number;
}

export interface ClaimsConfig {
  staleAfterMs: number;
}

export interface WatchdogConfig {
  version: 1;
  thresholds: RamThresholds;
  pollIntervalMs: number;
  launchGate: { enabled: boolean };
  termination: TerminationConfig;
  ollama: OllamaProtectionConfig;
  logging: LoggingConfig;
  claims: ClaimsConfig;
}

export function defaultConfig(): WatchdogConfig {
  return {
    version: 1,
    thresholds: { warnAvailableMb: 4096, blockAvailableMb: 2048 },
    pollIntervalMs: 5000,
    launchGate: { enabled: true },
    termination: {
      enabled: false,
      safetyValidatedAt: null,
      // Fail closed: no owner is authorized to be cleaned up until an
      // operator explicitly lists one. Unrelated agents are therefore
      // untouchable even if every identity signal matches.
      authorizedClaimOwners: [],
      protectedProcessNames: ["devin", "claude", "code", "cursor", "ollama", "codex", "node", "studio", "explorer", "csrss", "wininit", "services", "lsass"],
      protectedPorts: [3001, 3101, 3201, 4001, 11434],
      protectedCommandMarkers: [
        "devin",
        "claude",
        "studio",
        "ollama",
        "codex",
        "next dev",
        "next build",
        "terminal-server",
        "tsc",
        "vitest",
      ],
    },
    ollama: {
      endpoint: process.env.LITT_OLLAMA_URL ?? "http://127.0.0.1:11434",
      protectWhenActive: true,
      activityTtlMs: 10 * 60 * 1000,
    },
    logging: { maxBytes: 5 * 1024 * 1024, maxFiles: 5 },
    claims: { staleAfterMs: 15 * 60 * 1000 },
  };
}

/** Env bag narrower than NodeJS.ProcessEnv (which Next augmentation pins NODE_ENV on). */
export type EnvLike = Record<string, string | undefined>;

export interface Paths {
  stateDir: string;
  logsDir: string;
  claimsDir: string;
  activityDir: string;
  lockPath: string;
  statePath: string;
  logPath: string;
  configPath: string;
}

export function resolvePaths(
  opts: { homeDir?: string; env?: EnvLike } = {},
): Paths {
  const env = opts.env ?? process.env;
  const home = opts.homeDir ?? homedir();
  const stateDir = env.LITT_RAM_WATCHDOG_DIR ?? join(home, ".litt", "ram-watchdog");
  const logsDir = join(stateDir, "logs");
  return {
    stateDir,
    logsDir,
    claimsDir: join(stateDir, "claims"),
    activityDir: join(stateDir, "activity"),
    lockPath: join(stateDir, "watchdog.lock"),
    statePath: join(stateDir, "status.json"),
    logPath: join(logsDir, "ram-watchdog.jsonl"),
    configPath: env.LITT_RAM_WATCHDOG_CONFIG ?? join(home, ".litt", "ram-watchdog.json"),
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Validate and merge a partial config over safe defaults.
 * Invalid thresholds never silently loosen the gate: the offending value is
 * reported and the safe default is kept.
 */
export function normalizeConfig(raw: unknown): {
  config: WatchdogConfig;
  warnings: string[];
  errors: string[];
} {
  const config = defaultConfig();
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!isRecord(raw)) {
    if (raw !== undefined) errors.push("config root is not an object — using defaults");
    return { config, warnings, errors };
  }

  const thresholds = isRecord(raw.thresholds) ? raw.thresholds : undefined;
  if (thresholds) {
    const warnRaw = thresholds.warnAvailableMb;
    const blockRaw = thresholds.blockAvailableMb;
    if (typeof warnRaw === "number" && Number.isFinite(warnRaw)) {
      config.thresholds.warnAvailableMb = Math.round(warnRaw);
    } else if (warnRaw !== undefined) {
      errors.push("thresholds.warnAvailableMb is not a number — default kept");
    }
    if (typeof blockRaw === "number" && Number.isFinite(blockRaw)) {
      config.thresholds.blockAvailableMb = Math.round(blockRaw);
    } else if (blockRaw !== undefined) {
      errors.push("thresholds.blockAvailableMb is not a number — default kept");
    }
  }
  if (config.thresholds.blockAvailableMb < 256) {
    errors.push("thresholds.blockAvailableMb below 256 MB is unsafe — default 2048 kept");
    config.thresholds.blockAvailableMb = 2048;
  }
  if (config.thresholds.warnAvailableMb <= config.thresholds.blockAvailableMb) {
    errors.push(
      `thresholds.warnAvailableMb (${config.thresholds.warnAvailableMb}) must exceed blockAvailableMb (${config.thresholds.blockAvailableMb}) — defaults kept`,
    );
    config.thresholds.warnAvailableMb = 4096;
    config.thresholds.blockAvailableMb = 2048;
  }

  config.pollIntervalMs = Math.round(num(raw.pollIntervalMs, config.pollIntervalMs));
  if (config.pollIntervalMs < 250 || config.pollIntervalMs > 600_000) {
    errors.push("pollIntervalMs out of range (250..600000) — default 5000 kept");
    config.pollIntervalMs = 5000;
  }

  if (isRecord(raw.launchGate) && typeof raw.launchGate.enabled === "boolean") {
    config.launchGate.enabled = raw.launchGate.enabled;
  }

  if (isRecord(raw.termination)) {
    const t = raw.termination;
    // Termination can only be turned ON by the config file, and even then
    // remains gated by safetyValidatedAt.
    if (typeof t.enabled === "boolean") config.termination.enabled = t.enabled;
    if (typeof t.safetyValidatedAt === "string" && !Number.isNaN(Date.parse(t.safetyValidatedAt))) {
      config.termination.safetyValidatedAt = t.safetyValidatedAt;
    }
    if (Array.isArray(t.protectedProcessNames)) {
      config.termination.protectedProcessNames = t.protectedProcessNames.map((n) => String(n).toLowerCase());
    }
    if (Array.isArray(t.protectedPorts)) {
      config.termination.protectedPorts = t.protectedPorts
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
    }
    if (Array.isArray(t.protectedCommandMarkers)) {
      config.termination.protectedCommandMarkers = t.protectedCommandMarkers.map((m) => String(m).toLowerCase());
    }
    if (Array.isArray(t.authorizedClaimOwners)) {
      config.termination.authorizedClaimOwners = t.authorizedClaimOwners.map((o) => String(o)).filter(Boolean);
    }
  }

  if (isRecord(raw.ollama)) {
    const o = raw.ollama;
    if (typeof o.endpoint === "string" && o.endpoint.startsWith("http")) config.ollama.endpoint = o.endpoint;
    if (typeof o.protectWhenActive === "boolean") config.ollama.protectWhenActive = o.protectWhenActive;
    config.ollama.activityTtlMs = Math.round(num(o.activityTtlMs, config.ollama.activityTtlMs));
  }

  if (isRecord(raw.logging)) {
    config.logging.maxBytes = Math.round(num(raw.logging.maxBytes, config.logging.maxBytes));
    config.logging.maxFiles = Math.round(num(raw.logging.maxFiles, config.logging.maxFiles));
  }
  if (config.logging.maxBytes < 1024) {
    errors.push("logging.maxBytes too small — default 5 MB kept");
    config.logging.maxBytes = 5 * 1024 * 1024;
  }
  if (config.logging.maxFiles < 1 || config.logging.maxFiles > 50) {
    errors.push("logging.maxFiles out of range (1..50) — default 5 kept");
    config.logging.maxFiles = 5;
  }

  if (isRecord(raw.claims)) {
    config.claims.staleAfterMs = Math.round(num(raw.claims.staleAfterMs, config.claims.staleAfterMs));
  }

  return { config, warnings, errors };
}

/** Environment overrides. Termination can never be enabled by env alone. */
export function applyEnvOverrides(
  base: WatchdogConfig,
  env: EnvLike = process.env,
): { config: WatchdogConfig; warnings: string[]; errors: string[] } {
  const raw: Record<string, unknown> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  const thresholds: Record<string, unknown> = {};

  for (const [key, field] of [
    ["LITT_RAM_WARN_MB", "warnAvailableMb"],
    ["LITT_RAM_BLOCK_MB", "blockAvailableMb"],
  ] as const) {
    const v = env[key];
    if (v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) thresholds[field] = n;
    else errors.push(`${key} is not a positive number — ignored`);
  }
  if (Object.keys(thresholds).length) raw.thresholds = thresholds;

  if (env.LITT_RAM_POLL_MS) {
    const n = Number(env.LITT_RAM_POLL_MS);
    if (Number.isFinite(n) && n > 0) raw.pollIntervalMs = n;
    else errors.push("LITT_RAM_POLL_MS is not a positive number — ignored");
  }

  if (env.LITT_RAM_WATCHDOG_LOG_DIR) {
    warnings.push("LITT_RAM_WATCHDOG_LOG_DIR is deprecated — set LITT_RAM_WATCHDOG_DIR");
  }

  // Merge env over the current config, preserving explicit config values.
  const current: Partial<WatchdogConfig> = {
    ...base,
    thresholds: { ...base.thresholds, ...((raw.thresholds as Partial<RamThresholds>) ?? {}) },
    pollIntervalMs: (raw.pollIntervalMs as number) ?? base.pollIntervalMs,
  };
  const normalized = normalizeConfig(current);
  normalized.errors.unshift(...errors);
  normalized.warnings.unshift(...warnings);
  return normalized;
}

export function loadConfig(opts: {
  configPath?: string;
  env?: EnvLike;
  readFile?: (path: string) => string;
} = {}): { config: WatchdogConfig; warnings: string[]; errors: string[]; source: "defaults" | "file" } {
  const env = opts.env ?? process.env;
  const paths = resolvePaths({ env });
  const configPath = opts.configPath ?? paths.configPath;
  const read = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const warnings: string[] = [];
  const errors: string[] = [];
  let source: "defaults" | "file" = "defaults";
  let raw: unknown;
  if (existsSync(configPath)) {
    try {
      raw = JSON.parse(read(configPath));
      source = "file";
    } catch (err) {
      errors.push(`config at ${configPath} is not valid JSON — defaults kept (${String(err)})`);
    }
  }
  const normalized = normalizeConfig(raw);
  warnings.push(...normalized.warnings);
  errors.push(...normalized.errors);
  const withEnv = applyEnvOverrides(normalized.config, env);
  warnings.push(...withEnv.warnings);
  errors.push(...withEnv.errors);
  return { config: withEnv.config, warnings, errors, source };
}

/* ------------------------------------------------------------------ */
/*  RAM sampling                                                       */
/* ------------------------------------------------------------------ */

export interface RamProbe {
  totalMb: number;
  availableMb: number;
}

export interface RamSnapshot {
  capturedAt: string;
  totalMb: number;
  availableMb: number;
  usedMb: number;
  usedPct: number;
  source: "os";
}

export function osRamProbe(): RamProbe {
  return {
    totalMb: Math.round(totalmem() / 1024 / 1024),
    availableMb: Math.round(freemem() / 1024 / 1024),
  };
}

export function readRamSnapshot(
  probe: () => RamProbe = osRamProbe,
  now: Date = new Date(),
): RamSnapshot {
  const p = probe();
  const totalMb = Math.max(0, Math.round(p.totalMb));
  const availableMb = Math.min(totalMb, Math.max(0, Math.round(p.availableMb)));
  return {
    capturedAt: now.toISOString(),
    totalMb,
    availableMb,
    usedMb: totalMb - availableMb,
    usedPct: totalMb === 0 ? 0 : Math.round(((totalMb - availableMb) / totalMb) * 1000) / 10,
    source: "os",
  };
}

export interface CpuTimes {
  idleMs: number;
  totalMs: number;
}

export function readCpuTimes(): CpuTimes {
  let idleMs = 0;
  let totalMs = 0;
  for (const cpu of cpus()) {
    idleMs += cpu.times.idle;
    totalMs += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idleMs, totalMs };
}

/** CPU busy percentage between two samples (all cores). */
export function cpuPercentBetween(prev: CpuTimes, curr: CpuTimes): number {
  const dTotal = curr.totalMs - prev.totalMs;
  const dIdle = curr.idleMs - prev.idleMs;
  if (dTotal <= 0) return 0;
  return Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
}

export interface ProcessActivity {
  total: number;
  node: number;
  ollama: number;
  devin: number;
  claude: number;
}

export function readProcessActivity(): ProcessActivity {
  const empty: ProcessActivity = { total: 0, node: 0, ollama: 0, devin: 0, claude: 0 };
  if (process.platform !== "win32") return empty;
  try {
    const out = powershellProbe(
      [
        "-NoProfile",
        "-Command",
        "$p = @(Get-Process -ErrorAction SilentlyContinue); @{ total=$p.Count; node=@($p | Where-Object { $_.ProcessName -ieq 'node' }).Count; ollama=@($p | Where-Object { $_.ProcessName -ieq 'ollama' }).Count; devin=@($p | Where-Object { $_.ProcessName -ieq 'devin' }).Count; claude=@($p | Where-Object { $_.ProcessName -ieq 'claude' }).Count } | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    ).trim();
    if (!out) return empty;
    const j = JSON.parse(out) as Record<string, unknown>;
    return {
      total: Number(j.total) || 0,
      node: Number(j.node) || 0,
      ollama: Number(j.ollama) || 0,
      devin: Number(j.devin) || 0,
      claude: Number(j.claude) || 0,
    };
  } catch {
    return empty;
  }
}

export type RamLevel = "ok" | "warn" | "block";

export function classifyRam(availableMb: number, thresholds: RamThresholds): RamLevel {
  // "blocking at 2 GB available" means at-or-below, same as the 4 GB warning.
  if (availableMb <= thresholds.blockAvailableMb) return "block";
  if (availableMb <= thresholds.warnAvailableMb) return "warn";
  return "ok";
}

export interface GateDecision {
  allowed: boolean;
  level: RamLevel;
  reason: string;
  availableMb: number;
  thresholds: RamThresholds;
  checkedAt: string;
}

export function evaluateLaunchGate(
  snapshot: RamSnapshot,
  config: WatchdogConfig,
  now: Date = new Date(),
): GateDecision {
  const level = classifyRam(snapshot.availableMb, config.thresholds);
  const checkedAt = now.toISOString();
  if (!config.launchGate.enabled) {
    return {
      allowed: true,
      level,
      reason: "launch gate disabled by configuration (monitoring still active)",
      availableMb: snapshot.availableMb,
      thresholds: config.thresholds,
      checkedAt,
    };
  }
  if (level === "block") {
    return {
      allowed: false,
      level,
      reason: `available RAM ${snapshot.availableMb} MB is below block threshold ${config.thresholds.blockAvailableMb} MB`,
      availableMb: snapshot.availableMb,
      thresholds: config.thresholds,
      checkedAt,
    };
  }
  if (level === "warn") {
    return {
      allowed: true,
      level,
      reason: `available RAM ${snapshot.availableMb} MB is at/below warn threshold ${config.thresholds.warnAvailableMb} MB`,
      availableMb: snapshot.availableMb,
      thresholds: config.thresholds,
      checkedAt,
    };
  }
  return {
    allowed: true,
    level,
    reason: `available RAM ${snapshot.availableMb} MB is above warn threshold ${config.thresholds.warnAvailableMb} MB`,
    availableMb: snapshot.availableMb,
    thresholds: config.thresholds,
    checkedAt,
  };
}

export interface RamModule {
  bankLabel: string;
  capacityMb: number;
  speedMhz: number | null;
}

/**
 * Windows-only physical module probe. Returns [] on any failure — a failed
 * probe is "unknown", never "recognized".
 */
export function readPhysicalModules(): RamModule[] {
  if (process.platform !== "win32") return [];
  try {
    const out = powershellProbe(
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_PhysicalMemory | Select-Object BankLabel,Capacity,Speed | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 15_000, windowsHide: true },
    ).trim();
    if (!out) return [];
    const parsed: unknown = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.filter(isRecord).map((r) => ({
      bankLabel: String(r.BankLabel ?? "?"),
      capacityMb: Math.round(Number(r.Capacity ?? 0) / 1024 / 1024),
      speedMhz: Number.isFinite(Number(r.Speed)) ? Number(r.Speed) : null,
    }));
  } catch {
    return [];
  }
}

export interface RamRecognition {
  expectedMb: number;
  toleranceMb: number;
  detectedTotalMb: number;
  moduleTotalMb: number;
  modules: RamModule[];
  recognized: boolean;
  notes: string[];
}

export function verifyInstalledRam(opts: {
  expectedMb?: number;
  toleranceMb?: number;
  probe?: () => RamProbe;
  modules?: () => RamModule[];
} = {}): RamRecognition {
  const expectedMb = opts.expectedMb ?? 32768;
  const toleranceMb = opts.toleranceMb ?? 1024;
  const snapshot = readRamSnapshot(opts.probe ?? osRamProbe);
  const modules = (opts.modules ?? readPhysicalModules)();
  const moduleTotalMb = modules.reduce((sum, m) => sum + m.capacityMb, 0);
  const notes: string[] = [];
  const withinOs = Math.abs(snapshot.totalMb - expectedMb) <= toleranceMb;
  if (!withinOs) notes.push(`OS reports ${snapshot.totalMb} MB vs expected ${expectedMb} MB ±${toleranceMb}`);
  if (modules.length === 0) notes.push("physical module probe returned no data (unknown, not a failure of detection)");
  const modulesAgree = modules.length === 0 || Math.abs(moduleTotalMb - snapshot.totalMb) <= toleranceMb * 2;
  if (!modulesAgree) notes.push(`module total ${moduleTotalMb} MB disagrees with OS total ${snapshot.totalMb} MB`);
  return {
    expectedMb,
    toleranceMb,
    detectedTotalMb: snapshot.totalMb,
    moduleTotalMb,
    modules,
    recognized: withinOs && modulesAgree,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Process identity                                                   */
/* ------------------------------------------------------------------ */

export interface ProcessInfo {
  pid: number;
  name: string;
  parentPid: number | null;
  creationTime: string | null;
  commandLine: string | null;
}

export type ProcessReader = (pid: number) => ProcessInfo | null;

export interface OwnershipClaim {
  pid: number;
  creationTime: string;
  owner: string;
  token: string;
  createdAt: string;
}

export interface IdentityExpectation {
  pid: number;
  creationTime: string | null;
  claim: OwnershipClaim | null;
  commandLineMarkers: string[];
}

export interface IdentityResult {
  verified: boolean;
  reasons: string[];
  checks: {
    alive: boolean;
    creationTimeMatch: boolean;
    ownershipClaimMatch: boolean;
    commandLineMarkersMatch: boolean;
  };
  actual: ProcessInfo | null;
}

const CREATION_TIME_TOLERANCE_MS = 2000;

function sameInstant(a: string | null, b: string | null, toleranceMs = CREATION_TIME_TOLERANCE_MS): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= toleranceMs;
}

function redactCommandLine(cmd: string | null): string | null {
  if (!cmd) return cmd;
  return cmd.replace(/(KEY|TOKEN|SECRET|PASSWORD|PASS)=([^\s"']+)/gi, "$1=[REDACTED]").slice(0, 512);
}

export function readProcessInfo(pid: number): ProcessInfo | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return { pid, name: "unknown", parentPid: null, creationTime: null, commandLine: null };
    } catch {
      return null;
    }
  }
  try {
    const script = `
$ErrorActionPreference='SilentlyContinue'
$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"
if (-not $p) { 'null' } else {
  @{
    pid = $p.ProcessId
    name = $p.Name
    ppid = $p.ParentProcessId
    commandLine = $p.CommandLine
    creationTime = $(if ($p.CreationDate) { $p.CreationDate.ToUniversalTime().ToString('o') } else { $null })
  } | ConvertTo-Json -Compress
}`;
    const out = powershellProbe(["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 15_000,
      windowsHide: true,
    }).trim();
    if (!out || out === "null") return null;
    const j = JSON.parse(out) as Record<string, unknown>;
    return {
      pid: Number(j.pid) || pid,
      name: String(j.name ?? ""),
      parentPid: Number.isFinite(Number(j.ppid)) ? Number(j.ppid) : null,
      creationTime: typeof j.creationTime === "string" ? j.creationTime : null,
      commandLine: redactCommandLine(typeof j.commandLine === "string" ? j.commandLine : null),
    };
  } catch {
    return null;
  }
}

/**
 * Verify a process before any cleanup. All four signals must agree.
 * Missing claim or missing command-line markers is a FAILURE, not a pass.
 */
export function verifyProcessIdentity(
  expectation: IdentityExpectation,
  info: ProcessInfo | null,
  opts: { toleranceMs?: number } = {},
): IdentityResult {
  const reasons: string[] = [];
  const tolerance = opts.toleranceMs ?? CREATION_TIME_TOLERANCE_MS;
  const alive = !!info && info.pid === expectation.pid;
  if (!alive) reasons.push(`pid ${expectation.pid} is not running`);

  const creationTimeMatch = alive && sameInstant(expectation.creationTime, info?.creationTime ?? null, tolerance);
  if (alive && !creationTimeMatch) {
    reasons.push(
      `creation time mismatch (expected ${expectation.creationTime ?? "unknown"}, actual ${info?.creationTime ?? "unknown"}) — possible PID reuse`,
    );
  }

  let ownershipClaimMatch = false;
  const claim = expectation.claim;
  if (!claim) {
    reasons.push("no ownership claim supplied");
  } else if (!claim.token || !claim.owner) {
    reasons.push("ownership claim is missing owner or token");
  } else if (claim.pid !== expectation.pid) {
    reasons.push(`ownership claim is for pid ${claim.pid}, not ${expectation.pid}`);
  } else if (!sameInstant(claim.creationTime, info?.creationTime ?? null, tolerance)) {
    reasons.push("ownership claim creation time does not match the live process");
  } else {
    ownershipClaimMatch = true;
  }

  const markers = expectation.commandLineMarkers.map((m) => m.trim().toLowerCase()).filter(Boolean);
  const cmd = (info?.commandLine ?? "").toLowerCase();
  const commandLineMarkersMatch = markers.length > 0 && markers.every((m) => cmd.includes(m));
  if (markers.length === 0) reasons.push("no command-line markers supplied");
  else if (!commandLineMarkersMatch) reasons.push(`command line missing marker(s): ${markers.join(", ")}`);

  return {
    verified: alive && creationTimeMatch && ownershipClaimMatch && commandLineMarkersMatch,
    reasons,
    checks: { alive, creationTimeMatch, ownershipClaimMatch, commandLineMarkersMatch },
    actual: info,
  };
}

/* ------------------------------------------------------------------ */
/*  Ownership claims                                                   */
/* ------------------------------------------------------------------ */

export function claimFileName(claim: Pick<OwnershipClaim, "pid" | "creationTime">): string {
  const stamp = (claim.creationTime || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 20);
  return `${claim.pid}-${stamp || "unknown"}.json`;
}

export function writeOwnershipClaim(claimsDir: string, claim: OwnershipClaim): string {
  mkdirSync(claimsDir, { recursive: true });
  const path = join(claimsDir, claimFileName(claim));
  writeFileSync(path, JSON.stringify(claim, null, 2), "utf8");
  return path;
}

export function readOwnershipClaim(path: string): OwnershipClaim | null {
  try {
    const j: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(j)) return null;
    const pid = Number(j.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (typeof j.creationTime !== "string" || typeof j.owner !== "string" || typeof j.token !== "string") {
      return null;
    }
    return {
      pid,
      creationTime: j.creationTime,
      owner: j.owner,
      token: j.token,
      createdAt: typeof j.createdAt === "string" ? j.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export interface ClaimSweepResult {
  removed: string[];
  kept: string[];
  refused: string[];
}

/**
 * Remove claims that cannot be tied to a live, matching process.
 * A claim for a live process with a matching creation time is never removed,
 * regardless of age. Unreadable claims are refused (left alone), not deleted.
 */
export function sweepStaleClaims(opts: {
  claimsDir: string;
  readProcess?: ProcessReader;
  now?: Date;
}): ClaimSweepResult {
  const readProcess = opts.readProcess ?? readProcessInfo;
  const result: ClaimSweepResult = { removed: [], kept: [], refused: [] };
  if (!existsSync(opts.claimsDir)) return result;
  let files: string[];
  try {
    files = readdirSync(opts.claimsDir).filter((f) => f.endsWith(".json"));
  } catch {
    return result;
  }

  const byPid = new Map<number, { file: string; claim: OwnershipClaim }[]>();
  for (const file of files) {
    const full = join(opts.claimsDir, file);
    const claim = readOwnershipClaim(full);
    if (!claim) {
      try {
        rmSync(full, { force: true });
        result.removed.push(file);
      } catch {
        result.refused.push(file);
      }
      continue;
    }
    const info = readProcess(claim.pid);
    const live = !!info && sameInstant(claim.creationTime, info.creationTime);
    if (!live) {
      try {
        rmSync(full, { force: true });
        result.removed.push(file);
      } catch {
        result.refused.push(file);
      }
      continue;
    }
    const list = byPid.get(claim.pid) ?? [];
    list.push({ file, claim });
    byPid.set(claim.pid, list);
  }

  // Duplicate claims for the same live pid: keep the newest, drop the rest.
  for (const list of byPid.values()) {
    list.sort((a, b) => Date.parse(b.claim.createdAt) - Date.parse(a.claim.createdAt) || b.file.localeCompare(a.file));
    list.forEach((entry, idx) => {
      if (idx === 0) {
        result.kept.push(entry.file);
        return;
      }
      try {
        rmSync(join(opts.claimsDir, entry.file), { force: true });
        result.removed.push(entry.file);
      } catch {
        result.refused.push(entry.file);
      }
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Single-instance lock                                               */
/* ------------------------------------------------------------------ */

export interface LockInfo {
  version: 1;
  pid: number;
  creationTime: string | null;
  owner: string;
  token: string;
  acquiredAt: string;
}

export type LockResult =
  | { ok: true; info: LockInfo; reclaimed: LockInfo | null }
  | { ok: false; holder: LockInfo | null; reason: string };

function parseLock(raw: string): LockInfo | null {
  try {
    const j: unknown = JSON.parse(raw);
    if (!isRecord(j)) return null;
    const pid = Number(j.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    if (typeof j.token !== "string" || !j.token) return null;
    return {
      version: 1,
      pid,
      creationTime: typeof j.creationTime === "string" ? j.creationTime : null,
      owner: typeof j.owner === "string" ? j.owner : "unknown",
      token: j.token,
      acquiredAt: typeof j.acquiredAt === "string" ? j.acquiredAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Atomic single-instance enforcement. A lock whose owner is alive AND whose
 * creation time matches is honored; anything else is reclaimed exactly once.
 */
export function acquireSingleInstanceLock(opts: {
  lockPath: string;
  pid?: number;
  creationTime?: string | null;
  owner?: string;
  readProcess?: ProcessReader;
  now?: Date;
}): LockResult {
  const readProcess = opts.readProcess ?? readProcessInfo;
  const now = opts.now ?? new Date();
  const pid = opts.pid ?? process.pid;
  const info: LockInfo = {
    version: 1,
    pid,
    creationTime: opts.creationTime ?? readProcess(pid)?.creationTime ?? null,
    owner: opts.owner ?? "litt-ram-watchdog",
    token: randomUUID(),
    acquiredAt: now.toISOString(),
  };
  mkdirSync(dirname(opts.lockPath), { recursive: true });

  const attempt = (): { ok: true; info: LockInfo; reclaimed: LockInfo | null } | null => {
    try {
      const fd = openSync(opts.lockPath, "wx");
      try {
        writeSync(fd, JSON.stringify(info, null, 2));
      } finally {
        closeSync(fd);
      }
      return { ok: true, info, reclaimed: null };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      return null;
    }
  };

  const first = attempt();
  if (first) return first;

  let holder: LockInfo | null = null;
  try {
    holder = parseLock(readFileSync(opts.lockPath, "utf8"));
  } catch {
    holder = null;
  }

  const holderInfo = holder ? readProcess(holder.pid) : null;
  const holderAlive =
    !!holder &&
    !!holderInfo &&
    (!holder.creationTime || sameInstant(holder.creationTime, holderInfo.creationTime));

  if (holderAlive) {
    return { ok: false, holder, reason: `watchdog already running as pid ${holder?.pid}` };
  }

  // Reclaim: move the dead lock aside, then retry the atomic create once.
  try {
    renameSync(opts.lockPath, `${opts.lockPath}.stale.${now.getTime()}`);
  } catch {
    try {
      rmSync(opts.lockPath, { force: true });
    } catch {
      return { ok: false, holder, reason: "unable to reclaim stale lock" };
    }
  }
  const second = attempt();
  if (second) return { ok: true, info: second.info, reclaimed: holder };
  return { ok: false, holder, reason: "lock was re-acquired by another process during reclaim" };
}

export function releaseSingleInstanceLock(lockPath: string, token: string): boolean {
  try {
    const holder = parseLock(readFileSync(lockPath, "utf8"));
    if (!holder || holder.token !== token) return false;
    rmSync(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export interface LockStatus {
  held: boolean;
  holder: LockInfo | null;
  ownerAlive: boolean;
}

export function inspectLock(lockPath: string, readProcess: ProcessReader = readProcessInfo): LockStatus {
  try {
    const holder = parseLock(readFileSync(lockPath, "utf8"));
    if (!holder) return { held: true, holder: null, ownerAlive: false };
    const info = readProcess(holder.pid);
    const ownerAlive = !!info && (!holder.creationTime || sameInstant(holder.creationTime, info.creationTime));
    return { held: true, holder, ownerAlive };
  } catch {
    return { held: false, holder: null, ownerAlive: false };
  }
}

/* ------------------------------------------------------------------ */
/*  Log rotation                                                       */
/* ------------------------------------------------------------------ */

export interface RotateResult {
  rotated: boolean;
  files: string[];
}

/** Size-based rotation: log -> log.1 -> log.2 ..., oldest deleted first. */
export function rotateLogIfNeeded(
  logPath: string,
  opts: { maxBytes: number; maxFiles: number },
): RotateResult {
  mkdirSync(dirname(logPath), { recursive: true });
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return { rotated: false, files: [] };
  }
  if (size < opts.maxBytes) return { rotated: false, files: [] };

  const maxFiles = Math.max(1, opts.maxFiles);
  // Delete the oldest archive that would exceed the retention window.
  for (let idx = maxFiles; idx >= 1; idx--) {
    const archive = `${logPath}.${idx}`;
    if (!existsSync(archive)) continue;
    if (idx >= maxFiles) {
      try {
        rmSync(archive, { force: true });
      } catch {
        /* leave it; next rotation will retry */
      }
    } else {
      try {
        renameSync(archive, `${logPath}.${idx + 1}`);
      } catch {
        /* leave it */
      }
    }
  }
  try {
    renameSync(logPath, `${logPath}.1`);
  } catch {
    return { rotated: false, files: [] };
  }
  const files: string[] = [];
  for (let idx = 1; idx <= maxFiles; idx++) {
    const archive = `${logPath}.${idx}`;
    if (existsSync(archive)) files.push(archive);
  }
  return { rotated: true, files };
}

export function appendWatchdogLog(
  logPath: string,
  record: Record<string, unknown>,
  opts: { maxBytes: number; maxFiles: number },
): { rotated: boolean } {
  const rotation = rotateLogIfNeeded(logPath, opts);
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`;
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, line.length > 4096 ? `${line.slice(0, 4096)}\n` : line, "utf8");
  return { rotated: rotation.rotated };
}

/* ------------------------------------------------------------------ */
/*  Startup recovery                                                   */
/* ------------------------------------------------------------------ */

export interface WatchdogStatus {
  status: "running" | "stopped" | "recovered";
  pid: number;
  owner: string;
  startedAt: string;
  updatedAt: string;
  crashCount: number;
  note?: string;
}

export interface RecoveryReport {
  recoveredPreviousRun: boolean;
  crashCount: number;
  claimsRemoved: string[];
  claimsKept: string[];
  claimsRefused: string[];
  logRotated: boolean;
  dirs: string[];
  notes: string[];
}

export function readStatus(path: string): WatchdogStatus | null {
  try {
    const j: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(j) || typeof j.status !== "string") return null;
    return {
      status: j.status as WatchdogStatus["status"],
      pid: Number(j.pid) || 0,
      owner: String(j.owner ?? "unknown"),
      startedAt: String(j.startedAt ?? ""),
      updatedAt: String(j.updatedAt ?? ""),
      crashCount: Number(j.crashCount) || 0,
      note: typeof j.note === "string" ? j.note : undefined,
    };
  } catch {
    return null;
  }
}

export function writeStatus(path: string, status: WatchdogStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(status, null, 2), "utf8");
  renameSync(tmp, path);
}

export function recoverOnStartup(opts: {
  paths: Paths;
  config: WatchdogConfig;
  readProcess?: ProcessReader;
  now?: Date;
}): RecoveryReport {
  const readProcess = opts.readProcess ?? readProcessInfo;
  const now = opts.now ?? new Date();
  const dirs = [opts.paths.stateDir, opts.paths.logsDir, opts.paths.claimsDir, opts.paths.activityDir];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  const notes: string[] = [];
  const previous = readStatus(opts.paths.statePath);
  let recoveredPreviousRun = false;
  let crashCount = previous?.crashCount ?? 0;

  if (previous?.status === "running") {
    const info = previous.pid > 0 ? readProcess(previous.pid) : null;
    if (!info) {
      recoveredPreviousRun = true;
      crashCount += 1;
      notes.push(`previous run (pid ${previous.pid}) is gone — marked recovered`);
    } else {
      notes.push(`previous run (pid ${previous.pid}) is still alive — status left untouched`);
    }
  }
  if (recoveredPreviousRun) {
    writeStatus(opts.paths.statePath, {
      status: "recovered",
      pid: previous?.pid ?? 0,
      owner: previous?.owner ?? "unknown",
      startedAt: previous?.startedAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
      crashCount,
      note: "recovered after unclean shutdown",
    });
  }

  const sweep = sweepStaleClaims({ claimsDir: opts.paths.claimsDir, readProcess, now });
  if (sweep.removed.length) notes.push(`removed ${sweep.removed.length} stale claim(s)`);
  if (sweep.refused.length) notes.push(`${sweep.refused.length} claim(s) could not be removed`);

  const rotation = rotateLogIfNeeded(opts.paths.logPath, opts.config.logging);
  if (rotation.rotated) notes.push("rotated watchdog log at startup");

  return {
    recoveredPreviousRun,
    crashCount,
    claimsRemoved: sweep.removed,
    claimsKept: sweep.kept,
    claimsRefused: sweep.refused,
    logRotated: rotation.rotated,
    dirs,
    notes,
  };
}

/* ------------------------------------------------------------------ */
/*  Ollama / local AI protection                                       */
/* ------------------------------------------------------------------ */

export interface OllamaModel {
  name: string;
  sizeBytes: number;
  sizeVramBytes: number | null;
  expiresAt: string | null;
}

export interface ActivityMarker {
  reason: string;
  activeFrom: string;
  expiresAt: string;
}

export function activityMarkerPath(activityDir: string): string {
  return join(activityDir, "studio-generation.json");
}

export function writeActivityMarker(
  activityDir: string,
  opts: { reason?: string; ttlMs?: number; now?: Date } = {},
): ActivityMarker {
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
  const marker: ActivityMarker = {
    reason: opts.reason ?? "studio-generation",
    activeFrom: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  mkdirSync(activityDir, { recursive: true });
  writeFileSync(activityMarkerPath(activityDir), JSON.stringify(marker, null, 2), "utf8");
  return marker;
}

export function readActivityMarker(activityDir: string, now: Date = new Date()): ActivityMarker | null {
  try {
    const j: unknown = JSON.parse(readFileSync(activityMarkerPath(activityDir), "utf8"));
    if (!isRecord(j) || typeof j.expiresAt !== "string") return null;
    const expires = Date.parse(j.expiresAt);
    if (Number.isNaN(expires) || expires <= now.getTime()) return null;
    return {
      reason: String(j.reason ?? "unknown"),
      activeFrom: String(j.activeFrom ?? ""),
      expiresAt: j.expiresAt,
    };
  } catch {
    return null;
  }
}

export function clearActivityMarker(activityDir: string): void {
  rmSync(activityMarkerPath(activityDir), { force: true });
}

export function countEstablishedOllamaConnections(port = 11434): number {
  if (process.platform !== "win32") return 0;
  try {
    const out = powershellProbe(
      [
        "-NoProfile",
        "-Command",
        `@(Get-NetTCPConnection -LocalPort ${port} -State Established -ErrorAction SilentlyContinue).Count`,
      ],
      { encoding: "utf8", timeout: 10_000, windowsHide: true },
    ).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export interface OllamaActivityInput {
  models: OllamaModel[];
  activeConnections: number;
  marker: ActivityMarker | null;
  env?: EnvLike;
  now?: Date;
}

export interface OllamaActivity {
  active: boolean;
  warm: boolean;
  reasons: string[];
}

export function computeOllamaActivity(input: OllamaActivityInput): OllamaActivity {
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  const env = input.env ?? process.env;
  const warmModels = input.models.filter((m) => {
    if (!m.expiresAt) return false;
    const t = Date.parse(m.expiresAt);
    return !Number.isNaN(t) && t > now.getTime();
  });
  const warm = warmModels.length > 0;
  if (input.activeConnections > 0) reasons.push(`${input.activeConnections} established local AI connection(s)`);
  if (input.marker) reasons.push(`activity marker: ${input.marker.reason}`);
  if (env.LITT_AI_ACTIVE === "1") reasons.push("LITT_AI_ACTIVE=1");
  if (env.LITT_STUDIO_GENERATION === "1") reasons.push("LITT_STUDIO_GENERATION=1");
  return { active: reasons.length > 0, warm, reasons };
}

export function shouldAllowOllamaUnload(
  state: OllamaActivity,
  config: WatchdogConfig,
): { allowed: boolean; reason: string } {
  if (!config.ollama.protectWhenActive) {
    return { allowed: true, reason: "ollama unload protection disabled by configuration" };
  }
  if (state.active) {
    return {
      allowed: false,
      reason: `refusing to unload: ${state.reasons.join("; ")}`,
    };
  }
  return { allowed: true, reason: state.warm ? "no active request — model may idle-unload normally" : "no model loaded" };
}

export interface OllamaState extends OllamaActivity {
  reachable: boolean;
  models: OllamaModel[];
  activeConnections: number;
  checkedAt: string;
}

export async function probeOllamaState(opts: {
  endpoint?: string;
  activityDir: string;
  env?: EnvLike;
  timeoutMs?: number;
  now?: Date;
  countConnections?: () => number;
}): Promise<OllamaState> {
  const now = opts.now ?? new Date();
  const endpoint = opts.endpoint ?? process.env.LITT_OLLAMA_URL ?? "http://127.0.0.1:11434";
  let reachable = false;
  let models: OllamaModel[] = [];
  try {
    const res = await fetch(`${endpoint}/api/ps`, { signal: AbortSignal.timeout(opts.timeoutMs ?? 2000) });
    if (res.ok) {
      reachable = true;
      const body = (await res.json()) as { models?: Record<string, unknown>[] };
      models = (body.models ?? []).map((m) => ({
        name: String(m.name ?? "unknown"),
        sizeBytes: Number(m.size ?? 0),
        sizeVramBytes: Number.isFinite(Number(m.size_vram)) ? Number(m.size_vram) : null,
        expiresAt: typeof m.expires_at === "string" ? m.expires_at : null,
      }));
    }
  } catch {
    reachable = false;
  }
  const activeConnections = (opts.countConnections ?? (() => countEstablishedOllamaConnections()))();
  const marker = readActivityMarker(opts.activityDir, now);
  const activity = computeOllamaActivity({ models, activeConnections, marker, env: opts.env, now });
  return {
    reachable,
    models,
    activeConnections,
    ...activity,
    checkedAt: now.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Termination planning (never executes)                              */
/* ------------------------------------------------------------------ */

export interface ProcessTreeNode {
  pid: number;
  parentPid: number | null;
  name: string;
  commandLine: string | null;
}

/** Windows process tree snapshot (pid + parent + name + redacted command line). */
export function readProcessTree(): ProcessTreeNode[] {
  if (process.platform !== "win32") return [];
  try {
    const out = powershellProbe(
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", timeout: 20_000, windowsHide: true },
    ).trim();
    if (!out) return [];
    const parsed: unknown = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter(isRecord)
      .map((r) => ({
        pid: Number(r.ProcessId) || 0,
        parentPid: Number.isFinite(Number(r.ParentProcessId)) ? Number(r.ParentProcessId) : null,
        name: String(r.Name ?? ""),
        commandLine: redactCommandLine(typeof r.CommandLine === "string" ? r.CommandLine : null),
      }))
      .filter((n) => n.pid > 0);
  } catch {
    return [];
  }
}

export interface ProtectedClosure {
  protectedPids: Set<number>;
  roots: number[];
  reasons: Map<number, string>;
}

/**
 * Expand protected roots (agent names / command markers) down the process
 * tree, so a protected Devin/Claude/Studio session also protects every child
 * and grandchild it spawned.
 */
export function computeProtectedPids(
  tree: ProcessTreeNode[],
  config: WatchdogConfig,
): ProtectedClosure {
  const protectedPids = new Set<number>();
  const roots: number[] = [];
  const reasons = new Map<number, string>();
  const t = config.termination;

  for (const node of tree) {
    const name = node.name.toLowerCase();
    const nameHit = t.protectedProcessNames.find((p) => name === p || name.startsWith(p));
    const cmd = (node.commandLine ?? "").toLowerCase();
    const markerHit = t.protectedCommandMarkers.find((m) => m && cmd.includes(m));
    if (nameHit || markerHit) {
      protectedPids.add(node.pid);
      roots.push(node.pid);
      reasons.set(node.pid, nameHit ? `name '${node.name}'` : `marker '${markerHit}'`);
    }
  }

  const children = new Map<number, number[]>();
  for (const node of tree) {
    if (node.parentPid === null) continue;
    const list = children.get(node.parentPid) ?? [];
    list.push(node.pid);
    children.set(node.parentPid, list);
  }
  const queue = [...protectedPids];
  while (queue.length > 0) {
    const pid = queue.pop();
    if (pid === undefined) continue;
    for (const child of children.get(pid) ?? []) {
      if (protectedPids.has(child)) continue;
      protectedPids.add(child);
      reasons.set(child, `child of protected pid ${pid}`);
      queue.push(child);
    }
  }
  return { protectedPids, roots, reasons };
}

export interface ProcessCandidate {
  pid: number;
  name: string;
  creationTime: string | null;
  commandLine: string | null;
  rssMb: number;
  ports?: number[];
  claim?: OwnershipClaim | null;
  expectedCommandLineMarkers?: string[];
}

export interface TerminationPlan {
  action: "none" | "eligible";
  reason: string;
  targets: number[];
  skipped: { pid: number; reason: string }[];
  shouldTerminate: false;
}

/**
 * Decide — never perform — whether any process is eligible for cleanup.
 * Every guard must pass, and the function still reports shouldTerminate:false
 * so callers cannot mistake a plan for an executed action.
 */
export function planTermination(opts: {
  config: WatchdogConfig;
  availableMb: number;
  candidates: ProcessCandidate[];
  readProcess?: ProcessReader;
  protectedPids?: Iterable<number>;
  now?: Date;
}): TerminationPlan {
  const readProcess = opts.readProcess ?? readProcessInfo;
  const treeProtected = new Set<number>(opts.protectedPids ?? []);
  const skipped: { pid: number; reason: string }[] = [];
  const base: TerminationPlan = {
    action: "none",
    reason: "",
    targets: [],
    skipped,
    shouldTerminate: false,
  };

  const t = opts.config.termination;
  if (!t.enabled) return { ...base, reason: "automatic termination is disabled (default)" };
  const validated = t.safetyValidatedAt ? Date.parse(t.safetyValidatedAt) : Number.NaN;
  if (Number.isNaN(validated)) {
    return { ...base, reason: "automatic termination refused: no live safety validation recorded" };
  }
  if (opts.availableMb >= opts.config.thresholds.blockAvailableMb) {
    return { ...base, reason: `available RAM ${opts.availableMb} MB is not below block threshold ${opts.config.thresholds.blockAvailableMb} MB` };
  }

  const targets: number[] = [];
  for (const c of opts.candidates) {
    if (treeProtected.has(c.pid)) {
      skipped.push({ pid: c.pid, reason: "protected by process tree (agent or child process)" });
      continue;
    }
    const name = c.name.toLowerCase();
    if (t.protectedProcessNames.some((p) => name === p || name.startsWith(p))) {
      skipped.push({ pid: c.pid, reason: `protected process name '${c.name}'` });
      continue;
    }
    const cmd = (c.commandLine ?? "").toLowerCase();
    const marker = t.protectedCommandMarkers.find((m) => m && cmd.includes(m));
    if (marker) {
      skipped.push({ pid: c.pid, reason: `protected command-line marker '${marker}'` });
      continue;
    }
    const protectedPort = (c.ports ?? []).find((p) => t.protectedPorts.includes(p));
    if (protectedPort) {
      skipped.push({ pid: c.pid, reason: `owns protected port ${protectedPort}` });
      continue;
    }
    const identity = verifyProcessIdentity(
      {
        pid: c.pid,
        creationTime: c.creationTime,
        claim: c.claim ?? null,
        commandLineMarkers: c.expectedCommandLineMarkers ?? [],
      },
      readProcess(c.pid),
    );
    if (!identity.verified) {
      skipped.push({ pid: c.pid, reason: `identity not verified: ${identity.reasons.join("; ")}` });
      continue;
    }
    // Authorization: the claim's owner must be explicitly allowlisted.
    // Empty allowlist means no process is ever eligible (fail closed).
    if (t.authorizedClaimOwners.length === 0) {
      skipped.push({ pid: c.pid, reason: "no authorized claim owners configured (fail closed)" });
      continue;
    }
    const owner = c.claim?.owner ?? "";
    if (!t.authorizedClaimOwners.includes(owner)) {
      skipped.push({ pid: c.pid, reason: `claim owner '${owner}' is not authorized` });
      continue;
    }
    targets.push(c.pid);
  }

  if (targets.length === 0) {
    return { ...base, reason: "no candidate passed the safety checks" };
  }
  return {
    action: "eligible",
    reason: `${targets.length} candidate(s) passed every safety check (not terminated)`,
    targets,
    skipped,
    shouldTerminate: false,
  };
}
