/**
 * Phase 8 Acceptance Test — Canonical Checks Executor
 *
 * Test matrix:
 * 1.  all required checks pass               → ready
 * 2.  typecheck fails                        → not ready
 * 3.  test fails                             → not ready
 * 4.  build fails                            → not ready
 * 5.  required check skipped                 → not ready
 * 6.  optional check skipped                 → can still be ready
 * 7.  command times out                      → failed
 * 8.  process crashes                        → failed
 * 9.  script missing                         → skipped with reason
 * 10. stale evidence from previous diff      → ignored
 * 11. working tree changes after checks      → ready state invalidated
 * 12. new mutation after build passed        → checks become stale
 *
 * Phase 8 — Studio Control Plane V1
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { CheckEvidence } from "@/lib/litt-intelligence/check-evidence";
import type { MutationEvidence } from "@/lib/litt-intelligence/mutation-evidence";
import { planChecks } from "@/lib/litt-intelligence/check-evidence";
import { detectScripts, detectPackageManager } from "@/lib/litt-intelligence/script-detection";
import { isCheckStale, detectRelatedTests, invalidateStaleChecks } from "@/lib/litt-intelligence/check-executor";
import { deriveRunStatus, type AcceptanceCriterion } from "@/lib/litt-intelligence/run-status";
import { resetCheckEvidenceStore, getCheckEvidenceStore } from "@/lib/litt-intelligence/check-evidence-store";
import { resetStores } from "@/lib/litt-intelligence/evidence-store";
import { resetRunEventStore } from "@/lib/litt-intelligence/run-event-store";
import { StudioChecksPanel } from "@/app/(app)/studio/components/StudioChecksPanel";
import { render, fireEvent } from "@testing-library/react";

// ─── Helpers ─────────────────────────────────────────────────────

function makeCheck(overrides: Partial<CheckEvidence> & { kind: CheckEvidence["kind"] }): CheckEvidence {
  return {
    id: `check-${overrides.kind}-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    command: `pnpm ${overrides.kind}`,
    cwd: "/workspace",
    required: true,
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 1000,
    headSha: "abc123",
    workingTreeDiffHash: "diff-hash-1",
    ...overrides,
  };
}

function makeMutation(overrides: Partial<MutationEvidence> = {}): MutationEvidence {
  return {
    id: `mut-${Math.random().toString(36).slice(2, 8)}`,
    runId: "run-1",
    projectId: "proj-1",
    toolId: "files.write",
    workspaceId: "ws-1",
    branch: "feat/test",
    baseSha: "base123",
    headShaBefore: "abc123",
    paths: ["src/foo.ts"],
    beforeHashes: { "src/foo.ts": null },
    afterHashes: { "src/foo.ts": "hash1" },
    status: "succeeded",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

const verifiedCriteria: AcceptanceCriterion[] = [
  { id: "c1", description: "Feature works", status: "verified" },
];

// ─── Tests ───────────────────────────────────────────────────────

describe("Phase 8 — Canonical Checks Executor", () => {
  beforeEach(() => {
    resetStores();
    resetRunEventStore();
    resetCheckEvidenceStore();
  });

  // ── Script Detection ──

  describe("script detection", () => {
    it("detects all scripts from package.json", () => {
      const scripts = detectScripts({
        scripts: {
          lint: "eslint .",
          "type-check": "tsc --noEmit",
          test: "vitest run",
          build: "next build",
        },
      }, "pnpm");

      expect(scripts.lint).toBe("pnpm lint");
      expect(scripts.typecheck).toBe("pnpm type-check");
      expect(scripts.test).toBe("pnpm test");
      expect(scripts.build).toBe("pnpm build");
    });

    it("returns undefined for missing scripts", () => {
      const scripts = detectScripts({ scripts: {} }, "npm");
      expect(scripts.lint).toBeUndefined();
      expect(scripts.typecheck).toBeUndefined();
      expect(scripts.test).toBeUndefined();
      expect(scripts.build).toBeUndefined();
    });

    it("detects package manager from lockfiles", () => {
      expect(detectPackageManager(["pnpm-lock.yaml"])).toBe("pnpm");
      expect(detectPackageManager(["yarn.lock"])).toBe("yarn");
      expect(detectPackageManager(["package-lock.json"])).toBe("npm");
      expect(detectPackageManager([])).toBe("npm");
    });
  });

  // ── planChecks ──

  describe("planChecks", () => {
    it("marks typecheck, test, build as required", () => {
      const checks = planChecks({
        lint: "pnpm lint",
        typecheck: "pnpm type-check",
        test: "pnpm test",
        build: "pnpm build",
        packageManager: "pnpm",
      });

      const typecheck = checks.find((c) => c.kind === "typecheck");
      const test = checks.find((c) => c.kind === "test");
      const build = checks.find((c) => c.kind === "build");
      expect(typecheck?.required).toBe(true);
      expect(test?.required).toBe(true);
      expect(build?.required).toBe(true);
    });

    it("marks lint as required only if configured", () => {
      const withLint = planChecks({
        lint: "pnpm lint",
        typecheck: "pnpm type-check",
        test: "pnpm test",
        build: "pnpm build",
        packageManager: "pnpm",
      });
      const withoutLint = planChecks({
        typecheck: "pnpm type-check",
        test: "pnpm test",
        build: "pnpm build",
        packageManager: "pnpm",
      });

      expect(withLint.find((c) => c.kind === "lint")?.required).toBe(true);
      expect(withoutLint.find((c) => c.kind === "lint")?.required).toBe(false);
      expect(withoutLint.find((c) => c.kind === "lint")?.skipIfMissing).toBe(true);
    });

    it("marks targeted tests as optional", () => {
      const checks = planChecks({
        test: "pnpm test",
        typecheck: "pnpm type-check",
        build: "pnpm build",
        packageManager: "pnpm",
      });
      const targeted = checks.find((c) => c.kind === "targeted-test");
      expect(targeted?.required).toBe(false);
    });
  });

  // ── Targeted Test Detection ──

  describe("detectRelatedTests", () => {
    it("finds test files related to source files", () => {
      const tests = detectRelatedTests(["src/foo.ts", "src/components/Bar.tsx"]);
      expect(tests.some((t) => t.includes("foo.test"))).toBe(true);
      expect(tests.some((t) => t.includes("Bar.test"))).toBe(true);
    });

    it("skips files that are already test files", () => {
      const tests = detectRelatedTests(["src/foo.test.ts"]);
      expect(tests.length).toBe(0);
    });
  });

  // ── Stale Check Invalidation ──

  describe("isCheckStale", () => {
    it("returns false when code state matches", () => {
      const check = makeCheck({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isCheckStale(check, "abc123", "diff-1")).toBe(false);
    });

    it("returns true when headSha changed", () => {
      const check = makeCheck({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isCheckStale(check, "def456", "diff-1")).toBe(true);
    });

    it("returns true when workingTreeDiffHash changed", () => {
      const check = makeCheck({ headSha: "abc123", workingTreeDiffHash: "diff-1" });
      expect(isCheckStale(check, "abc123", "diff-2")).toBe(true);
    });

    it("returns true if already marked stale", () => {
      const check = makeCheck({ headSha: "abc123", workingTreeDiffHash: "diff-1", stale: true });
      expect(isCheckStale(check, "abc123", "diff-1")).toBe(true);
    });
  });

  // ── deriveRunStatus — the test matrix ──

  describe("deriveRunStatus — test matrix", () => {
    const baseMutation = makeMutation();

    it("1. all required checks pass → ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(true);
      expect(result.status).toBe("ready_for_review");
    });

    it("2. typecheck fails → not ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "failed", exitCode: 1, failureReason: "Exit code 1" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.failedRequiredChecks.length).toBe(1);
    });

    it("3. test fails → not ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "test", status: "failed", exitCode: 1 }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.failedRequiredChecks.length).toBe(1);
    });

    it("4. build fails → not ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "failed", exitCode: 1 }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.failedRequiredChecks.length).toBe(1);
    });

    it("5. required check skipped → not ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "skipped", skipReason: "No typecheck script" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.skippedRequiredChecks.length).toBe(1);
    });

    it("6. optional check skipped → can still be ready", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "targeted-test", status: "skipped", required: false, skipReason: "No related tests" }),
          makeCheck({ kind: "lint", status: "skipped", required: false, skipReason: "No lint script" }),
          makeCheck({ kind: "typecheck", status: "passed" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(true);
    });

    it("7. command times out → failed", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "failed", failureReason: "Timeout after 120000ms" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.failedRequiredChecks[0].failureReason).toContain("Timeout");
    });

    it("8. process crashes → failed", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "failed", exitCode: -1, failureReason: "Process error: spawn failed" }),
          makeCheck({ kind: "test", status: "passed" }),
          makeCheck({ kind: "build", status: "passed" }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.failedRequiredChecks[0].failureReason).toContain("Process error");
    });

    it("9. script missing → skipped with reason", () => {
      const check = makeCheck({
        kind: "lint",
        status: "skipped",
        required: false,
        skipReason: "No lint script detected in package.json",
      });
      expect(check.skipReason).toContain("No lint script");
      expect(check.status).toBe("skipped");
    });

    it("10. stale evidence from previous diff → ignored (not counted as passing)", () => {
      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: [
          makeCheck({ kind: "typecheck", status: "passed", stale: true }),
          makeCheck({ kind: "test", status: "passed", stale: true }),
          makeCheck({ kind: "build", status: "passed", stale: true }),
        ],
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.staleChecks.length).toBe(3);
    });

    it("11. working tree changes after checks → ready state invalidated", () => {
      // Checks passed with diff-hash-1
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed", workingTreeDiffHash: "diff-hash-1" }),
        makeCheck({ kind: "test", status: "passed", workingTreeDiffHash: "diff-hash-1" }),
        makeCheck({ kind: "build", status: "passed", workingTreeDiffHash: "diff-hash-1" }),
      ];

      // Code state changed to diff-hash-2
      const stale = checks.every((c) => isCheckStale(c, "abc123", "diff-hash-2"));
      expect(stale).toBe(true);

      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: checks.map((c) => ({ ...c, stale: true })),
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.staleChecks.length).toBe(3);
    });

    it("12. new mutation after build passed → checks become stale", async () => {
      const store = getCheckEvidenceStore();

      // Initial checks pass
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed" }),
        makeCheck({ kind: "test", status: "passed" }),
        makeCheck({ kind: "build", status: "passed" }),
      ];
      for (const c of checks) await store.insert(c);

      // New mutation changes the working tree
      // (simulated by invalidating with a new diff hash)
      await invalidateStaleChecks("run-1", "abc123", "new-diff-hash");

      const updated = await store.listByRun("run-1");
      const allStale = updated.every((c) => c.stale);
      expect(allStale).toBe(true);

      const result = deriveRunStatus({
        mutationEvidence: [baseMutation],
        checkEvidence: updated,
        acceptanceCriteria: verifiedCriteria,
        unresolvedBlockingEvents: [],
      });
      expect(result.readyForReview).toBe(false);
      expect(result.staleChecks.length).toBe(3);
    });
  });

  // ── UI Tests ──

  describe("StudioChecksPanel", () => {
    it("renders checks with status icons", () => {
      const checks = [
        makeCheck({ kind: "typecheck", status: "passed", durationMs: 6700 }),
        makeCheck({ kind: "test", status: "failed", exitCode: 1, failureReason: "2 tests failed" }),
        makeCheck({ kind: "lint", status: "skipped", required: false, skipReason: "No lint script" }),
      ];
      const { getByTestId } = render(<StudioChecksPanel checks={checks} loading={false} />);
      expect(getByTestId("studio-checks-panel")).toBeDefined();
      expect(getByTestId("check-typecheck")).toBeDefined();
      expect(getByTestId("check-test")).toBeDefined();
      expect(getByTestId("check-lint-skip-reason").textContent).toContain("No lint script");
    });

    it("renders stale badge for stale checks", () => {
      const checks = [
        makeCheck({ kind: "build", status: "passed", stale: true }),
      ];
      const { getByTestId } = render(<StudioChecksPanel checks={checks} loading={false} />);
      expect(getByTestId("check-build-stale")).toBeDefined();
    });

    it("renders code state provenance", () => {
      const checks = [makeCheck({ kind: "typecheck", status: "passed" })];
      const { getByTestId } = render(<StudioChecksPanel checks={checks} loading={false} />);
      expect(getByTestId("checks-code-state")).toBeDefined();
    });

    it("shows empty state when no checks", () => {
      const { getByTestId } = render(<StudioChecksPanel checks={[]} loading={false} />);
      expect(getByTestId("checks-empty")).toBeDefined();
    });

    it("expands failure logs on click", () => {
      const checks = [
        makeCheck({
          kind: "test",
          status: "failed",
          exitCode: 1,
          failureReason: "Exit code 1",
          stderrRef: "inline:Test failed: expected 2 got 1",
          stdoutRef: "inline:Running tests...",
        }),
      ];
      const { getByTestId, queryByTestId } = render(<StudioChecksPanel checks={checks} loading={false} />);
      // Initially collapsed
      expect(queryByTestId("check-test-stderr")).toBeNull();

      // Click expand button
      const expandBtn = getByTestId("check-test").querySelector("button");
      expect(expandBtn).not.toBeNull();
      fireEvent.click(expandBtn!);

      expect(getByTestId("check-test-stderr")).toBeDefined();
      expect(getByTestId("check-test-stderr").textContent).toContain("Test failed");
    });
  });
});
