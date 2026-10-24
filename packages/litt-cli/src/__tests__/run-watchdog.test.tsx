/**
 * Run watchdog must not reset while a run is producing output.
 *
 * Root cause: the cockpit passed the whole `store`/`controller` objects
 * into the watchdog effect's dependency list. Both are rebuilt on every
 * render, so every streamed-token re-render stopped the armed timer and
 * started a fresh countdown — a run that kept producing output could
 * exceed LITT_MAX_RUN_MS forever without being cancelled.
 *
 * These tests mount the real useRunWatchdog hook and drive re-renders
 * with fresh callback identities — the production render pattern.
 */

import React, { useEffect, useState } from "react";
import { render } from "ink";
import { describe, expect, it } from "vitest";

import { useRunWatchdog } from "../ink/use-run-watchdog.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fired {
  cancelSession: number;
  cancelRemoteModel: number;
  resetUi: number;
  recordFailure: string[];
}

const freshFired = (): Fired => ({
  cancelSession: 0,
  cancelRemoteModel: 0,
  resetUi: 0,
  recordFailure: [],
});

/**
 * Mirrors production: re-renders continuously (like streamed output)
 * and passes FRESH callback objects every render.
 */
function Probe({
  runActive,
  fired,
  maxMs,
  tickMs = 40,
}: {
  runActive: boolean;
  fired: Fired;
  maxMs: number;
  tickMs?: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  useRunWatchdog(runActive, {
    cancelSession: () => { fired.cancelSession += 1; },
    cancelRemoteModel: () => { fired.cancelRemoteModel += 1; },
    resetUi: () => { fired.resetUi += 1; },
    recordFailure: (t) => { fired.recordFailure.push(`${t}@tick=${tick}`); },
  }, maxMs);
  return null;
}

describe("useRunWatchdog", () => {
  it("fires once at the cap even while the run keeps re-rendering", async () => {
    const fired = freshFired();
    const app = render(<Probe runActive={true} fired={fired} maxMs={300} />);
    try {
      // ~15 re-renders inside the window, then well past the cap.
      await sleep(800);
      expect(fired.cancelSession).toBe(1);
      expect(fired.cancelRemoteModel).toBe(1);
      expect(fired.resetUi).toBe(1);
      expect(fired.recordFailure).toHaveLength(1);
      // The LATEST callback ran — the tick baked into the message came
      // from a render after arming, not a stale first-render closure.
      const m = fired.recordFailure[0].match(/@tick=(\d+)$/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(0);
    } finally {
      app.unmount();
    }
  }, 15000);

  it("disarms when the run settles — no fire after runActive flips", async () => {
    const fired = freshFired();
    function Toggle() {
      const [active, setActive] = useState(true);
      useEffect(() => {
        const id = setTimeout(() => setActive(false), 100);
        return () => clearTimeout(id);
      }, []);
      return <Probe runActive={active} fired={fired} maxMs={250} />;
    }
    const app = render(<Toggle />);
    try {
      await sleep(600);
      expect(fired.cancelSession).toBe(0);
      expect(fired.recordFailure).toHaveLength(0);
    } finally {
      app.unmount();
    }
  }, 15000);
});
