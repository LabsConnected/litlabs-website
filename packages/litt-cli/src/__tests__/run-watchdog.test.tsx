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
import { describe, expect, it, vi } from "vitest";

import { useRunWatchdog } from "../ink/use-run-watchdog.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const freshCalls = () => ({
  cancelSession: vi.fn(),
  cancelRemoteModel: vi.fn(),
  resetUi: vi.fn(),
  recordFailure: vi.fn(),
});
type Calls = ReturnType<typeof freshCalls>;

/**
 * Mirrors production: re-renders continuously (like streamed output)
 * and passes FRESH callback objects every render.
 */
function Probe({
  runActive,
  calls,
  maxMs,
  tickMs = 40,
}: {
  runActive: boolean;
  calls: Calls;
  maxMs: number;
  tickMs?: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  useRunWatchdog(runActive, {
    cancelSession: calls.cancelSession,
    cancelRemoteModel: calls.cancelRemoteModel,
    resetUi: calls.resetUi,
    recordFailure: (t) => calls.recordFailure(`${t}@tick=${tick}`),
  }, maxMs);
  return null;
}

describe("useRunWatchdog", () => {
  it("fires once at the cap even while the run keeps re-rendering", async () => {
    const calls = freshCalls();
    const app = render(<Probe runActive={true} calls={calls} maxMs={300} />);
    try {
      // ~15 re-renders inside the window, then well past the cap.
      await sleep(800);
      expect(calls.cancelSession).toHaveBeenCalledTimes(1);
      expect(calls.cancelRemoteModel).toHaveBeenCalledTimes(1);
      expect(calls.resetUi).toHaveBeenCalledTimes(1);
      expect(calls.recordFailure).toHaveBeenCalledTimes(1);
      // The LATEST callback ran — the tick baked into the message came
      // from a render after arming, not a stale first-render closure.
      const text = calls.recordFailure.mock.calls[0][0] as string;
      const m = text.match(/@tick=(\d+)$/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(0);
    } finally {
      app.unmount();
    }
  }, 15000);

  it("disarms when the run settles — no fire after runActive flips", async () => {
    const calls = freshCalls();
    function Toggle() {
      const [active, setActive] = useState(true);
      useEffect(() => {
        const id = setTimeout(() => setActive(false), 100);
        return () => clearTimeout(id);
      }, []);
      return <Probe runActive={active} calls={calls} maxMs={250} />;
    }
    const app = render(<Toggle />);
    try {
      await sleep(600);
      expect(calls.cancelSession).not.toHaveBeenCalled();
      expect(calls.recordFailure).not.toHaveBeenCalled();
    } finally {
      app.unmount();
    }
  }, 15000);
});
