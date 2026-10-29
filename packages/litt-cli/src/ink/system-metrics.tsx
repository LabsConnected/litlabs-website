/**
 * System metrics for the mobile cockpit status bar.
 *
 * Why this exists: on Android/Termux the operator cannot see the device
 * while LiTT runs — a run that stalls because LMK is pressuring RAM or
 * the battery is dying looks identical to a slow model. The status bar
 * surfaces load, memory, battery, and storage so resource pressure is
 * visible BEFORE it kills the session.
 *
 * Cost contract (same discipline as the shell prompt cache):
 *   - every probe is a cheap file read — /proc/loadavg, /proc/meminfo,
 *     /sys/class/power_supply, fs.statfsSync — no daemons, no polling
 *     services, nothing left running
 *   - ONE fallback process spawn (termux-battery-status, 1.5s timeout)
 *     happens ONLY when sysfs exposes no battery node — on devices
 *     where Android hides it — and at most once per sample interval
 *   - every probe is individually fail-soft: a missing field simply
 *     drops that segment; the row never lies about what it knows
 */

import React from "react";
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { Text } from "ink";
import { COLORS } from "./colors.js";

export interface SystemMetrics {
  /** 1-minute load average, e.g. 0.42. */
  load1: number | null;
  /** Percent of RAM in use (100 - MemAvailable/MemTotal). */
  memUsedPct: number | null;
  /** Battery charge percent, if the device exposes one. */
  batteryPct: number | null;
  /** True while the device reports charging/full. */
  batteryCharging: boolean | null;
  /** Free space on the filesystem holding rootDir, in GiB. */
  storageAvailGb: number | null;
}

const EMPTY: SystemMetrics = {
  load1: null,
  memUsedPct: null,
  batteryPct: null,
  batteryCharging: null,
  storageAvailGb: null,
};

export function sampleSystemMetrics(rootDir: string): SystemMetrics {
  const m: SystemMetrics = { ...EMPTY };

  // CPU pressure — /proc/loadavg field 1 is the 1-min run-queue average.
  try {
    const raw = fs.readFileSync("/proc/loadavg", "utf8");
    const v = Number.parseFloat(raw.split(" ")[0] ?? "");
    if (Number.isFinite(v)) m.load1 = v;
  } catch { /* probe unavailable — segment omitted */ }

  // RAM pressure — MemAvailable (not MemFree) is the honest number:
  // page cache is reclaimable and must not count as "used".
  try {
    const mem = fs.readFileSync("/proc/meminfo", "utf8");
    const total = Number(/MemTotal:\s+(\d+)/.exec(mem)?.[1]);
    const avail = Number(/MemAvailable:\s+(\d+)/.exec(mem)?.[1]);
    if (total > 0 && avail >= 0) {
      m.memUsedPct = Math.round(((total - avail) / total) * 100);
    }
  } catch { /* omit segment */ }

  // Battery — Android usually exposes /sys/class/power_supply/battery;
  // scan all supplies rather than assuming the name (varies by vendor).
  try {
    const base = "/sys/class/power_supply";
    const supplies = fs.readdirSync(base);
    for (const name of supplies) {
      try {
        const dir = `${base}/${name}`;
        if (fs.readFileSync(`${dir}/type`, "utf8").trim() !== "Battery") continue;
        const cap = Number.parseInt(fs.readFileSync(`${dir}/capacity`, "utf8"), 10);
        if (Number.isFinite(cap)) m.batteryPct = cap;
        const status = fs.readFileSync(`${dir}/status`, "utf8").trim();
        m.batteryCharging = status === "Charging" || status === "Full";
        break;
      } catch { /* try next supply */ }
    }
  } catch { /* no sysfs power dir */ }

  // No sysfs battery (hidden on some devices / inside containers) — ask
  // Termux:API once. Bounded spawn: hard timeout, JSON only, non-fatal.
  if (m.batteryPct === null) {
    try {
      const out = execFileSync("termux-battery-status", [], {
        timeout: 1500, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      });
      const j = JSON.parse(out) as { percentage?: unknown; status?: unknown };
      if (typeof j.percentage === "number") m.batteryPct = j.percentage;
      if (typeof j.status === "string") {
        m.batteryCharging = j.status === "CHARGING" || j.status === "FULL";
      }
    } catch { /* battery stays unknown */ }
  }

  // Storage — free space where the project lives.
  try {
    const st = fs.statfsSync(rootDir);
    m.storageAvailGb = Math.round((st.bavail * st.bsize) / 1e9);
  } catch { /* omit segment */ }

  return m;
}

export function hasAnyMetric(m: SystemMetrics): boolean {
  return (
    m.load1 !== null || m.memUsedPct !== null ||
    m.batteryPct !== null || m.storageAvailGb !== null
  );
}

/**
 * Poll metrics on an interval. The sampler is synchronous and cheap
 * (file reads); 15s is frequent enough to catch LMK pressure buildup
 * without churning the render loop.
 */
export function useSystemMetrics(rootDir: string, intervalMs = 15_000): SystemMetrics {
  const [metrics, setMetrics] = React.useState<SystemMetrics>(() => sampleSystemMetrics(rootDir));
  React.useEffect(() => {
    setMetrics(sampleSystemMetrics(rootDir));
    const timer = setInterval(() => setMetrics(sampleSystemMetrics(rootDir)), intervalMs);
    return () => clearInterval(timer);
  }, [rootDir, intervalMs]);
  return metrics;
}

/** Segments in display order — later segments drop first on narrow terminals. */
function segments(m: SystemMetrics): { text: string; color?: string }[] {
  const out: { text: string; color?: string }[] = [];
  if (m.load1 !== null) {
    out.push({
      text: `CPU ${m.load1.toFixed(1)}`,
      // 1-min load above the core count = sustained queue pressure.
      color: m.load1 >= 6 ? COLORS.warning : COLORS.secondaryDim,
    });
  }
  if (m.memUsedPct !== null) {
    out.push({
      text: `RAM ${m.memUsedPct}%`,
      color: m.memUsedPct >= 90 ? COLORS.error
        : m.memUsedPct >= 75 ? COLORS.warning : COLORS.secondaryDim,
    });
  }
  if (m.batteryPct !== null) {
    out.push({
      text: `BAT ${m.batteryPct}%${m.batteryCharging ? "+" : ""}`,
      color: m.batteryCharging ? COLORS.success
        : m.batteryPct <= 20 ? COLORS.error
        : m.batteryPct <= 35 ? COLORS.warning : COLORS.secondaryDim,
    });
  }
  if (m.storageAvailGb !== null) {
    out.push({
      text: `${m.storageAvailGb}G free`,
      color: m.storageAvailGb <= 5 ? COLORS.warning : COLORS.secondaryDim,
    });
  }
  return out;
}

/**
 * Compact one-line metrics row. Renders nothing when no probe succeeded
 * (never a fake "N/A" wall). Segments drop from the right when the row
 * would exceed maxWidth — the most important indicator (CPU) survives
 * longest on narrow terminals.
 */
export function MetricsRow({ metrics, maxWidth }: { metrics: SystemMetrics; maxWidth: number }): React.ReactElement | null {
  const segs = segments(metrics);
  if (segs.length === 0) return null;

  const kept: { text: string; color?: string }[] = [];
  let width = 0;
  for (const s of segs) {
    const need = s.text.length + (kept.length > 0 ? 3 : 0); // " · " separator
    if (width + need > maxWidth) break;
    kept.push(s);
    width += need;
  }
  if (kept.length === 0) return null;

  return (
    <Text>
      {kept.map((s, i) => (
        <React.Fragment key={s.text}>
          {i > 0 && <Text dimColor> · </Text>}
          <Text color={s.color ?? COLORS.secondaryDim}>{s.text}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}
