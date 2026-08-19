/**
 * Focus state machine — dogfood P0 regression (focus/cursor trap).
 *
 * Contract: the shell must never trap the user in the input. Focus
 * restoration is EVENT-BASED, never render-based:
 *   - the composer renders its caret ONLY when it is genuinely the
 *     active interaction target (idle + live)
 *   - stream chunks, busy-timer updates, semantic events, status bar
 *     updates, and scroll position changes NEVER re-assert focus
 *   - restoration happens EXACTLY ONCE per real transition: overlay
 *     close, run settle (complete/failed/cancelled), explicit
 *     return-to-live
 *   - repeated rerenders can never cause a focus loop
 *
 * Pure module tests — no React renderer needed (focus-state.ts).
 */

import { describe, it, expect } from "vitest";
import { deriveFocusState, FocusEpochTracker } from "../ink/focus-state.js";

describe("deriveFocusState — the composer only owns focus when it is the target", () => {
  it("idle + live: composer eligible, caret blinks", () => {
    const f = deriveFocusState({ overlayActive: false, busy: false, approvalActive: false, scrolled: false });
    expect(f.composerEligible).toBe(true);
    expect(f.showCaret).toBe(true);
    expect(f.blinkEnabled).toBe(true);
  });

  it("busy: no caret, no blink, no input ownership — but Esc/PgUp still work via the app handler", () => {
    const f = deriveFocusState({ overlayActive: false, busy: true, approvalActive: false, scrolled: false });
    expect(f.composerEligible).toBe(false);
    expect(f.showCaret).toBe(false);
    expect(f.blinkEnabled).toBe(false);
  });

  it("streaming/timer/status updates while busy never change the derivation", () => {
    // The derivation is a pure projection of the same inputs — repeated
    // renders (stream deltas, elapsed-time ticks, semantic events) pass
    // the same busy=true and get the same no-caret answer.
    const a = deriveFocusState({ overlayActive: false, busy: true, approvalActive: false, scrolled: false });
    const b = deriveFocusState({ overlayActive: false, busy: true, approvalActive: false, scrolled: false });
    expect(a).toEqual(b);
    expect(a.showCaret).toBe(false);
  });

  it("overlay active: no caret, no blink", () => {
    const f = deriveFocusState({ overlayActive: true, busy: false, approvalActive: false, scrolled: false });
    expect(f.composerEligible).toBe(false);
    expect(f.showCaret).toBe(false);
    expect(f.blinkEnabled).toBe(false);
  });

  it("approval active: no caret, no blink", () => {
    const f = deriveFocusState({ overlayActive: false, busy: false, approvalActive: true, scrolled: false });
    expect(f.composerEligible).toBe(false);
    expect(f.showCaret).toBe(false);
    expect(f.blinkEnabled).toBe(false);
  });

  it("scrolled history: never manufacture a fake composer caret, but input still allowed", () => {
    const f = deriveFocusState({ overlayActive: false, busy: false, approvalActive: false, scrolled: true });
    expect(f.composerEligible).toBe(true);
    expect(f.showCaret).toBe(false);
    expect(f.blinkEnabled).toBe(false);
  });

  it("PgUp while busy stays scrolled: subsequent stream events do not change the derivation", () => {
    // PgUp sets an anchor → scrolled. While busy, both flags hold:
    // busy hides the caret and scroll keeps it hidden — nothing snaps.
    const f = deriveFocusState({ overlayActive: false, busy: true, approvalActive: false, scrolled: true });
    expect(f.showCaret).toBe(false);
    expect(f.blinkEnabled).toBe(false);
    expect(f.composerEligible).toBe(false);
  });
});

describe("FocusEpochTracker — exactly-once, event-based restoration", () => {
  it("starts focused at launch (epoch 1)", () => {
    const t = new FocusEpochTracker();
    expect(t.epoch).toBe(1);
  });

  it("opening an overlay does NOT restore; closing it restores exactly once", () => {
    const t = new FocusEpochTracker();
    const openEpoch = t.setOverlay("command-palette");
    expect(openEpoch).toBe(1); // opening is not a restoration
    const closeEpoch = t.setOverlay("none");
    expect(closeEpoch).toBe(2); // restored once
    // A second "none" (already closed — repeated closeOverlay calls)
    // must not double-restore.
    expect(t.setOverlay("none")).toBe(2);
  });

  it("each overlay close restores exactly once (palette → @ picker → close)", () => {
    const t = new FocusEpochTracker();
    t.setOverlay("command-palette");
    t.setOverlay("context-picker"); // open another overlay: no restore
    expect(t.epoch).toBe(1);
    expect(t.setOverlay("none")).toBe(2);
    t.setOverlay("diff-viewer");
    expect(t.setOverlay("none")).toBe(3);
  });

  it("starting a run does NOT restore; run settle restores exactly once", () => {
    const t = new FocusEpochTracker();
    t.setBusy(true);
    expect(t.epoch).toBe(1); // starting work is not a restoration
    expect(t.setBusy(false)).toBe(2); // terminal state → restored once
    // Repeated stopBusy calls (stale closures, finally guards) must not
    // double-restore.
    expect(t.setBusy(false)).toBe(2);
  });

  it("terminal completion and cancellation both restore exactly once", () => {
    const t = new FocusEpochTracker();
    t.setBusy(true);
    expect(t.setBusy(false)).toBe(2); // complete
    t.setBusy(true);
    expect(t.setBusy(false)).toBe(3); // cancelled
  });

  it("busy → idle → busy → idle: one bump per settle, no accumulation", () => {
    const t = new FocusEpochTracker();
    t.setBusy(true);
    t.setBusy(true); // repeated startBusy while already busy: no bump
    expect(t.epoch).toBe(1);
    t.setBusy(false);
    t.setBusy(false);
    expect(t.epoch).toBe(2);
  });

  it("elapsed timer / stream chunk / semantic event updates never bump (no focus loop)", () => {
    const t = new FocusEpochTracker();
    // Simulate a long run: busy with MANY no-op updates between.
    t.setBusy(true);
    for (let i = 0; i < 1000; i++) {
      // renders, stream chunks, timer ticks, status updates — none of
      // these call setOverlay/setBusy with a real transition
      t.setBusy(true);
      t.setOverlay("none"); // already none
    }
    expect(t.epoch).toBe(1); // no focus loop from repeated updates
    expect(t.setBusy(false)).toBe(2); // settle restores exactly once
  });

  it("explicit bump restores once per call (return-to-live by typing)", () => {
    const t = new FocusEpochTracker();
    expect(t.bump()).toBe(2);
    expect(t.bump()).toBe(3);
  });
});
