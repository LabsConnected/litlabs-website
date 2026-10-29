/**
 * system-metrics — device vitals row for the mobile cockpit.
 *
 * Covers: sampler shape (every probe is fail-soft — fields may be null
 * on devices that lack them), segment ordering/severity, and
 * narrow-terminal drop behavior (CPU survives longest). Render pattern
 * matches activity-stream-stage1.test.tsx — ink's own render() into a
 * PassThrough stdout with interactive:true so the frame is written.
 */
import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { describe, it, expect } from "vitest";
import {
  sampleSystemMetrics,
  hasAnyMetric,
  MetricsRow,
  type SystemMetrics,
} from "../ink/system-metrics.js";

const FULL: SystemMetrics = {
  load1: 0.42,
  memUsedPct: 52,
  batteryPct: 87,
  batteryCharging: false,
  storageAvailGb: 86,
};

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

async function frame(el: React.ReactElement): Promise<string> {
  const out: string[] = [];
  const stdout = new PassThrough();
  stdout.on("data", (d) => out.push(d.toString()));
  const inst = render(el, {
    stdin: new PassThrough() as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false, patchConsole: false, interactive: true,
  });
  const deadline = Date.now() + 1000;
  while (out.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  inst.unmount();
  return stripAnsi(out.join(""));
}

describe("sampleSystemMetrics", () => {
  it("returns the full nullable shape without throwing", () => {
    const m = sampleSystemMetrics(process.cwd());
    expect(m).toHaveProperty("load1");
    expect(m).toHaveProperty("memUsedPct");
    expect(m).toHaveProperty("batteryPct");
    expect(m).toHaveProperty("batteryCharging");
    expect(m).toHaveProperty("storageAvailGb");
    if (m.memUsedPct !== null) {
      expect(m.memUsedPct).toBeGreaterThanOrEqual(0);
      expect(m.memUsedPct).toBeLessThanOrEqual(100);
    }
  });
});

describe("hasAnyMetric", () => {
  it("false when every probe failed", () => {
    expect(hasAnyMetric({
      load1: null, memUsedPct: null, batteryPct: null,
      batteryCharging: null, storageAvailGb: null,
    })).toBe(false);
  });
  it("true with a single known field", () => {
    expect(hasAnyMetric({
      load1: 1.2, memUsedPct: null, batteryPct: null,
      batteryCharging: null, storageAvailGb: null,
    })).toBe(true);
  });
});

describe("MetricsRow", () => {
  it("renders all known segments in order", async () => {
    const f = await frame(<MetricsRow metrics={FULL} maxWidth={80} />);
    expect(f).toContain("CPU 0.4");
    expect(f).toContain("RAM 52%");
    expect(f).toContain("BAT 87%");
    expect(f).toContain("86G free");
  });

  it("marks charging state", async () => {
    const f = await frame(
      <MetricsRow metrics={{ ...FULL, batteryCharging: true }} maxWidth={80} />,
    );
    expect(f).toContain("BAT 87%+");
  });

  it("drops trailing segments first when narrow — CPU survives", async () => {
    const f = await frame(<MetricsRow metrics={FULL} maxWidth={10} />);
    expect(f).toContain("CPU 0.4");
    expect(f).not.toContain("86G free");
  });

  it("renders nothing when all probes failed (no fake data)", async () => {
    const f = await frame(
      <MetricsRow
        metrics={{
          load1: null, memUsedPct: null, batteryPct: null,
          batteryCharging: null, storageAvailGb: null,
        }}
        maxWidth={80}
      />,
    );
    expect(f).toBe("");
  });
});
