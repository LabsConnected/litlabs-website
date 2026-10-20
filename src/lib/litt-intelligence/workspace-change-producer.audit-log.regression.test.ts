// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeWorkspaceChange } from "./workspace-change-producer";
import type { GitStatusResult, CheckpointInfo } from "./workspace-transport";

/**
 * Regression tests — the verdict computation is audible (Repair R3,
 * Diagnosis E4-S7/R2).
 *
 * The defect: computeWorkspaceChange contained ZERO log calls. A run
 * could compute (or fail to compute) a verdict and deployment stdout
 * said nothing — the Phase 3 acceptance run produced no verdict and
 * there was no log line to distinguish "computed: unknown" from "never
 * ran". Every computation now emits ONE structured line carrying the
 * checkpoint id, the verdict, and the changed-file count (ids and
 * outcomes only — never file contents or inputs).
 */

const CHECKPOINT: CheckpointInfo = {
  checkpointId: "cp_1",
  label: "Pre-agent-loop: build the site",
  gitSha: "abc1234",
};

function status(partial: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
    clean: true,
    ...partial,
  };
}

function loggedEntries(spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
}

describe("computeWorkspaceChange — audit log (R3/E4-R2)", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("logs checkpoint id, verdict, and file count for a changed verdict", async () => {
    const probe = {
      gitStatus: vi.fn(async () =>
        status({ modified: [{ path: "index.html", status: "M" }], clean: false })),
      gitDiff: vi.fn(async () => ({ diff: "" })),
    };

    const result = await computeWorkspaceChange(probe as never, CHECKPOINT);
    expect(result.status).toBe("changed");

    const entry = loggedEntries(consoleSpy).find((e) => e.message === "workspace_change:computed");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      checkpointId: "cp_1",
      verdict: "changed",
      fileCount: 1,
    });
  });

  it("logs an unknown verdict too — silence is the defect, not the outcome", async () => {
    const result = await computeWorkspaceChange(null, null);
    expect(result.status).toBe("unknown");

    const entry = loggedEntries(consoleSpy).find((e) => e.message === "workspace_change:computed");
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({ verdict: "unknown", fileCount: 0 });
  });
});
