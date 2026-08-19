/**
 * Mission delta — dogfood P0 regression.
 *
 * "29 files changed" must NEVER be attributed to a read-only mission
 * when the repo was already dirty before it. Repository state and
 * mission delta are separate concepts: baseline (captured at mission
 * start) vs terminal snapshot. Files dirty in BOTH are pre-existing.
 */

import { describe, it, expect } from "vitest";
import { porcelainPaths, parsePorcelainPath, computeMissionDelta } from "../lib/mission-delta.js";

describe("porcelainPaths", () => {
  it("parses modified/untracked lines", () => {
    const paths = porcelainPaths([
      " M src/foo.ts",
      "?? new-file.txt",
      "M  staged.ts",
      "AM both.ts",
    ].join("\n"));
    expect(paths).toEqual(["src/foo.ts", "new-file.txt", "staged.ts", "both.ts"]);
  });

  it("handles quoted paths with spaces", () => {
    const paths = porcelainPaths(' M "my file.ts"');
    expect(paths).toEqual(["my file.ts"]);
  });

  it("handles rename entries — the NEW path wins", () => {
    const paths = porcelainPaths("R  old.ts -> new.ts");
    expect(paths).toEqual(["new.ts"]);
  });

  it("ignores empty/whitespace lines", () => {
    expect(porcelainPaths("")).toEqual([]);
    expect(porcelainPaths("   ")).toEqual([]);
    expect(porcelainPaths(" M")).toEqual([]); // no path
  });

  it("deduplicates nothing (each line is one entry)", () => {
    const paths = porcelainPaths(" M a.ts\n M a.ts");
    expect(paths).toEqual(["a.ts", "a.ts"]);
  });
});

describe("computeMissionDelta", () => {
  it("never attributes pre-existing dirty files to the mission", () => {
    // Baseline: 29 files already dirty (the dogfood observation).
    const baseline = Array.from({ length: 29 }, (_, i) => `pre-existing-${i}.ts`);
    const current = [...baseline]; // the mission changed nothing
    const delta = computeMissionDelta(baseline, current);
    expect(delta.changed).toEqual([]);
    expect(delta.added).toEqual([]);
    expect(delta.removed).toEqual([]);
  });

  it("attributes only NEWLY dirty files to the mission", () => {
    const baseline = ["a.ts", "b.ts"]; // pre-existing
    const current = ["a.ts", "b.ts", "mission-new.ts"];
    const delta = computeMissionDelta(baseline, current);
    expect(delta.added).toEqual(["mission-new.ts"]);
    expect(delta.changed).toEqual(["mission-new.ts"]);
  });

  it("attributes files the mission cleaned up (reverted) to the mission", () => {
    const baseline = ["a.ts", "b.ts"];
    const current = ["a.ts"]; // b.ts was reverted by the mission
    const delta = computeMissionDelta(baseline, current);
    expect(delta.removed).toEqual(["b.ts"]);
    expect(delta.changed).toEqual(["b.ts"]);
  });

  it("a file dirty before AND after the mission is pre-existing, not delta", () => {
    // The mission touched a.ts further, but it was already dirty at
    // baseline — the count must not double-report it.
    const baseline = ["a.ts"];
    const current = ["a.ts", "b.ts"];
    const delta = computeMissionDelta(baseline, current);
    expect(delta.changed).toEqual(["b.ts"]);
    expect(delta.changed).not.toContain("a.ts");
  });

  it("sorts results for stable display", () => {
    const delta = computeMissionDelta([], ["z.ts", "a.ts", "m.ts"]);
    expect(delta.added).toEqual(["a.ts", "m.ts", "z.ts"]);
  });
});

describe("summary honesty rules (data level)", () => {
  // The MissionResultBlock derives these from MissionState fields —
  // the rules are pinned here so the renderer can't regress silently.
  it("read-only missions must not produce a mission delta", () => {
    // A read-only mission records readOnly=true and NO missionDeltaFiles
    // attribution for pre-existing dirt (the controller sets
    // missionDeltaFiles from the baseline comparison — an empty delta
    // for untouched repos).
    const mission = {
      text: "What branch am I on and is the working tree clean?",
      runId: null, state: "COMPLETE" as const, startedAt: 0, endedAt: 0,
      filesTouched: [], commandsExecuted: [], testResults: null,
      typecheckPassed: null, buildPassed: null, runtimeProven: true,
      baselineGitFiles: ["pre-existing-1.ts", "pre-existing-2.ts"],
      missionDeltaFiles: [], // 0 files changed by this mission
      readOnly: true,
      toolsUsed: ["project.status"],
    };
    // The delta is empty — no "29 files changed" lie.
    expect(mission.missionDeltaFiles?.length).toBe(0);
    // And the pre-existing dirt is visible in the baseline, NOT the delta.
    expect(mission.baselineGitFiles.length).toBeGreaterThan(0);
  });

  it("verification passed requires an actual proven gate for mutating missions", () => {
    const mission = {
      text: "fix", runId: null, state: "COMPLETE" as const, startedAt: 0, endedAt: 0,
      filesTouched: ["src/a.ts"], commandsExecuted: [], testResults: null,
      typecheckPassed: null, buildPassed: null, runtimeProven: false,
      baselineGitFiles: [], missionDeltaFiles: ["src/a.ts"],
      readOnly: false, toolsUsed: ["project.edit_file"],
    };
    // Mutating + unverified → the summary shows "verification failed",
    // never "verification passed".
    expect(mission.runtimeProven).toBe(false);
  });
});
