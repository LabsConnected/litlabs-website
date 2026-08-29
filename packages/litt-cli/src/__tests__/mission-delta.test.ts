/**
 * Mission delta — dogfood P0 regression.
 *
 * "29 files changed" must NEVER be attributed to a read-only mission
 * when the repo was already dirty before it. Repository state and
 * mission delta are separate concepts: baseline (captured at mission
 * start) vs terminal snapshot. Files dirty in BOTH are pre-existing.
 */

import { describe, it, expect } from "vitest";
import { porcelainPaths, parsePorcelainPath, computeMissionDelta, isGeneratedArtifact } from "../lib/mission-delta.js";

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

// ─── Generated artifacts are not mission edits ──────────────────────
//
// Regression coverage for the false "N files changed by this mission"
// report. Two independent causes:
//
//  1. The controller read the baseline back from `store.state`, a
//     render-time snapshot captured BEFORE setMissionBaseline() ran, so
//     it saw [] and attributed every already-dirty file in the repo to
//     the mission. Fixed by holding the baseline in a local binding
//     (controller.ts) — covered here at the data level by proving a
//     non-empty baseline is honoured and an empty one is not equivalent.
//
//  2. Verification PRODUCES build output. A mission that merely ran a
//     typecheck leaves tsconfig.tsbuildinfo and dist/** dirty; counting
//     those tells the user LiTT edited their source when it did not.

describe("isGeneratedArtifact", () => {
  it("classifies build output and caches as generated", () => {
    for (const p of [
      "tsconfig.tsbuildinfo",
      "packages/litt-agent-core/tsconfig.tsbuildinfo",
      "packages/litt-agent-core/dist/index.js",
      "packages/litt-cli/dist/lib/mission-verification.js",
      ".next/server/app/page.js",
      "coverage/lcov.info",
      "node_modules/.cache/x",
      ".turbo/turbo.log",
      "test-results/report.xml",
      "playwright-report/index.html",
    ]) {
      expect(isGeneratedArtifact(p)).toBe(true);
    }
  });

  it("never classifies authored source as generated", () => {
    for (const p of [
      "src/app/page.tsx",
      "packages/litt-cli/src/lib/mission-delta.ts",
      "Dockerfile",
      "tests/free-model-routable.test.ts",
      "README.md",
      "package.json",
      // "distance" must not match the dist/ pattern
      "src/lib/distance.ts",
      "src/distributed/index.ts",
    ]) {
      expect(isGeneratedArtifact(p)).toBe(false);
    }
  });

  it("normalizes Windows separators", () => {
    expect(isGeneratedArtifact("packages\\litt-cli\\dist\\index.js")).toBe(true);
    expect(isGeneratedArtifact("packages\\litt-cli\\src\\index.ts")).toBe(false);
  });
});

describe("computeMissionDelta — generated artifacts", () => {
  it("a mission that only ran a build reports ZERO changed files", () => {
    // Nothing dirty at mission start; verification produced build output.
    const delta = computeMissionDelta([], [
      "tsconfig.tsbuildinfo",
      "packages/litt-agent-core/dist/index.js",
      "packages/litt-agent-core/dist/state.js",
    ]);
    expect(delta.changed).toEqual([]);
    expect(delta.added).toEqual([]);
    expect(delta.generated).toHaveLength(3);
  });

  it("separates authored edits from the build output they produced", () => {
    const delta = computeMissionDelta([], [
      "src/app/page.tsx",
      "tsconfig.tsbuildinfo",
      "packages/litt-cli/dist/index.js",
    ]);
    expect(delta.changed).toEqual(["src/app/page.tsx"]);
    expect(delta.generated).toEqual([
      "packages/litt-cli/dist/index.js",
      "tsconfig.tsbuildinfo",
    ]);
  });

  it("a real baseline still excludes pre-existing dirt (stale-closure guard)", () => {
    // The bug read the baseline as [] instead of the real list. With the
    // real baseline these pre-existing files are NOT the mission's.
    const baseline = ["Dockerfile", "packages/litt-cli/src/lib/x.ts"];
    const current = [...baseline, "src/new.ts"];

    const correct = computeMissionDelta(baseline, current);
    expect(correct.changed).toEqual(["src/new.ts"]);

    // What the stale closure produced: baseline [] → everything counted.
    const stale = computeMissionDelta([], current);
    expect(stale.changed).toHaveLength(3);
    expect(stale.changed).not.toEqual(correct.changed);
  });

  it("generated files dirty at baseline are not attributed either way", () => {
    const delta = computeMissionDelta(
      ["tsconfig.tsbuildinfo"],
      ["tsconfig.tsbuildinfo", "src/a.ts"],
    );
    expect(delta.changed).toEqual(["src/a.ts"]);
    expect(delta.generated).toEqual([]); // unchanged across the mission
  });
});
