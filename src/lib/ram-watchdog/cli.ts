#!/usr/bin/env node
/**
 * LiTT RAM Watchdog CLI.
 *
 *   tsx src/lib/ram-watchdog/cli.ts status [--json]
 *   tsx src/lib/ram-watchdog/cli.ts gate [--json]
 *   tsx src/lib/ram-watchdog/cli.ts ram [--json]
 *   tsx src/lib/ram-watchdog/cli.ts verify <pid> [--markers a,b]
 *   tsx src/lib/ram-watchdog/cli.ts monitor [--duration-ms N] [--interval-ms N]
 *   tsx src/lib/ram-watchdog/cli.ts protect [--reason studio-generation] [--ttl-ms N]
 *   tsx src/lib/ram-watchdog/cli.ts release
 *   tsx src/lib/ram-watchdog/cli.ts validate [--json]
 *
 * Safety: this CLI never terminates processes and never restarts Ollama.
 * Exit codes: 0 ok, 1 failure, 3 launch blocked by RAM gate.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireSingleInstanceLock,
  clearActivityMarker,
  computeProtectedPids,
  evaluateLaunchGate,
  loadConfig,
  planTermination,
  probeOllamaState,
  readRamSnapshot,
  readPhysicalModules,
  readCpuTimes,
  cpuPercentBetween,
  readProcessActivity,
  readProcessInfo,
  readStatus,
  recoverOnStartup,
  releaseSingleInstanceLock,
  resolvePaths,
  rotateLogIfNeeded,
  shouldAllowOllamaUnload,
  sweepStaleClaims,
  verifyInstalledRam,
  verifyProcessIdentity,
  writeActivityMarker,
  writeOwnershipClaim,
  writeStatus,
  appendWatchdogLog,
  defaultConfig,
  type Paths,
  type WatchdogConfig,
} from "./core";
import { assertHostExecutionPermitted } from "@/lib/host-execution-guard";

const argv = process.argv.slice(2);
const command = argv[0] ?? "status";

function flag(name: string, fallback?: string): string | undefined {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1 || idx === argv.length - 1) return fallback;
  return argv[idx + 1];
}

function has(name: string): boolean {
  return argv.includes(`--${name}`);
}

function numFlag(name: string): number | undefined {
  const raw = flag(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function formatMb(mb: number): string {
  return `${mb} MB (${(mb / 1024).toFixed(2)} GB)`;
}

function load(): { config: WatchdogConfig; paths: Paths; warnings: string[]; errors: string[] } {
  const loaded = loadConfig();
  return {
    config: loaded.config,
    paths: resolvePaths(),
    warnings: loaded.warnings,
    errors: loaded.errors,
  };
}

function printConfigNotes(warnings: string[], errors: string[]): void {
  for (const w of warnings) console.log(`warn: ${w}`);
  for (const e of errors) console.log(`error: ${e}`);
}

async function ownCapture(config: WatchdogConfig) {
  const snapshot = readRamSnapshot();
  const gate = evaluateLaunchGate(snapshot, config);
  const ollama = await probeOllamaState({ endpoint: config.ollama.endpoint, activityDir: resolvePaths().activityDir });
  return { snapshot, gate, ollama, watchdogRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024) };
}

async function cmdStatus(): Promise<number> {
  const { config, paths, warnings, errors } = load();
  const capture = await ownCapture(config);
  const status = readStatus(paths.statePath);
  const unloadGuard = shouldAllowOllamaUnload(capture.ollama, config);
  const payload = {
    ...capture,
    thresholds: config.thresholds,
    launchGateEnabled: config.launchGate.enabled,
    termination: {
      enabled: config.termination.enabled,
      safetyValidatedAt: config.termination.safetyValidatedAt,
    },
    ollamaUnload: unloadGuard,
    lastRun: status,
    paths,
    warnings,
    errors,
  };
  if (has("json")) {
    printJson(payload);
  } else {
    const s = capture.snapshot;
    console.log(`RAM: ${formatMb(s.availableMb)} available of ${formatMb(s.totalMb)} (${s.usedPct}% used)`);
    console.log(
      `Gate: ${capture.gate.allowed ? "ALLOW" : "BLOCK"} [${capture.gate.level}] — ${capture.gate.reason}`,
    );
    console.log(
      `Thresholds: warn <= ${config.thresholds.warnAvailableMb} MB, block < ${config.thresholds.blockAvailableMb} MB`,
    );
    console.log(
      `Ollama: ${capture.ollama.reachable ? "reachable" : "unreachable"}, ${capture.ollama.models.length} model(s), active=${capture.ollama.active}${capture.ollama.reasons.length ? ` (${capture.ollama.reasons.join("; ")})` : ""}`,
    );
    console.log(`Ollama unload: ${unloadGuard.allowed ? "allowed" : "BLOCKED"} — ${unloadGuard.reason}`);
    console.log(`Watchdog RSS: ${capture.watchdogRssMb} MB`);
    console.log(
      `Termination: ${config.termination.enabled ? "enabled" : "DISABLED"} (safety validated: ${config.termination.safetyValidatedAt ?? "never"})`,
    );
    if (status) console.log(`Last monitor run: ${status.status} (pid ${status.pid}, ${status.updatedAt})`);
    printConfigNotes(warnings, errors);
  }
  return 0;
}

async function cmdGate(): Promise<number> {
  const { config, warnings, errors } = load();
  const snapshot = readRamSnapshot();
  const decision = evaluateLaunchGate(snapshot, config);
  if (has("json")) printJson({ ...decision, totalMb: snapshot.totalMb });
  else console.log(`${decision.allowed ? "ALLOW" : "BLOCK"} — ${decision.reason}`);
  printConfigNotes(warnings, errors);
  if (!decision.allowed) return 3;
  return 0;
}

function cmdRam(): number {
  const recognition = verifyInstalledRam();
  const snapshot = readRamSnapshot();
  const modules = readPhysicalModules();
  if (has("json")) {
    printJson({ ...recognition, availableMb: snapshot.availableMb, modules });
  } else {
    console.log(`Detected total: ${formatMb(recognition.detectedTotalMb)}`);
    console.log(`Available now: ${formatMb(snapshot.availableMb)}`);
    console.log(`Modules: ${modules.length ? modules.map((m) => `${m.bankLabel} ${formatMb(m.capacityMb)}${m.speedMhz ? ` @ ${m.speedMhz} MT/s` : ""}`).join(" | ") : "unreadable"}`);
    console.log(`Expected ${formatMb(recognition.expectedMb)} ±${recognition.toleranceMb} MB: ${recognition.recognized ? "RECOGNIZED" : "MISMATCH"}`);
    for (const note of recognition.notes) console.log(`note: ${note}`);
  }
  return recognition.recognized ? 0 : 1;
}

function cmdVerify(): number {
  const pid = Number(argv[1]);
  if (!Number.isInteger(pid) || pid <= 0) {
    console.error("usage: verify <pid> [--markers a,b]");
    return 1;
  }
  const info = readProcessInfo(pid);
  if (!info) {
    printJson({ pid, verified: false, reason: "process not running" });
    return 1;
  }
  const { paths } = load();
  const claim = {
    pid,
    creationTime: info.creationTime ?? new Date().toISOString(),
    owner: "ram-watchdog:verify",
    token: `verify-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(paths.claimsDir, { recursive: true });
  writeOwnershipClaim(paths.claimsDir, claim);
  const markers = (flag("markers") ?? "node").split(",").map((m) => m.trim()).filter(Boolean);
  const result = verifyProcessIdentity({ pid, creationTime: claim.creationTime, claim, commandLineMarkers: markers }, info);
  printJson({
    pid,
    name: info.name,
    creationTime: info.creationTime,
    markers,
    commandLine: info.commandLine,
    ...result,
  });
  return result.verified ? 0 : 1;
}

async function cmdMonitor(): Promise<number> {
  const { config, paths, warnings, errors } = load();
  printConfigNotes(warnings, errors);
  const recovery = recoverOnStartup({ paths, config });
  for (const note of recovery.notes) console.log(`startup: ${note}`);

  const lock = acquireSingleInstanceLock({ lockPath: paths.lockPath, owner: "litt-ram-watchdog" });
  if (!lock.ok) {
    console.error(`refusing to start: ${lock.reason}`);
    return 1;
  }
  const startedAt = new Date().toISOString();
  const durationMs = numFlag("duration-ms") ?? 5 * 60 * 1000;
  const intervalMs = numFlag("interval-ms") ?? config.pollIntervalMs;
  let stopping = false;

  const stop = (signal: string) => {
    stopping = true;
    releaseSingleInstanceLock(paths.lockPath, lock.info.token);
    writeStatus(paths.statePath, {
      status: "stopped",
      pid: process.pid,
      owner: "litt-ram-watchdog",
      startedAt,
      updatedAt: new Date().toISOString(),
      crashCount: recovery.crashCount,
      note: signal,
    });
    console.log(`stopped (${signal})`);
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  console.log(
    `monitor start pid ${process.pid} interval ${intervalMs}ms duration ${durationMs}ms; warn<=${config.thresholds.warnAvailableMb}MB block<${config.thresholds.blockAvailableMb}MB; termination=${config.termination.enabled ? "enabled" : "DISABLED"}`,
  );

  const deadline = Date.now() + durationMs;
  let samples = 0;
  let prevCpu = readCpuTimes();
  while (!stopping && Date.now() < deadline) {
    const capture = await ownCapture(config);
    const currCpu = readCpuTimes();
    const cpuPct = cpuPercentBetween(prevCpu, currCpu);
    prevCpu = currCpu;
    const processes = readProcessActivity();
    samples += 1;
    const record = {
      event: "sample",
      sample: samples,
      availableMb: capture.snapshot.availableMb,
      totalMb: capture.snapshot.totalMb,
      usedPct: capture.snapshot.usedPct,
      level: capture.gate.level,
      gate: capture.gate.allowed ? "allow" : "block",
      watchdogRssMb: capture.watchdogRssMb,
      cpuPct,
      processes,
      ollamaActive: capture.ollama.active,
      ollamaWarm: capture.ollama.warm,
      ollamaModels: capture.ollama.models.map((m) => m.name),
      ollamaReasons: capture.ollama.reasons,
    };
    appendWatchdogLog(paths.logPath, record, config.logging);
    writeStatus(paths.statePath, {
      status: "running",
      pid: process.pid,
      owner: "litt-ram-watchdog",
      startedAt,
      updatedAt: new Date().toISOString(),
      crashCount: recovery.crashCount,
    });
    console.log(
      `[${record.level.toUpperCase()}] avail ${record.availableMb}MB · cpu ${cpuPct}% · gate ${record.gate} · ollama ${record.ollamaActive ? "ACTIVE" : "idle"} · procs ${processes.total} (node ${processes.node}) · rss ${record.watchdogRssMb}MB`,
    );
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  releaseSingleInstanceLock(paths.lockPath, lock.info.token);
  writeStatus(paths.statePath, {
    status: "stopped",
    pid: process.pid,
    owner: "litt-ram-watchdog",
    startedAt,
    updatedAt: new Date().toISOString(),
    crashCount: recovery.crashCount,
    note: "duration elapsed",
  });
  console.log(`monitor stop after ${samples} sample(s)`);
  return 0;
}

function cmdProtect(): number {
  const { paths, config } = load();
  const marker = writeActivityMarker(paths.activityDir, {
    reason: flag("reason") ?? "studio-generation",
    ttlMs: numFlag("ttl-ms") ?? config.ollama.activityTtlMs,
  });
  console.log(`activity marker set until ${marker.expiresAt} (${marker.reason})`);
  return 0;
}

function cmdRelease(): number {
  const { paths } = load();
  clearActivityMarker(paths.activityDir);
  console.log("activity marker cleared");
  return 0;
}

function cmdValidate(): number {
  const results: { step: string; pass: boolean; detail: string }[] = [];
  const root = join(tmpdir(), `litt-ram-watchdog-validate-${Date.now()}`);
  mkdirSync(root, { recursive: true });

  const check = (step: string, pass: boolean, detail: string) => {
    results.push({ step, pass, detail });
  };

  try {
    // 1. RAM recognition
    const ram = verifyInstalledRam();
    check(
      "ram-recognition",
      ram.recognized,
      `${ram.detectedTotalMb} MB detected, modules ${ram.moduleTotalMb} MB (${ram.modules.length})${ram.notes.length ? `; ${ram.notes.join("; ")}` : ""}`,
    );

    // 2. Thresholds
    const cfg = load().config;
    const sane = cfg.thresholds.warnAvailableMb > cfg.thresholds.blockAvailableMb && cfg.thresholds.blockAvailableMb > 0;
    check(
      "thresholds",
      sane,
      `warn<=${cfg.thresholds.warnAvailableMb}MB block<${cfg.thresholds.blockAvailableMb}MB (configurable via file/env)`,
    );

    // 3. Single-instance enforcement
    const lockPath = join(root, "watchdog.lock");
    const first = acquireSingleInstanceLock({ lockPath, pid: process.pid });
    const second = acquireSingleInstanceLock({ lockPath, pid: process.pid + 1 });
    const staleLock = join(root, "stale.lock");
    mkdirSync(root, { recursive: true });
    // Dead pid 999999 cannot be alive, so the next acquire must reclaim it.
    const writeDead = acquireSingleInstanceLock({ lockPath: staleLock, pid: 999999, readProcess: () => null });
    const reclaim = acquireSingleInstanceLock({ lockPath: staleLock, pid: process.pid });
    check(
      "single-instance",
      first.ok && !second.ok && writeDead.ok && reclaim.ok && reclaim.ok === true && reclaim.reclaimed !== null,
      `first=${first.ok ? "acquired" : "failed"} second=${second.ok ? "acquired (BAD)" : "refused"} stale=${reclaim.ok && reclaim.reclaimed ? "reclaimed" : "not reclaimed"}`,
    );
    if (first.ok) releaseSingleInstanceLock(lockPath, first.info.token);

    // 4. Stale claim cleanup
    const claimsDir = join(root, "claims");
    const liveInfo = readProcessInfo(process.pid);
    if (liveInfo?.creationTime) {
      writeOwnershipClaim(claimsDir, {
        pid: process.pid,
        creationTime: liveInfo.creationTime,
        owner: "validate",
        token: "validate-live",
        createdAt: new Date().toISOString(),
      });
    }
    writeOwnershipClaim(claimsDir, {
      pid: 999999,
      creationTime: new Date(0).toISOString(),
      owner: "validate",
      token: "validate-dead",
      createdAt: new Date().toISOString(),
    });
    const sweep = sweepStaleClaims({ claimsDir });
    check(
      "stale-claims",
      sweep.removed.length === 1 && sweep.kept.length === 1,
      `removed ${sweep.removed.length}, kept ${sweep.kept.length}`,
    );

    // 5. Log rotation
    const logPath = join(root, "logs", "watchdog.jsonl");
    mkdirSync(join(root, "logs"), { recursive: true });
    appendWatchdogLog(logPath, { fill: "x".repeat(400) }, { maxBytes: 200, maxFiles: 2 });
    const rotated = rotateLogIfNeeded(logPath, { maxBytes: 200, maxFiles: 2 });
    check("log-rotation", rotated.rotated && rotated.files.length >= 1, rotated.files.join(", ") || "no archive");

    // 6. Startup recovery
    const recPaths = resolvePaths({ homeDir: root, env: {} });
    writeStatus(recPaths.statePath, {
      status: "running",
      pid: 999999,
      owner: "validate",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      crashCount: 2,
    });
    const recovery = recoverOnStartup({ paths: recPaths, config: cfg, readProcess: () => null });
    const statusAfter = readStatus(recPaths.statePath);
    check(
      "startup-recovery",
      recovery.recoveredPreviousRun && statusAfter?.status === "recovered" && recovery.crashCount === 3,
      `status=${statusAfter?.status} crashCount=${recovery.crashCount}`,
    );

    // 7. Identity verification (all four signals)
    if (liveInfo?.creationTime) {
      const claim = {
        pid: process.pid,
        creationTime: liveInfo.creationTime,
        owner: "validate",
        token: "validate",
        createdAt: new Date().toISOString(),
      };
      const ok = verifyProcessIdentity(
        { pid: process.pid, creationTime: liveInfo.creationTime, claim, commandLineMarkers: ["ram-watchdog"] },
        liveInfo,
      );
      const tampered = verifyProcessIdentity(
        {
          pid: process.pid,
          creationTime: new Date(Date.parse(liveInfo.creationTime) - 3600_000).toISOString(),
          claim,
          commandLineMarkers: ["ram-watchdog"],
        },
        liveInfo,
      );
      check(
        "identity-four-signals",
        ok.verified && !tampered.verified,
        `verified=${ok.verified} tamperedRejected=${!tampered.verified}`,
      );
    } else {
      check("identity-four-signals", false, "unable to read own process creation time");
    }

    // 8. Termination disabled
    const plan = planTermination({
      config: defaultConfig(),
      availableMb: 512,
      candidates: [{ pid: 999999, name: "notepad", creationTime: null, commandLine: null, rssMb: 10 }],
    });
    check(
      "termination-disabled",
      plan.action === "none" && plan.shouldTerminate === false && plan.targets.length === 0,
      plan.reason,
    );

    // 9. Launch gate thresholds
    const atBlock = evaluateLaunchGate(
      { capturedAt: new Date().toISOString(), totalMb: 32000, availableMb: 2047, usedMb: 29953, usedPct: 93.6, source: "os" },
      defaultConfig(),
    );
    const atWarn = evaluateLaunchGate(
      { capturedAt: new Date().toISOString(), totalMb: 32000, availableMb: 4096, usedMb: 27904, usedPct: 87.2, source: "os" },
      defaultConfig(),
    );
    check(
      "launch-gate",
      atBlock.allowed === false && atWarn.allowed === true && atWarn.level === "warn",
      `block@2047=${atBlock.allowed ? "allow (BAD)" : "block"} warn@4096=${atWarn.level}`,
    );

    // 10. Ollama unload guard
    const guard = shouldAllowOllamaUnload(
      { active: true, warm: true, reasons: ["validate: simulated active request"] },
      defaultConfig(),
    );
    check("ollama-unload-guard", guard.allowed === false, guard.reason);

    // 11. Protected agent lineage (parents + children)
    const tree = [
      { pid: 100, parentPid: 1, name: "devin", commandLine: "devin.exe" },
      { pid: 101, parentPid: 100, name: "node", commandLine: "node agent.js" },
      { pid: 102, parentPid: 101, name: "node", commandLine: "node build-worker.js" },
      { pid: 200, parentPid: 1, name: "python", commandLine: "python unrelated.py" },
    ];
    const closureConfig = defaultConfig();
    closureConfig.termination.protectedProcessNames = ["devin"];
    closureConfig.termination.protectedCommandMarkers = ["agent"];
    const closure = computeProtectedPids(tree, closureConfig);
    check(
      "protected-lineage",
      closure.protectedPids.has(100) && closure.protectedPids.has(101) && closure.protectedPids.has(102) && !closure.protectedPids.has(200),
      `protected=[${[...closure.protectedPids].sort((a, b) => a - b).join(",")}] roots=${closure.roots.length}`,
    );

    // 12. Claim-owner authorization (unrelated agents cannot be targeted)
    const authConfig = defaultConfig();
    authConfig.termination.enabled = true;
    authConfig.termination.safetyValidatedAt = new Date().toISOString();
    authConfig.termination.protectedProcessNames = [];
    authConfig.termination.protectedPorts = [];
    authConfig.termination.protectedCommandMarkers = [];
    authConfig.termination.authorizedClaimOwners = ["litt-ram-watchdog"];
    const authPlan = planTermination({
      config: authConfig,
      availableMb: 512,
      readProcess: () => liveInfo,
      candidates: liveInfo?.creationTime
        ? [
            {
              pid: process.pid,
              name: "worker",
              creationTime: liveInfo.creationTime,
              commandLine: liveInfo.commandLine,
              rssMb: 10,
              claim: {
                pid: process.pid,
                creationTime: liveInfo.creationTime,
                owner: "unrelated-agent",
                token: "x",
                createdAt: new Date().toISOString(),
              },
              expectedCommandLineMarkers: ["ram-watchdog"],
            },
          ]
        : [],
    });
    check(
      "claim-authorization",
      authPlan.action === "none" && authPlan.skipped.some((s) => s.reason.includes("not authorized")),
      authPlan.skipped[0]?.reason ?? authPlan.reason,
    );
  } finally {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }

  const failures = results.filter((r) => !r.pass);
  if (has("json")) {
    printJson({ pass: results.length - failures.length, fail: failures.length, results });
  } else {
    for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.step} — ${r.detail}`);
    console.log(`\n${results.length - failures.length}/${results.length} checks passed`);
  }
  return failures.length === 0 ? 0 : 1;
}

async function main(): Promise<number> {
  // Loud entry guard: core's probes catch HostExecutionDisabledError and
  // would otherwise report empty snapshots, which an operator could
  // misread as "no processes". Fail the command instead.
  assertHostExecutionPermitted("ram-watchdog/cli");
  switch (command) {
    case "status":
      return cmdStatus();
    case "gate":
      return cmdGate();
    case "ram":
      return cmdRam();
    case "verify":
      return cmdVerify();
    case "monitor":
      return cmdMonitor();
    case "protect":
      return cmdProtect();
    case "release":
      return cmdRelease();
    case "validate":
      return cmdValidate();
    default:
      console.error(`unknown command '${command}'`);
      console.error("commands: status | gate | ram | verify <pid> | monitor | protect | release | validate");
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error("ram-watchdog failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
