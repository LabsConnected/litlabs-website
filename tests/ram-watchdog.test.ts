import { describe, expect, it, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireSingleInstanceLock,
  appendWatchdogLog,
  computeProtectedPids,
  classifyRam,
  clearActivityMarker,
  computeOllamaActivity,
  defaultConfig,
  evaluateLaunchGate,
  inspectLock,
  loadConfig,
  normalizeConfig,
  planTermination,
  readActivityMarker,
  readRamSnapshot,
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
  type OllamaModel,
  type OwnershipClaim,
  type ProcessInfo,
  type RamSnapshot,
  type WatchdogConfig,
} from "@/lib/ram-watchdog/core";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "litt-ram-watchdog-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function snapshot(totalMb: number, availableMb: number): RamSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    totalMb,
    availableMb,
    usedMb: totalMb - availableMb,
    usedPct: Math.round(((totalMb - availableMb) / totalMb) * 1000) / 10,
    source: "os",
  };
}

const LIVE_INFO: ProcessInfo = {
  pid: 4242,
  name: "node",
  parentPid: 1,
  creationTime: "2026-10-30T22:00:00.000Z",
  commandLine: 'node C:\\LiTT\\Canonical-2026\\studio\\server.js --dev',
};

function liveClaim(overrides: Partial<OwnershipClaim> = {}): OwnershipClaim {
  return {
    pid: 4242,
    creationTime: LIVE_INFO.creationTime as string,
    owner: "devin:studio-session",
    token: "claim-token-123",
    createdAt: "2026-10-30T22:00:01.000Z",
    ...overrides,
  };
}

describe("ram-watchdog — thresholds and launch gate", () => {
  it("classifies at the exact 4 GB warn and 2 GB block boundaries", () => {
    const t = { warnAvailableMb: 4096, blockAvailableMb: 2048 };
    expect(classifyRam(8192, t)).toBe("ok");
    expect(classifyRam(4097, t)).toBe("ok");
    expect(classifyRam(4096, t)).toBe("warn");
    expect(classifyRam(2049, t)).toBe("warn");
    expect(classifyRam(2048, t)).toBe("block");
    expect(classifyRam(0, t)).toBe("block");
  });

  it("blocks launches below 2 GB available and allows with a warning at 4 GB", () => {
    const config = defaultConfig();
    const blocked = evaluateLaunchGate(snapshot(32000, 2047), config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.level).toBe("block");
    expect(blocked.reason).toContain("block threshold 2048");

    const warned = evaluateLaunchGate(snapshot(32000, 4096), config);
    expect(warned.allowed).toBe(true);
    expect(warned.level).toBe("warn");

    const ok = evaluateLaunchGate(snapshot(32000, 4097), config);
    expect(ok.level).toBe("ok");
  });

  it("keeps monitoring but stops blocking when the gate is disabled", () => {
    const config = defaultConfig();
    config.launchGate.enabled = false;
    const decision = evaluateLaunchGate(snapshot(32000, 100), config);
    expect(decision.allowed).toBe(true);
    expect(decision.level).toBe("block");
    expect(decision.reason).toContain("monitoring still active");
  });
});

describe("ram-watchdog — configuration", () => {
  it("defaults to 4 GB warn / 2 GB block with termination disabled", () => {
    const config = defaultConfig();
    expect(config.thresholds).toEqual({ warnAvailableMb: 4096, blockAvailableMb: 2048 });
    expect(config.launchGate.enabled).toBe(true);
    expect(config.termination.enabled).toBe(false);
    expect(config.termination.safetyValidatedAt).toBeNull();
    expect(config.termination.authorizedClaimOwners).toEqual([]);
  });

  it("accepts custom thresholds and rejects a warn threshold at/below block", () => {
    const good = normalizeConfig({ thresholds: { warnAvailableMb: 6144, blockAvailableMb: 3072 } });
    expect(good.errors).toEqual([]);
    expect(good.config.thresholds).toEqual({ warnAvailableMb: 6144, blockAvailableMb: 3072 });

    const bad = normalizeConfig({ thresholds: { warnAvailableMb: 1024, blockAvailableMb: 2048 } });
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.config.thresholds).toEqual({ warnAvailableMb: 4096, blockAvailableMb: 2048 });
  });

  it("loads thresholds from a config file and applies env overrides", () => {
    const dir = tempDir();
    const configPath = join(dir, "ram-watchdog.json");
    writeFileSync(
      configPath,
      JSON.stringify({ thresholds: { warnAvailableMb: 5120, blockAvailableMb: 2560 } }, null, 2),
    );
    const loaded = loadConfig({ configPath, env: { LITT_RAM_BLOCK_MB: "1536" } });
    expect(loaded.source).toBe("file");
    expect(loaded.config.thresholds.warnAvailableMb).toBe(5120);
    expect(loaded.config.thresholds.blockAvailableMb).toBe(1536);
    expect(loaded.config.termination.enabled).toBe(false);
  });

  it("falls back to safe defaults when the config file is invalid JSON", () => {
    const dir = tempDir();
    const configPath = join(dir, "broken.json");
    writeFileSync(configPath, "{not json");
    const loaded = loadConfig({ configPath, env: {} });
    expect(loaded.errors.length).toBeGreaterThan(0);
    expect(loaded.config.thresholds).toEqual({ warnAvailableMb: 4096, blockAvailableMb: 2048 });
    expect(loaded.config.termination.enabled).toBe(false);
  });

  it("resolves state, log, claim and activity paths under one directory", () => {
    const home = join("C:", "Users", "tester");
    const paths = resolvePaths({ homeDir: home, env: {} });
    expect(paths.stateDir).toBe(join(home, ".litt", "ram-watchdog"));
    expect(paths.logPath).toBe(join(paths.logsDir, "ram-watchdog.jsonl"));
    expect(paths.claimsDir).toBe(join(paths.stateDir, "claims"));
    expect(paths.activityDir).toBe(join(paths.stateDir, "activity"));
  });
});

describe("ram-watchdog — RAM detection", () => {
  it("computes used/available from a probe without exceeding total", () => {
    const snap = readRamSnapshot(() => ({ totalMb: 32605, availableMb: 3341 }));
    expect(snap.totalMb).toBe(32605);
    expect(snap.availableMb).toBe(3341);
    expect(snap.usedMb).toBe(29264);
    expect(snap.usedPct).toBeCloseTo(89.8, 1);
  });

  it("recognizes 32 GB across two 16 GB modules", () => {
    const recognition = verifyInstalledRam({
      expectedMb: 32768,
      probe: () => ({ totalMb: 32605, availableMb: 3341 }),
      modules: () => [
        { bankLabel: "BANK 0", capacityMb: 16384, speedMhz: 2667 },
        { bankLabel: "BANK 2", capacityMb: 16384, speedMhz: 2667 },
      ],
    });
    expect(recognition.moduleTotalMb).toBe(32768);
    expect(recognition.recognized).toBe(true);
    expect(recognition.notes).toEqual([]);
  });

  it("flags a module total that disagrees with the OS total", () => {
    const recognition = verifyInstalledRam({
      expectedMb: 32768,
      probe: () => ({ totalMb: 32605, availableMb: 3341 }),
      modules: () => [{ bankLabel: "BANK 0", capacityMb: 8192, speedMhz: 2667 }],
    });
    expect(recognition.recognized).toBe(false);
    expect(recognition.notes.join(" ")).toContain("disagrees");
  });

  it("reads the real machine without inventing values", () => {
    const snap = readRamSnapshot();
    expect(snap.totalMb).toBeGreaterThan(0);
    expect(snap.availableMb).toBeLessThanOrEqual(snap.totalMb);
  });
});

describe("ram-watchdog — process identity (PID + creation time + claim + markers)", () => {
  it("verifies only when all four signals agree", () => {
    const result = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: liveClaim(), commandLineMarkers: ["studio", "server.js"] },
      LIVE_INFO,
    );
    expect(result.verified).toBe(true);
    expect(result.checks).toEqual({
      alive: true,
      creationTimeMatch: true,
      ownershipClaimMatch: true,
      commandLineMarkersMatch: true,
    });
    expect(result.reasons).toEqual([]);
  });

  it("rejects a recycled PID via creation-time mismatch", () => {
    const result = verifyProcessIdentity(
      { pid: 4242, creationTime: "2026-10-30T19:00:00.000Z", claim: liveClaim(), commandLineMarkers: ["studio"] },
      LIVE_INFO,
    );
    expect(result.verified).toBe(false);
    expect(result.checks.creationTimeMatch).toBe(false);
    expect(result.reasons.join(" ")).toContain("PID reuse");
  });

  it("rejects a process with no ownership claim", () => {
    const result = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: null, commandLineMarkers: ["studio"] },
      LIVE_INFO,
    );
    expect(result.verified).toBe(false);
    expect(result.checks.ownershipClaimMatch).toBe(false);
    expect(result.reasons.join(" ")).toContain("no ownership claim");
  });

  it("rejects a claim written for a different creation time", () => {
    const stale = liveClaim({ creationTime: "2026-10-30T18:00:00.000Z" });
    const result = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: stale, commandLineMarkers: ["studio"] },
      LIVE_INFO,
    );
    expect(result.verified).toBe(false);
    expect(result.reasons.join(" ")).toContain("does not match the live process");
  });

  it("fails closed when command-line markers are missing or empty", () => {
    const wrong = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: liveClaim(), commandLineMarkers: ["not-present"] },
      LIVE_INFO,
    );
    expect(wrong.verified).toBe(false);
    expect(wrong.checks.commandLineMarkersMatch).toBe(false);

    const none = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: liveClaim(), commandLineMarkers: [] },
      LIVE_INFO,
    );
    expect(none.verified).toBe(false);
    expect(none.reasons.join(" ")).toContain("no command-line markers");
  });

  it("rejects when the pid is not running", () => {
    const result = verifyProcessIdentity(
      { pid: 4242, creationTime: LIVE_INFO.creationTime, claim: liveClaim(), commandLineMarkers: ["studio"] },
      null,
    );
    expect(result.verified).toBe(false);
    expect(result.checks.alive).toBe(false);
  });
});

describe("ram-watchdog — stale claim cleanup", () => {
  it("removes dead, recycled, and corrupt claims but keeps live ones", () => {
    const dir = tempDir();
    const claimsDir = join(dir, "claims");
    mkdirSync(claimsDir, { recursive: true });

    const live = writeOwnershipClaim(claimsDir, liveClaim());
    const dead = writeOwnershipClaim(claimsDir, liveClaim({ pid: 9999, token: "dead" }));
    const recycled = writeOwnershipClaim(
      claimsDir,
      liveClaim({ pid: 4242, creationTime: "2026-10-30T01:00:00.000Z", token: "old" }),
    );
    const corrupt = join(claimsDir, "corrupt.json");
    writeFileSync(corrupt, "{oops");
    // Distinct file name so it is not overwritten by liveClaim().
    const duplicate = join(claimsDir, "4242-duplicate.json");
    writeFileSync(
      duplicate,
      JSON.stringify(liveClaim({ creationTime: "2026-10-30T21:59:59.000Z", createdAt: "2026-10-30T21:59:59.000Z" })),
    );

    const readProcess = (pid: number): ProcessInfo | null => (pid === 4242 ? LIVE_INFO : null);
    const result = sweepStaleClaims({ claimsDir, readProcess });

    expect(result.kept).toEqual([live.split(/[\\/]/).pop()]);
    expect(result.removed).toEqual(
      expect.arrayContaining([dead.split(/[\\/]/).pop(), recycled.split(/[\\/]/).pop(), "corrupt.json", "4242-duplicate.json"]),
    );
    expect(existsSync(live)).toBe(true);
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(recycled)).toBe(false);
    expect(existsSync(corrupt)).toBe(false);
    expect(existsSync(duplicate)).toBe(false);
  });
});

describe("ram-watchdog — single-instance enforcement", () => {
  it("refuses a second instance while the first is alive", () => {
    const dir = tempDir();
    const lockPath = join(dir, "watchdog.lock");
    const readProcess = (pid: number): ProcessInfo | null =>
      pid === 5000 ? { ...LIVE_INFO, pid: 5000, creationTime: "2026-10-30T20:00:00.000Z" } : null;

    const first = acquireSingleInstanceLock({ lockPath, pid: 5000, readProcess });
    expect(first.ok).toBe(true);
    const second = acquireSingleInstanceLock({ lockPath, pid: 5001, readProcess });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain("pid 5000");

    const status = inspectLock(lockPath, readProcess);
    expect(status.held).toBe(true);
    expect(status.ownerAlive).toBe(true);

    if (first.ok) {
      expect(releaseSingleInstanceLock(lockPath, "wrong-token")).toBe(false);
      expect(releaseSingleInstanceLock(lockPath, first.info.token)).toBe(true);
    }
    expect(inspectLock(lockPath, readProcess).held).toBe(false);
  });

  it("reclaims a lock left by a dead process", () => {
    const dir = tempDir();
    const lockPath = join(dir, "watchdog.lock");
    const dead = acquireSingleInstanceLock({ lockPath, pid: 9999, readProcess: () => null });
    expect(dead.ok).toBe(true);

    const recovered = acquireSingleInstanceLock({
      lockPath,
      pid: 6000,
      readProcess: (pid) => (pid === 6000 ? { ...LIVE_INFO, pid: 6000 } : null),
    });
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.reclaimed?.pid).toBe(9999);
      releaseSingleInstanceLock(lockPath, recovered.info.token);
    }
  });
});

describe("ram-watchdog — log rotation", () => {
  it("rotates a full log and caps retention", () => {
    const dir = tempDir();
    const logPath = join(dir, "logs", "watchdog.jsonl");
    mkdirSync(join(dir, "logs"), { recursive: true });
    writeFileSync(logPath, "x".repeat(300));

    const rotated = rotateLogIfNeeded(logPath, { maxBytes: 200, maxFiles: 2 });
    expect(rotated.rotated).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(existsSync(logPath)).toBe(false);

    for (let i = 0; i < 4; i++) {
      appendWatchdogLog(logPath, { i, fill: "y".repeat(250) }, { maxBytes: 200, maxFiles: 2 });
    }
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(existsSync(`${logPath}.2`)).toBe(true);
    expect(existsSync(`${logPath}.3`)).toBe(false);
  });

  it("does not rotate below the size limit", () => {
    const dir = tempDir();
    const logPath = join(dir, "small.jsonl");
    writeFileSync(logPath, "small");
    const rotated = rotateLogIfNeeded(logPath, { maxBytes: 100, maxFiles: 3 });
    expect(rotated.rotated).toBe(false);
    expect(existsSync(logPath)).toBe(true);
  });
});

describe("ram-watchdog — startup recovery", () => {
  it("marks an unclean run recovered, sweeps claims and creates directories", () => {
    const dir = tempDir();
    const config = defaultConfig();
    config.logging = { maxBytes: 100, maxFiles: 3 };
    const paths = resolvePaths({ homeDir: dir, env: {} });

    writeStatus(paths.statePath, {
      status: "running",
      pid: 9999,
      owner: "litt-ram-watchdog",
      startedAt: "2026-10-30T20:00:00.000Z",
      updatedAt: "2026-10-30T20:01:00.000Z",
      crashCount: 2,
    });
    writeOwnershipClaim(paths.claimsDir, liveClaim({ pid: 9999, token: "dead" }));
    mkdirSync(paths.logsDir, { recursive: true });
    writeFileSync(paths.logPath, "z".repeat(300));

    const report = recoverOnStartup({ paths, config, readProcess: () => null });
    const status = readStatus(paths.statePath);

    expect(report.recoveredPreviousRun).toBe(true);
    expect(report.crashCount).toBe(3);
    expect(report.claimsRemoved.length).toBe(1);
    expect(report.logRotated).toBe(true);
    expect(status?.status).toBe("recovered");
    expect(status?.crashCount).toBe(3);
    for (const d of [paths.stateDir, paths.logsDir, paths.claimsDir, paths.activityDir]) {
      expect(existsSync(d)).toBe(true);
    }
  });

  it("does not overwrite the status of a still-live previous run", () => {
    const dir = tempDir();
    const paths = resolvePaths({ homeDir: dir, env: {} });
    writeStatus(paths.statePath, {
      status: "running",
      pid: 4242,
      owner: "litt-ram-watchdog",
      startedAt: "2026-10-30T22:00:00.000Z",
      updatedAt: "2026-10-30T22:01:00.000Z",
      crashCount: 0,
    });
    const report = recoverOnStartup({ paths, config: defaultConfig(), readProcess: () => LIVE_INFO });
    expect(report.recoveredPreviousRun).toBe(false);
    expect(readStatus(paths.statePath)?.status).toBe("running");
  });
});

describe("ram-watchdog — Ollama unload protection", () => {
  const model = (expiresAt: string | null): OllamaModel => ({
    name: "litt-hermes:32k",
    sizeBytes: 5_745_032_559,
    sizeVramBytes: 1_442_714_746,
    expiresAt,
  });

  it("treats warm models as warm but idle without an active request", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const activity = computeOllamaActivity({ models: [model(future)], activeConnections: 0, marker: null, env: {} });
    expect(activity.warm).toBe(true);
    expect(activity.active).toBe(false);
    expect(shouldAllowOllamaUnload(activity, defaultConfig()).allowed).toBe(true);
  });

  it("blocks unload while a local AI connection or Studio generation is active", () => {
    const activity = computeOllamaActivity({
      models: [model(null)],
      activeConnections: 2,
      marker: { reason: "studio-generation", activeFrom: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() },
      env: {},
    });
    expect(activity.active).toBe(true);
    expect(activity.reasons.join(" ")).toContain("studio-generation");
    const guard = shouldAllowOllamaUnload(activity, defaultConfig());
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toContain("refusing to unload");
  });

  it("honors the env activity flags", () => {
    const activity = computeOllamaActivity({
      models: [],
      activeConnections: 0,
      marker: null,
      env: { LITT_STUDIO_GENERATION: "1" },
    });
    expect(activity.active).toBe(true);
  });

  it("expires the activity marker after its TTL", () => {
    const dir = tempDir();
    const now = new Date("2026-10-30T22:00:00.000Z");
    const marker = writeActivityMarker(dir, { ttlMs: 1000, now });
    expect(readActivityMarker(dir, new Date(now.getTime() + 500))?.reason).toBe(marker.reason);
    expect(readActivityMarker(dir, new Date(now.getTime() + 2000))).toBeNull();
    clearActivityMarker(dir);
    expect(readActivityMarker(dir, now)).toBeNull();
  });
});

describe("ram-watchdog — termination planning", () => {
  const candidate = {
    pid: 4242,
    name: "worker",
    creationTime: LIVE_INFO.creationTime,
    commandLine: LIVE_INFO.commandLine,
    rssMb: 500,
    claim: liveClaim(),
    expectedCommandLineMarkers: ["server.js"],
  };

  function enabledConfig(): WatchdogConfig {
    const config = defaultConfig();
    config.termination.enabled = true;
    config.termination.safetyValidatedAt = new Date().toISOString();
    config.termination.protectedProcessNames = [];
    config.termination.protectedPorts = [];
    config.termination.protectedCommandMarkers = [];
    config.termination.authorizedClaimOwners = ["devin:studio-session"];
    return config;
  }

  it("never plans anything while the default config disables termination", () => {
    const plan = planTermination({ config: defaultConfig(), availableMb: 512, candidates: [candidate] });
    expect(plan.action).toBe("none");
    expect(plan.targets).toEqual([]);
    expect(plan.shouldTerminate).toBe(false);
    expect(plan.reason).toContain("disabled");
  });

  it("refuses when enabled but no live safety validation is recorded", () => {
    const config = enabledConfig();
    config.termination.safetyValidatedAt = null;
    const plan = planTermination({ config, availableMb: 512, candidates: [candidate] });
    expect(plan.action).toBe("none");
    expect(plan.reason).toContain("no live safety validation");
  });

  it("refuses while RAM is at or above the block threshold", () => {
    const plan = planTermination({ config: enabledConfig(), availableMb: 3000, candidates: [candidate] });
    expect(plan.action).toBe("none");
    expect(plan.reason).toContain("not below block threshold");
  });

  it("marks a fully verified, unprotected process eligible without terminating it", () => {
    const plan = planTermination({
      config: enabledConfig(),
      availableMb: 1024,
      candidates: [candidate],
      readProcess: () => LIVE_INFO,
    });
    expect(plan.action).toBe("eligible");
    expect(plan.targets).toEqual([4242]);
    expect(plan.shouldTerminate).toBe(false);
  });

  it("refuses a fully verified process whose claim owner is unrelated", () => {
    const config = enabledConfig();
    config.termination.authorizedClaimOwners = ["devin:studio-session"];
    const plan = planTermination({
      config,
      availableMb: 1024,
      readProcess: () => LIVE_INFO,
      candidates: [{ ...candidate, claim: liveClaim({ owner: "other-agent" }) }],
    });
    expect(plan.action).toBe("none");
    expect(plan.skipped[0]?.reason).toContain("not authorized");
  });

  it("fails closed when no claim owner is authorized", () => {
    const config = enabledConfig();
    config.termination.authorizedClaimOwners = [];
    const plan = planTermination({ config, availableMb: 1024, readProcess: () => LIVE_INFO, candidates: [candidate] });
    expect(plan.action).toBe("none");
    expect(plan.skipped[0]?.reason).toContain("fail closed");
  });

  it("protects a protected agent's children and grandchildren by lineage", () => {
    const tree = [
      { pid: 100, parentPid: 1, name: "devin", commandLine: "devin.exe" },
      { pid: 101, parentPid: 100, name: "node", commandLine: "node agent.js" },
      { pid: 102, parentPid: 101, name: "node", commandLine: "node build-worker.js" },
      { pid: 200, parentPid: 1, name: "python", commandLine: "python unrelated.py" },
    ];
    const config = defaultConfig();
    config.termination.protectedProcessNames = ["devin"];
    config.termination.protectedCommandMarkers = ["agent"];
    const closure = computeProtectedPids(tree, config);
    expect([...closure.protectedPids].sort()).toEqual([100, 101, 102]);
    expect(closure.reasons.get(102)).toContain("child of protected pid");
  });

  it("never treats a lineage-protected child as a termination target", () => {
    const plan = planTermination({
      config: enabledConfig(),
      availableMb: 1024,
      readProcess: () => LIVE_INFO,
      candidates: [candidate],
      protectedPids: [4242],
    });
    expect(plan.action).toBe("none");
    expect(plan.skipped[0]?.reason).toContain("process tree");
  });

  it("skips protected names, protected ports, and unverified identities", () => {
    const config = enabledConfig();
    config.termination.protectedProcessNames = ["ollama"];
    config.termination.protectedPorts = [3001];
    const plan = planTermination({
      config,
      availableMb: 1024,
      readProcess: () => LIVE_INFO,
      candidates: [
        { ...candidate, pid: 1, name: "ollama" },
        { ...candidate, pid: 2, name: "worker", ports: [3001] },
        { ...candidate, pid: 3, name: "worker", claim: null },
      ],
    });
    expect(plan.action).toBe("none");
    expect(plan.skipped.map((s) => s.pid)).toEqual([1, 2, 3]);
    expect(plan.targets).toEqual([]);
  });
});
