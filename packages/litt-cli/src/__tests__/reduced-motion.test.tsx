/**
 * Reduced motion — Android/Termux text selection is cancelled by every
 * periodic Ink repaint, so animation timers must not run there.
 */

import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clockIntervalMs, isReducedMotion, REDUCED_CLOCK_MS } from "../ink/motion.js";
import { Spinner } from "../ink/spinner.js";
import { LiTTMark } from "../ink/litt-mark.js";

describe("isReducedMotion", () => {
  it("is off on a desktop env", () => {
    expect(isReducedMotion({})).toBe(false);
  });
  it("defaults on for Termux (TERMUX_VERSION or PREFIX)", () => {
    expect(isReducedMotion({ TERMUX_VERSION: "0.118" })).toBe(true);
    expect(isReducedMotion({ PREFIX: "/data/data/com.termux/files/usr" })).toBe(true);
  });
  it("LITT_REDUCED_MOTION=1 forces on, anywhere", () => {
    for (const v of ["1", "true", "YES", "on"]) {
      expect(isReducedMotion({ LITT_REDUCED_MOTION: v })).toBe(true);
    }
  });
  it("LITT_REDUCED_MOTION=0 forces motion back on, even on Termux", () => {
    expect(isReducedMotion({ LITT_REDUCED_MOTION: "0", TERMUX_VERSION: "1" })).toBe(false);
  });
  it("ignores unrecognised values", () => {
    expect(isReducedMotion({ LITT_REDUCED_MOTION: "maybe" })).toBe(false);
    expect(isReducedMotion({ LITT_REDUCED_MOTION: "maybe", TERMUX_VERSION: "1" })).toBe(true);
  });
});

describe("clockIntervalMs", () => {
  it("keeps the normal cadence with full motion", () => {
    expect(clockIntervalMs(1000, {})).toBe(1000);
  });
  it("slows clocks when reduced", () => {
    expect(clockIntervalMs(1000, { LITT_REDUCED_MOTION: "1" })).toBe(REDUCED_CLOCK_MS);
  });
});

function mount(node: React.ReactElement) {
  const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
  Object.assign(stdout, { columns: 80, rows: 24, isTTY: true });
  const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.assign(stdin, { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  return render(node, { stdout, stdin, patchConsole: false, exitOnCtrlC: false });
}

describe("animation timers", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  function intervalsFor(node: () => React.ReactElement): number {
    const spy = vi.spyOn(globalThis, "setInterval");
    const app = mount(node());
    // Ink itself may schedule nothing periodic; count only ours by delay.
    const n = spy.mock.calls.filter(([, ms]) => typeof ms === "number" && ms < 2000).length;
    app.unmount();
    return n;
  }

  it("Spinner starts no interval when reduced, one otherwise", () => {
    process.env.LITT_REDUCED_MOTION = "1";
    expect(intervalsFor(() => <Spinner />)).toBe(0);
    process.env.LITT_REDUCED_MOTION = "0";
    expect(intervalsFor(() => <Spinner />)).toBe(1);
  });

  it("animated LiTTMark starts no interval when reduced, one otherwise", () => {
    process.env.LITT_REDUCED_MOTION = "1";
    expect(intervalsFor(() => <LiTTMark state="thinking" />)).toBe(0);
    process.env.LITT_REDUCED_MOTION = "0";
    expect(intervalsFor(() => <LiTTMark state="thinking" />)).toBe(1);
  });

  it("Termux env alone disables animation (no flag needed)", () => {
    delete process.env.LITT_REDUCED_MOTION;
    process.env.TERMUX_VERSION = "0.118";
    expect(intervalsFor(() => <Spinner />)).toBe(0);
  });
});
