/**
 * WorkstreamDock — comprehensive tests for the live operations view.
 *
 * Tests the evolved data model (objective, phase, nextAction, verification,
 * overallStatus), the normalization layer (toolKind, humanizeToolLabel,
 * groupConsecutive), and the dock renderer's row estimator.
 *
 * Runs in the CLI `node` env (no React renderer) for the pure logic,
 * and verifies the component module loads correctly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkstreamStore,
  MAX_ACTIVITIES,
  PHASE_DISPLAY,
  type WorkstreamPhase,
} from "../ink/workstream-store.js";
import {
  toolKind,
  toolPhase,
  humanizeToolLabel,
  shortenPath,
  shortenCommand,
  groupConsecutive,
} from "../ink/workstream-normalizer.js";
import {
  WorkstreamDock,
  estimateWorkstreamDockRows,
} from "../ink/workstream-dock.js";

// ─── Store data model tests ────────────────────────────────────────

describe("WorkstreamStore — evolved data model", () => {
  let store: WorkstreamStore;

  beforeEach(() => {
    store = new WorkstreamStore();
  });

  describe("objective", () => {
    it("starts null", () => {
      expect(store.snapshot().objective).toBeNull();
    });

    it("setObjective stores the text", () => {
      store.setObjective("Fix CLI backspace behavior");
      expect(store.snapshot().objective).toBe("Fix CLI backspace behavior");
    });

    it("setObjective transitions idle → running", () => {
      expect(store.snapshot().overallStatus).toBe("idle");
      store.setObjective("Fix a bug");
      expect(store.snapshot().overallStatus).toBe("running");
    });

    it("setObjective replaces previous value", () => {
      store.setObjective("First objective");
      store.setObjective("Second objective");
      expect(store.snapshot().objective).toBe("Second objective");
    });
  });

  describe("phase", () => {
    it("starts null", () => {
      expect(store.snapshot().phase).toBeNull();
    });

    it("setWorkstreamPhase sets the standardized phase", () => {
      store.setWorkstreamPhase("inspecting");
      expect(store.snapshot().phase).toBe("inspecting");
      expect(store.snapshot().currentPhase).toBe(PHASE_DISPLAY.inspecting);
    });

    it("setWorkstreamPhase transitions idle → running", () => {
      store.setWorkstreamPhase("editing");
      expect(store.snapshot().overallStatus).toBe("running");
    });
  });

  describe("nextAction", () => {
    it("starts null", () => {
      expect(store.snapshot().nextAction).toBeNull();
    });

    it("setNextAction stores the text", () => {
      store.setNextAction("Run full verification suite");
      expect(store.snapshot().nextAction).toBe("Run full verification suite");
    });

    it("setNextAction(null) clears it", () => {
      store.setNextAction("Do something");
      store.setNextAction(null);
      expect(store.snapshot().nextAction).toBeNull();
    });
  });

  describe("verification", () => {
    it("starts null", () => {
      expect(store.snapshot().verification).toBeNull();
    });

    it("startVerification creates checks with pending status", () => {
      store.startVerification(["TypeScript", "Tests", "Build"]);
      const v = store.snapshot().verification!;
      expect(v.status).toBe("running");
      expect(v.checks).toHaveLength(3);
      expect(v.checks.every((c) => c.status === "pending")).toBe(true);
    });

    it("updateVerificationCheck updates a check by label", () => {
      store.startVerification(["TypeScript", "Tests"]);
      store.updateVerificationCheck("TypeScript", "passed", "No errors");
      const v = store.snapshot().verification!;
      expect(v.checks[0].status).toBe("passed");
      expect(v.checks[0].detail).toBe("No errors");
      expect(v.status).toBe("running"); // not all passed yet
    });

    it("verification status becomes passed when all checks pass", () => {
      store.startVerification(["TypeScript", "Tests"]);
      store.updateVerificationCheck("TypeScript", "passed");
      store.updateVerificationCheck("Tests", "passed");
      expect(store.snapshot().verification!.status).toBe("passed");
    });

    it("verification status becomes failed when any check fails", () => {
      store.startVerification(["TypeScript", "Tests"]);
      store.updateVerificationCheck("TypeScript", "passed");
      store.updateVerificationCheck("Tests", "failed", "2 tests failed");
      expect(store.snapshot().verification!.status).toBe("failed");
    });

    it("clearVerification resets to null", () => {
      store.startVerification(["TypeScript"]);
      store.clearVerification();
      expect(store.snapshot().verification).toBeNull();
    });
  });

  describe("overallStatus", () => {
    it("starts idle", () => {
      expect(store.snapshot().overallStatus).toBe("idle");
    });

    it("setBlocked sets blocked status", () => {
      store.setBlocked();
      expect(store.snapshot().overallStatus).toBe("blocked");
      expect(store.snapshot().phase).toBe("blocked");
    });

    it("setComplete sets complete status", () => {
      store.setComplete();
      expect(store.snapshot().overallStatus).toBe("complete");
      expect(store.snapshot().phase).toBe("complete");
    });

    it("setFailed sets failed status", () => {
      store.setFailed();
      expect(store.snapshot().overallStatus).toBe("failed");
      expect(store.snapshot().phase).toBe("failed");
    });

    it("addSuccess sets complete status", () => {
      store.addSuccess("Done");
      expect(store.snapshot().overallStatus).toBe("complete");
    });

    it("begin() transitions idle → running", () => {
      store.begin("tool", "EXECUTING", "test");
      expect(store.snapshot().overallStatus).toBe("running");
    });

    it("clear() resets overallStatus to idle and all new fields", () => {
      store.setObjective("test");
      store.setWorkstreamPhase("editing");
      store.setNextAction("next");
      store.startVerification(["TypeScript"]);
      store.setComplete();
      store.clear();
      expect(store.snapshot().overallStatus).toBe("idle");
      expect(store.snapshot().objective).toBeNull();
      expect(store.snapshot().phase).toBeNull();
      expect(store.snapshot().nextAction).toBeNull();
      expect(store.snapshot().verification).toBeNull();
    });
  });

  describe("blocked != failed", () => {
    it("blocked and failed are distinct statuses", () => {
      store.setBlocked();
      expect(store.snapshot().overallStatus).toBe("blocked");
      store.clear();
      store.setFailed();
      expect(store.snapshot().overallStatus).toBe("failed");
      expect(store.snapshot().overallStatus).not.toBe("blocked");
    });
  });
});

// ─── Normalizer tests ──────────────────────────────────────────────

describe("WorkstreamNormalizer", () => {
  describe("toolKind", () => {
    it("maps read_file to inspect", () => {
      expect(toolKind("read_file")).toBe("inspect");
    });

    it("maps write_file to edit", () => {
      expect(toolKind("write_file")).toBe("edit");
    });

    it("maps run_command to command", () => {
      expect(toolKind("run_command")).toBe("command");
    });

    it("maps unknown tools to tool (fallback)", () => {
      expect(toolKind("unknown_tool")).toBe("tool");
    });
  });

  describe("toolPhase", () => {
    it("maps read_file to inspecting phase", () => {
      expect(toolPhase("read_file")).toBe("inspecting");
    });

    it("maps write_file to editing phase", () => {
      expect(toolPhase("write_file")).toBe("editing");
    });

    it("maps run_tests to testing phase", () => {
      expect(toolPhase("run_tests")).toBe("testing");
    });

    it("maps typecheck to verifying phase", () => {
      expect(toolPhase("typecheck")).toBe("verifying");
    });
  });

  describe("humanizeToolLabel", () => {
    it("extracts file path for read_file", () => {
      const label = humanizeToolLabel("read_file", { file: "src/input.ts" });
      expect(label).toBe("src/input.ts");
    });

    it("extracts file path for write_file", () => {
      const label = humanizeToolLabel("write_file", { path: "src/app.tsx" });
      expect(label).toBe("src/app.tsx");
    });

    it("returns generic label when no file path", () => {
      const label = humanizeToolLabel("read_file", {});
      expect(label).toBe("Inspecting");
    });

    it("returns generic label for unknown tools", () => {
      const label = humanizeToolLabel("custom_tool", {});
      expect(label).toBe("Custom Tool");
    });
  });

  describe("shortenPath", () => {
    it("keeps short paths as-is", () => {
      expect(shortenPath("src/input.ts")).toBe("src/input.ts");
    });

    it("shortens deep paths to last 2 segments", () => {
      expect(shortenPath("packages/litt-cli/src/ink/input.ts")).toBe(".../ink/input.ts");
    });
  });

  describe("shortenCommand", () => {
    it("strips pnpm prefix", () => {
      expect(shortenCommand("pnpm test")).toBe("test");
    });

    it("strips npx prefix", () => {
      expect(shortenCommand("npx tsc --noEmit")).toBe("tsc --noEmit");
    });
  });

  describe("groupConsecutive", () => {
    it("groups 3+ consecutive same-kind activities", () => {
      const activities = [
        { id: "1", kind: "inspect" as const, label: "a.ts", subject: "a.ts", status: "complete" as const },
        { id: "2", kind: "inspect" as const, label: "b.ts", subject: "b.ts", status: "complete" as const },
        { id: "3", kind: "inspect" as const, label: "c.ts", subject: "c.ts", status: "complete" as const },
        { id: "4", kind: "inspect" as const, label: "d.ts", subject: "d.ts", status: "complete" as const },
      ];
      const groups = groupConsecutive(activities);
      expect(groups).toHaveLength(1);
      expect(groups[0].count).toBe(4);
      expect(groups[0].label).toContain("4 files");
    });

    it("does not group 2 or fewer consecutive activities", () => {
      const activities = [
        { id: "1", kind: "inspect" as const, label: "a.ts", subject: "a.ts", status: "complete" as const },
        { id: "2", kind: "inspect" as const, label: "b.ts", subject: "b.ts", status: "complete" as const },
      ];
      const groups = groupConsecutive(activities);
      expect(groups).toHaveLength(2);
    });

    it("does not group non-groupable kinds (tool, reason, etc.)", () => {
      const activities = [
        { id: "1", kind: "tool" as const, label: "lint", status: "complete" as const },
        { id: "2", kind: "tool" as const, label: "build", status: "complete" as const },
        { id: "3", kind: "tool" as const, label: "test", status: "complete" as const },
      ];
      const groups = groupConsecutive(activities);
      expect(groups).toHaveLength(3);
    });

    it("resets grouping when kind changes", () => {
      const activities = [
        { id: "1", kind: "inspect" as const, label: "a.ts", subject: "a.ts", status: "complete" as const },
        { id: "2", kind: "inspect" as const, label: "b.ts", subject: "b.ts", status: "complete" as const },
        { id: "3", kind: "inspect" as const, label: "c.ts", subject: "c.ts", status: "complete" as const },
        { id: "4", kind: "edit" as const, label: "d.ts", subject: "d.ts", status: "complete" as const },
        { id: "5", kind: "edit" as const, label: "e.ts", subject: "e.ts", status: "complete" as const },
        { id: "6", kind: "edit" as const, label: "f.ts", subject: "f.ts", status: "complete" as const },
      ];
      const groups = groupConsecutive(activities);
      expect(groups).toHaveLength(2);
      expect(groups[0].count).toBe(3);
      expect(groups[0].kind).toBe("inspect");
      expect(groups[1].count).toBe(3);
      expect(groups[1].kind).toBe("edit");
    });
  });
});

// ─── Dock component import + row estimator tests ───────────────────

describe("WorkstreamDock — module + row estimator", () => {
  it("WorkstreamDock is a valid function component", () => {
    expect(typeof WorkstreamDock).toBe("function");
  });

  it("estimateWorkstreamDockRows is a function", () => {
    expect(typeof estimateWorkstreamDockRows).toBe("function");
  });

  it("returns compact count for complete status", () => {
    const store = new WorkstreamStore();
    store.setObjective("Done");
    store.setComplete();
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(4);
  });

  it("returns compact count for failed status", () => {
    const store = new WorkstreamStore();
    store.setObjective("Failed");
    store.setFailed();
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(5);
  });

  it("returns compact count for blocked status", () => {
    const store = new WorkstreamStore();
    store.setObjective("Blocked");
    store.setBlocked();
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(4);
  });

  it("counts running dock rows including header + activities", () => {
    const store = new WorkstreamStore();
    store.setObjective("Fix a bug");
    store.setWorkstreamPhase("inspecting");
    store.addInspect("a.ts");
    store.addInspect("b.ts");
    store.addInspect("c.ts");
    store.addInspect("d.ts");
    const rows = estimateWorkstreamDockRows(store.snapshot());
    expect(rows).toBeGreaterThan(2); // header + activities
  });

  it("counts verification block rows", () => {
    const store = new WorkstreamStore();
    store.setObjective("Fix a bug");
    store.startVerification(["TypeScript", "Tests", "Build"]);
    const rows = estimateWorkstreamDockRows(store.snapshot());
    expect(rows).toBeGreaterThan(5); // header + verification header + 3 checks
  });

  it("counts next action row", () => {
    const store = new WorkstreamStore();
    store.setObjective("Fix a bug");
    store.setWorkstreamPhase("editing");
    store.setNextAction("Run verification");
    const rows = estimateWorkstreamDockRows(store.snapshot());
    expect(rows).toBeGreaterThanOrEqual(3); // header + next
  });
});

// ─── Phase display labels ──────────────────────────────────────────

describe("PHASE_DISPLAY labels", () => {
  it("has labels for all phases", () => {
    const phases: WorkstreamPhase[] = [
      "understanding", "inspecting", "planning", "editing",
      "running", "testing", "verifying", "deploying",
      "syncing", "complete", "blocked", "failed",
    ];
    for (const p of phases) {
      expect(PHASE_DISPLAY[p]).toBeTruthy();
      expect(PHASE_DISPLAY[p].length).toBeGreaterThan(0);
    }
  });

  it("uses uppercase for display", () => {
    expect(PHASE_DISPLAY.understanding).toBe("UNDERSTANDING");
    expect(PHASE_DISPLAY.inspecting).toBe("INSPECTING");
    expect(PHASE_DISPLAY.verifying).toBe("VERIFYING");
  });
});

// ─── Integration: store → normalizer → dock ────────────────────────

describe("Integration: store → normalizer → dock", () => {
  it("simulates a full mission lifecycle", () => {
    const store = new WorkstreamStore();

    // 1. User asks to fix a bug
    store.setObjective("Fix CLI backspace behavior");
    store.setWorkstreamPhase("understanding");
    expect(store.snapshot().overallStatus).toBe("running");
    expect(store.snapshot().phase).toBe("understanding");

    // 2. LiTT inspects files
    store.setWorkstreamPhase("inspecting");
    store.addInspect("src/input.ts");
    store.addInspect("src/app.tsx");
    store.addInspect("src/composer.ts");
    expect(store.snapshot().activities.length).toBe(3);

    // 3. LiTT edits
    store.setWorkstreamPhase("editing");
    store.addEdit("src/input.ts", 5, 3);
    expect(store.snapshot().phase).toBe("editing");

    // 4. LiTT runs tests
    store.setWorkstreamPhase("testing");
    store.addTest("input.test.ts", 26, 0, 0);

    // 5. LiTT verifies
    store.setWorkstreamPhase("verifying");
    store.startVerification(["TypeScript", "Tests"]);
    store.updateVerificationCheck("TypeScript", "passed", "No errors");
    store.updateVerificationCheck("Tests", "passed", "26 passed");
    expect(store.snapshot().verification!.status).toBe("passed");

    // 6. Complete
    store.setComplete();
    expect(store.snapshot().overallStatus).toBe("complete");
    expect(store.snapshot().phase).toBe("complete");

    // Row estimator should return compact count
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(4);
  });

  it("simulates a failed mission", () => {
    const store = new WorkstreamStore();

    store.setObjective("Fix a bug");
    store.setWorkstreamPhase("editing");
    const id = store.begin("edit", "EDITING", "src/input.ts", "src/input.ts");
    store.fail(id, "Expected text was not found");
    store.setFailed();

    expect(store.snapshot().overallStatus).toBe("failed");
    expect(store.snapshot().phase).toBe("failed");
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(5);
  });

  it("simulates a blocked mission", () => {
    const store = new WorkstreamStore();

    store.setObjective("Deploy to production");
    store.setWorkstreamPhase("deploying");
    store.setBlocked();

    expect(store.snapshot().overallStatus).toBe("blocked");
    expect(store.snapshot().phase).toBe("blocked");
    expect(estimateWorkstreamDockRows(store.snapshot())).toBe(4);
  });
});
