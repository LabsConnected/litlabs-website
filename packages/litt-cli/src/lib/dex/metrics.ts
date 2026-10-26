/**
 * Dex metrics — pure-Node CPU/RAM/uptime diagnostics.
 *
 * No subprocesses, no native modules. CPU percentage on Windows is
 * computed by sampling os.cpus() times twice (loadavg is Unix-only and
 * returns zeros on Windows, so it is reported honestly as unavailable
 * there rather than fabricated).
 */

import os from "node:os";

export interface CpuSample {
  /** Aggregate busy fraction 0..1 over the sample window. */
  busyFraction: number;
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

/**
 * Sample aggregate CPU busy fraction over `windowMs` (default 100ms).
 * Cross-platform — works on Windows where loadavg does not.
 */
export async function sampleCpuBusy(windowMs = 100): Promise<number> {
  const a = cpuTimes();
  await new Promise((r) => setTimeout(r, windowMs));
  const b = cpuTimes();
  const totalDelta = b.total - a.total;
  if (totalDelta <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - (b.idle - a.idle) / totalDelta));
}

export interface DexMetrics {
  platform: string;
  arch: string;
  hostname: string;
  uptimeSec: number;
  cpu: {
    model: string;
    cores: number;
    /** Busy fraction 0..1 over a ~100ms sample. Always present. */
    busyFraction: number;
    /** Unix 1/5/15-minute load averages — null on Windows (unsupported). */
    loadavg: [number, number, number] | null;
  };
  memory: {
    totalMb: number;
    freeMb: number;
    usedMb: number;
    usedFraction: number;
  };
}

export async function collectMetrics(): Promise<DexMetrics> {
  const cpus = os.cpus();
  const total = os.totalmem();
  const free = os.freemem();
  // os.loadavg() returns [0,0,0] on Windows — report null instead of fake zeros.
  const loadavg = process.platform === "win32" ? null : (os.loadavg() as [number, number, number]);
  return {
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    uptimeSec: Math.round(os.uptime()),
    cpu: {
      model: cpus[0]?.model ?? "unknown",
      cores: cpus.length,
      busyFraction: await sampleCpuBusy(),
      loadavg,
    },
    memory: {
      totalMb: Math.round(total / 1024 / 1024),
      freeMb: Math.round(free / 1024 / 1024),
      usedMb: Math.round((total - free) / 1024 / 1024),
      usedFraction: total > 0 ? (total - free) / total : 0,
    },
  };
}
