/**
 * Preview verify sweeper (round 16 follow-up) — the terminal-side
 * driver for the live preview verify.
 *
 * The 2026-11-18 live proof of PR #1040 (C2) failed because verify
 * rounds ran only as a side effect of the Studio panel polling the
 * preview status endpoint: the external-failure counter froze at 3
 * of 4 rounds when the panel stopped polling, and the recreation
 * never fired. These tests pin the sweeper's contract:
 *
 *   (a) a sweep tick runs a verify round with NO panel/status poll
 *       occurring anywhere in the test;
 *   (b) the per-session re-entrancy guard prevents overlapping
 *       rounds for one session, and releases when the round settles;
 *   (c) tracking stops when a session ends — no further rounds, no
 *       leaked in-flight state, and a session recreated under a new
 *       sandbox id is tracked fresh;
 *   (d) the interval start/stop wiring (idempotent start, no rounds
 *       after stop) and the default cadence staying in the 30–45 s
 *       band;
 *   (e) a throwing verify round neither kills the sweeper nor leaks
 *       its guard entry.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createPreviewVerifySweeper,
  PREVIEW_VERIFY_SWEEP_INTERVAL_MS,
  type PreviewVerifySweepSession,
  type PreviewVerifySweeper,
} from "../preview/preview-verify-sweeper";

/** Flush detached sweeper rounds (real timers). */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

interface Harness {
  sessions: Map<string, PreviewVerifySweepSession>;
  verifyCalls: string[];
  logLines: { workspaceId: string; line: string }[];
  sweeper: PreviewVerifySweeper;
}

function makeHarness(
  verifyImpl?: (workspaceId: string, h: Harness) => Promise<unknown>,
  intervalMs?: number,
): Harness {
  const h = {} as Harness;
  h.sessions = new Map();
  h.verifyCalls = [];
  h.logLines = [];
  h.sweeper = createPreviewVerifySweeper({
    listSessions: () => [...h.sessions.values()],
    getSession: (workspaceId) => h.sessions.get(workspaceId),
    verify: async (workspaceId) => {
      h.verifyCalls.push(workspaceId);
      if (verifyImpl) return verifyImpl(workspaceId, h);
      // Default round: one more consecutive external failure, the
      // way a failed external probe advances C2's accounting.
      const s = h.sessions.get(workspaceId);
      if (s) s.externalFailureCount += 1;
      return true;
    },
    log: (workspaceId, line) => {
      h.logLines.push({ workspaceId, line });
    },
    intervalMs,
  });
  return h;
}

function addSession(
  h: Harness,
  workspaceId = "ws-1",
  sandboxId: string | null = "sb-1",
): PreviewVerifySweepSession {
  const s: PreviewVerifySweepSession = {
    workspaceId,
    sandboxId,
    externalFailureCount: 0,
  };
  h.sessions.set(workspaceId, s);
  return s;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("preview verify sweeper", () => {
  it("(a) runs a verify round on a sweep tick with no panel/status poll", async () => {
    const h = makeHarness();
    addSession(h);

    // Nothing in this test calls any status endpoint or panel code —
    // the tick alone must drive the round.
    h.sweeper.tick();
    await settle();

    expect(h.verifyCalls).toEqual(["ws-1"]);
    expect(h.logLines).toHaveLength(1);
    expect(h.logLines[0].workspaceId).toBe("ws-1");
    expect(h.logLines[0].line).toContain("[preview]");
    expect(h.logLines[0].line).toContain("sandbox=sb-1");
    // The line carries the counter AFTER the round (the round's own
    // failed probe advanced it 0 → 1), so a stall below the gate is
    // visible in the logs.
    expect(h.logLines[0].line).toContain("externalFailures=1");
    expect(h.sweeper.inFlightCount()).toBe(0);
  });

  it("(b) re-entrancy guard: overlapping ticks never overlap rounds for one session", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const h = makeHarness(async () => {
      await gate;
      return true;
    });
    addSession(h);

    h.sweeper.tick();
    // The first round is in flight (verify has not settled). A second
    // tick — the next interval firing, or any extra driver — must
    // skip this session rather than bank a parallel round.
    h.sweeper.tick();
    expect(h.verifyCalls).toEqual(["ws-1"]);
    expect(h.sweeper.inFlightCount()).toBe(1);

    release();
    await settle();
    expect(h.sweeper.inFlightCount()).toBe(0);

    // Guard released: the next tick runs a fresh round.
    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1", "ws-1"]);
  });

  it("(c) tracking stops when the session ends; a recreated session is tracked fresh", async () => {
    const h = makeHarness();
    addSession(h, "ws-1", "sb-old");

    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1"]);
    expect(h.logLines).toHaveLength(1);
    expect(h.logLines[0].line).toContain("sandbox=sb-old");

    // Session ends (preview stopped / runtime gone): further ticks
    // must not verify it, log for it, or hold any state for it.
    h.sessions.delete("ws-1");
    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1"]);
    expect(h.logLines).toHaveLength(1);
    expect(h.sweeper.inFlightCount()).toBe(0);

    // The workspace comes back with a recreated sandbox (new id):
    // it is a live session again and its rounds log the NEW id —
    // no zombie tracking keyed to the dead session.
    addSession(h, "ws-1", "sb-new");
    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1", "ws-1"]);
    expect(h.logLines).toHaveLength(2);
    expect(h.logLines[1].line).toContain("sandbox=sb-new");
  });

  it("(d) interval wiring: start is idempotent, stop ends the rounds, default cadence is 30–45 s", async () => {
    expect(PREVIEW_VERIFY_SWEEP_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
    expect(PREVIEW_VERIFY_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(45_000);

    vi.useFakeTimers();
    const h = makeHarness(undefined, 1_000);
    addSession(h);

    h.sweeper.start();
    h.sweeper.start(); // idempotent — must not double the interval
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.verifyCalls).toEqual(["ws-1"]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.verifyCalls).toEqual(["ws-1", "ws-1"]);

    h.sweeper.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.verifyCalls).toEqual(["ws-1", "ws-1"]);
  });

  it("(e) a throwing verify round releases the guard and the sweeper keeps ticking", async () => {
    let shouldThrow = true;
    const h = makeHarness(async () => {
      if (shouldThrow) throw new Error("verify blew up");
      return true;
    });
    addSession(h);

    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1"]);
    expect(h.sweeper.inFlightCount()).toBe(0);

    shouldThrow = false;
    h.sweeper.tick();
    await settle();
    expect(h.verifyCalls).toEqual(["ws-1", "ws-1"]);
    expect(h.logLines).toHaveLength(1);
  });
});
