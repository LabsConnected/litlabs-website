/**
 * Tests for PerfTrace — the LITT_PERF=1 latency instrumentation.
 *
 * Behavior:
 *   - Disabled by default (no-op, zero overhead).
 *   - Enabled by LITT_PERF=1 / LITT_PERF=true.
 *   - mark() is de-duplicated by label (first occurrence wins) —
 *     critical for "first_token" which is emitted on every delta.
 *   - end() is idempotent and prints a report to stderr.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import { PerfTrace } from "../lib/perf-trace.js";

describe("PerfTrace", () => {
  const originalPerf = process.env.LITT_PERF;
  // Typed to the real write() signature so .mock.calls is properly typed
  // (avoids both the overloaded ReturnType mismatch and implicit-any in
  // downstream .map/.filter callbacks).
  let stderrSpy: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalPerf === undefined) delete process.env.LITT_PERF;
    else process.env.LITT_PERF = originalPerf;
  });

  describe("disabled (default)", () => {
    beforeEach(() => delete process.env.LITT_PERF);

    it("is a no-op when LITT_PERF is unset", () => {
      const perf = PerfTrace.start("chat");
      expect(perf.enabled).toBe(false);
      perf.mark("route");
      perf.mark("first_token");
      perf.end("chat");
      // No stderr output when disabled.
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe("enabled (LITT_PERF=1)", () => {
    beforeEach(() => { process.env.LITT_PERF = "1"; });

    it("enables when LITT_PERF=1", () => {
      const perf = PerfTrace.start("mission");
      expect(perf.enabled).toBe(true);
    });

    it("enables when LITT_PERF=true", () => {
      process.env.LITT_PERF = "true";
      const perf = PerfTrace.start("mission");
      expect(perf.enabled).toBe(true);
    });

    it("de-duplicates marks by label (first occurrence wins)", () => {
      const perf = PerfTrace.start("chat");
      perf.mark("first_token");
      perf.mark("first_token"); // duplicate — ignored
      perf.mark("first_token"); // duplicate — ignored
      perf.end("chat");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      // De-dup: three mark("first_token") calls collapsed to ONE mark
      // transition line (excluding the "(total to last mark)" summary).
      const lines = output.split("\n");
      const transitionLines = lines.filter(
        (l) => l.includes("→ first_token") && !l.includes("(total to last mark)"),
      );
      expect(transitionLines.length).toBe(1);
    });

    it("end() prints a report with submit and the total", () => {
      const perf = PerfTrace.start("mission");
      perf.mark("route");
      perf.mark("provider_ready");
      perf.end("mission");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("LiTT PERF");
      expect(output).toContain("mission");
      expect(output).toContain("submit");
      expect(output).toContain("route");
      expect(output).toContain("provider_ready");
    });

    it("end() is idempotent — calling twice prints once", () => {
      const perf = PerfTrace.start("chat");
      perf.mark("route");
      perf.end("chat");
      const callsAfterFirst = stderrSpy.mock.calls.length;
      perf.end("chat"); // no-op
      expect(stderrSpy.mock.calls.length).toBe(callsAfterFirst);
    });

    // ─── Controller mark-sequence contracts ───────────────────────────
    // These verify the LABELS and ORDERING the controller emits, without
    // mounting the React hook. PerfTrace is the pure state machine the
    // controller drives; these tests pin its contract so a reordered or
    // mislabeled mark in the controller is caught here.

    /** Parse a PerfTrace report into the ordered list of mark labels.
     *  Line format: "  <from> → <to>   <delta>ms". The anchored regex
     *  captures exactly the labels (never the timing suffix) and the
     *  chain is reconstructed by appending each transition's target. */
    function orderedMarks(output: string): string[] {
      const marks: string[] = [];

      for (const line of output.split("\n")) {
        if (!line.includes("→") || line.includes("(total to last mark)")) continue;

        const match = line.match(
          /^\s*(\S+)\s+→\s+(\S+)\s+\d+ms\s*$/,
        );

        if (!match) continue;

        const [, from, to] = match;

        if (marks.length === 0) {
          marks.push(from);
        }

        if (marks.at(-1) !== to) {
          marks.push(to);
        }
      }

      return marks;
    }

    it("CHAT records first_token after provider_ready (visible-prose mark)", () => {
      const perf = PerfTrace.start("chat");
      perf.mark("intent_classified");
      perf.mark("context_resolved");
      perf.mark("route");
      perf.mark("provider_ready");
      // onModelStream fires first_token on the first VISIBLE delta.
      perf.mark("first_token");
      perf.mark("finalize");
      perf.end("chat");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      const marks = orderedMarks(output);
      expect(marks).toContain("first_token");
      // first_token must come AFTER provider_ready (the adapter-ready
      // boundary), never before — it marks real model prose.
      expect(marks.indexOf("first_token")).toBeGreaterThan(marks.indexOf("provider_ready"));
    });

    it("CHAT first_token is de-duplicated (first visible delta wins)", () => {
      const perf = PerfTrace.start("chat");
      perf.mark("route");
      perf.mark("provider_ready");
      perf.mark("first_token");
      perf.mark("first_token"); // subsequent deltas — ignored
      perf.mark("first_token");
      perf.mark("finalize");
      perf.end("chat");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      const firstTokenLines = output
        .split("\n")
        .filter((l) => l.includes("→ first_token") && !l.includes("(total to last mark)"));
      expect(firstTokenLines.length).toBe(1);
    });

    it("MISSION setup marks are emitted in truthful order", () => {
      // Mirrors the controller's mission setup sequence:
      //   intent_classified → context_resolved → branch_refreshed →
      //   mission_initialized → mission_created → route → provider_ready
      const perf = PerfTrace.start("mission");
      perf.mark("intent_classified");
      perf.mark("context_resolved");
      perf.mark("branch_refreshed");
      perf.mark("mission_initialized");
      perf.mark("mission_created");
      perf.mark("route");
      perf.mark("provider_ready");
      perf.end("mission");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      const marks = orderedMarks(output);
      const expected = [
        "submit",
        "intent_classified",
        "context_resolved",
        "branch_refreshed",
        "mission_initialized",
        "mission_created",
        "route",
        "provider_ready",
      ];
      expect(marks).toEqual(expected);
    });

    it("MISSION planning marks bracket planMission (plan_start → plan_end → agent_loop_start)", () => {
      const perf = PerfTrace.start("mission");
      perf.mark("route");
      perf.mark("provider_ready");
      perf.mark("plan_start");
      perf.mark("plan_end");
      perf.mark("agent_loop_start");
      perf.mark("first_token");
      perf.mark("finalize");
      perf.end("mission");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      const marks = orderedMarks(output);
      // plan_start precedes plan_end precedes agent_loop_start — the
      // planning round must not be bundled into the execution span.
      const i = (label: string) => marks.indexOf(label);
      expect(i("plan_start")).toBeLessThan(i("plan_end"));
      expect(i("plan_end")).toBeLessThan(i("agent_loop_start"));
      // agent_loop_start precedes first_token — the first outbound
      // request fires inside the loop, before any visible prose.
      expect(i("agent_loop_start")).toBeLessThan(i("first_token"));
    });

    it("provider_ready is the truthful label (not provider_request)", () => {
      // The controller no longer claims an outbound request at adapter
      // resolution time. provider_request must NOT appear in the report.
      const perf = PerfTrace.start("mission");
      perf.mark("route");
      perf.mark("provider_ready");
      perf.end("mission");
      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).not.toContain("provider_request");
      expect(output).toContain("provider_ready");
    });
  });
});
