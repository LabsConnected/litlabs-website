/**
 * P0: Terminal → IDLE race regression tests.
 *
 * These tests model the exact mission-generation semantics used by
 * CockpitStore.scheduleIdle:
 *
 *   - startMission() advances missionEpoch by exactly one.
 *   - setCurrentRunId() does NOT change missionEpoch.
 *   - scheduleIdle captures missionEpoch at scheduling and aborts the stale
 *     timer if a newer mission has started since then.
 *   - idleTransitionFromTerminal only transitions from terminal states.
 *
 * A real useCockpitStore() test would require React test infrastructure that
 * is not available in this environment, so we mirror the store's pure
 * scheduleIdle/idleTransitionFromTerminal contract here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { idleTransitionFromTerminal, type HoloState } from "../ink/cockpit-store.js";

describe("P0: terminal → IDLE race", () => {
  describe("idleTransitionFromTerminal", () => {
    it("returns IDLE from COMPLETE", () => {
      expect(idleTransitionFromTerminal("COMPLETE")).toBe("IDLE");
    });

    it("returns IDLE from FAILED", () => {
      expect(idleTransitionFromTerminal("FAILED")).toBe("IDLE");
    });

    it("returns IDLE from CANCELLED", () => {
      expect(idleTransitionFromTerminal("CANCELLED")).toBe("IDLE");
    });

    it("returns IDLE from TIMEOUT", () => {
      expect(idleTransitionFromTerminal("TIMEOUT")).toBe("IDLE");
    });

    it("leaves non-terminal states unchanged", () => {
      const nonTerminal: HoloState[] = [
        "IDLE", "UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING", "VERIFYING", "APPROVAL",
      ];
      for (const state of nonTerminal) {
        expect(idleTransitionFromTerminal(state)).toBe(state);
      }
    });

    it("APPROVAL remains sticky and is not reset to IDLE", () => {
      expect(idleTransitionFromTerminal("APPROVAL")).toBe("APPROVAL");
    });
  });

  describe("scheduleIdle missionEpoch semantics", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Mirrors CockpitStore.scheduleIdle for testing. */
    function makeScheduleIdle() {
      let holoState: HoloState = "IDLE";
      let missionEpoch = 0;
      let currentRunId: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const setHoloState = (fn: (prev: HoloState) => HoloState) => {
        holoState = fn(holoState);
      };

      const startMission = (runId: string | null = null) => {
        missionEpoch += 1; // matches CockpitStore.startMission
      };

      const setCurrentRunId = (runId: string | null) => {
        currentRunId = runId; // matches CockpitStore.setCurrentRunId: no epoch change
      };

      const scheduleIdle = (delayMs: number) => {
        if (timer) clearTimeout(timer);
        const epochAtSchedule = missionEpoch;
        timer = setTimeout(() => {
          if (missionEpoch !== epochAtSchedule) {
            return; // newer mission superseded this terminal state
          }
          setHoloState(idleTransitionFromTerminal);
        }, delayMs);
      };

      const getState = () => holoState;
      const getEpoch = () => missionEpoch;

      return { setHoloState, startMission, setCurrentRunId, scheduleIdle, getState, getEpoch };
    }

    it("A: a newer mission prevents the old terminal timer from returning to IDLE", () => {
      const store = makeScheduleIdle();

      store.setHoloState(() => "UNDERSTANDING");
      store.startMission();
      store.setHoloState(() => "COMPLETE");
      store.scheduleIdle(100);

      // New mission starts during the delay.
      store.startMission();
      store.setHoloState(() => "UNDERSTANDING");

      vi.advanceTimersByTime(100);

      expect(store.getState()).toBe("UNDERSTANDING");
    });

    it("B: the same mission receiving a backend runId later still allows terminal → IDLE", () => {
      const store = makeScheduleIdle();

      store.setHoloState(() => "UNDERSTANDING");
      store.startMission();
      store.setHoloState(() => "COMPLETE");
      store.scheduleIdle(100);

      // Same logical mission now learns its backend runId.
      store.setCurrentRunId("run_abc123");

      vi.advanceTimersByTime(100);

      expect(store.getState()).toBe("IDLE");
    });

    it("C: re-applying the same runId does not cause a false stale detection", () => {
      const store = makeScheduleIdle();

      store.startMission("run_a");
      store.setCurrentRunId("run_a");
      store.setHoloState(() => "COMPLETE");
      store.scheduleIdle(100);

      // Same runId is delivered again (e.g. duplicate event).
      store.setCurrentRunId("run_a");

      vi.advanceTimersByTime(100);

      expect(store.getState()).toBe("IDLE");
    });

    it("D: clearing currentRunId does not change missionEpoch and the terminal timer still fires", () => {
      const store = makeScheduleIdle();

      store.startMission();
      store.setCurrentRunId("run_a");
      store.setHoloState(() => "COMPLETE");
      store.scheduleIdle(100);

      // Run completed, runId cleared.
      store.setCurrentRunId(null);

      vi.advanceTimersByTime(100);

      expect(store.getState()).toBe("IDLE");
    });

    it("E: each genuinely new mission advances the epoch exactly once", () => {
      const store = makeScheduleIdle();

      store.startMission();
      expect(store.getEpoch()).toBe(1);

      store.startMission();
      expect(store.getEpoch()).toBe(2);

      // setCurrentRunId must not advance the mission epoch.
      store.setCurrentRunId("run_1");
      expect(store.getEpoch()).toBe(2);

      store.startMission();
      expect(store.getEpoch()).toBe(3);
    });
  });
});
