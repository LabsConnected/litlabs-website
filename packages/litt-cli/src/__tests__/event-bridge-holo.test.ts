import { describe, it, expect } from "vitest";
import { resolveHoloTransition } from "../ink/event-bridge.js";
import type { HoloState } from "../ink/cockpit-store.js";

/**
 * Terminal holo states are sticky: a late tool.started/tool.completed
 * (which maps to RUNNING) arriving after the mission already reached a
 * terminal state must not resurrect RUNNING — the dogfood hang where
 * the canonical mission was complete but the shell spun RUNNING.
 */
describe("resolveHoloTransition — terminal stickiness", () => {
  const terminals: HoloState[] = ["COMPLETE", "FAILED", "CANCELLED", "TIMEOUT"];

  for (const terminal of terminals) {
    it(`suppresses RUNNING over ${terminal}`, () => {
      expect(resolveHoloTransition(terminal, "RUNNING")).toBeNull();
    });

    it(`still applies terminal-mapped events over ${terminal}`, () => {
      // run.completed maps to a terminal holo — a real terminal signal
      // is never suppressed, only the RUNNING regression is.
      expect(resolveHoloTransition(terminal, "FAILED")).toBe("FAILED");
      expect(resolveHoloTransition(terminal, "COMPLETE")).toBe("COMPLETE");
    });
  }

  it("suppresses RUNNING over VERIFYING (pre-existing guard)", () => {
    expect(resolveHoloTransition("VERIFYING", "RUNNING")).toBeNull();
  });

  it("freezes ALL event transitions once the mission is terminal", () => {
    // Canonical mission truth wins: a straggler COMPLETE cannot
    // overwrite a FAILED mission, and vice versa.
    expect(resolveHoloTransition("FAILED", "COMPLETE", "FAILED")).toBeNull();
    expect(resolveHoloTransition("IDLE", "RUNNING", "COMPLETE")).toBeNull();
    expect(resolveHoloTransition("IDLE", "VERIFYING", "FAILED")).toBeNull();
    expect(resolveHoloTransition("RUNNING", "COMPLETE", "CANCELLED")).toBeNull();
  });

  it("applies transitions normally while the mission is live", () => {
    expect(resolveHoloTransition("IDLE", "COMPLETE", "RUNNING")).toBe("COMPLETE");
    expect(resolveHoloTransition("VERIFYING", "COMPLETE", null)).toBe("COMPLETE");
    expect(resolveHoloTransition("IDLE", "RUNNING", null)).toBe("RUNNING");
    expect(resolveHoloTransition("IDLE", "RUNNING", "VERIFYING")).toBe("RUNNING");
  });

  it("applies RUNNING over working and idle states", () => {
    for (const s of ["IDLE", "UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING"] as HoloState[]) {
      expect(resolveHoloTransition(s, "RUNNING")).toBe("RUNNING");
    }
  });

  it("applies non-RUNNING transitions over terminal states", () => {
    // APPROVAL still interrupts a terminal display (operator attention).
    expect(resolveHoloTransition("COMPLETE", "APPROVAL")).toBe("APPROVAL");
  });
});
