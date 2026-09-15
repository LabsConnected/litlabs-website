import { describe, it, expect } from "vitest";
import {
  evaluateCompletion,
  requirementForMode,
  type ExecutionEvidence,
  type WorkspaceChangeEvidence,
} from "./completion-evidence";

/**
 * A completion verdict may never contradict the workspace.
 *
 * Before this, "nothing was changed" was derived entirely from tool success
 * flags. A tool that wrote bytes and then failed, or a run cancelled after a
 * write landed, produced state "failed" with the literal claim that nothing
 * had changed — while the user's file on disk had been rewritten.
 *
 * The pre-mutation checkpoint already gives a baseline, so the diff against
 * it is the authority. Tool flags describe what the model was TOLD happened;
 * only the diff describes what is actually persisted.
 */

const BUILD = requirementForMode("build");

function evidence(
  toolCalls: ExecutionEvidence["toolCalls"],
  workspaceChange?: WorkspaceChangeEvidence | null,
): ExecutionEvidence {
  return { toolCalls, workspaceChange };
}

const changed = (files: string[] = ["index.html"]): WorkspaceChangeEvidence => ({
  changed: true,
  files,
  checkpointSha: "abc1234",
  rollbackAvailable: true,
});

const unchanged: WorkspaceChangeEvidence = {
  changed: false,
  files: [],
  checkpointSha: "abc1234",
  rollbackAvailable: true,
};

describe("completion verdict vs. actual workspace state", () => {
  // 1. mutation succeeds, a later step fails → changes reported
  it("reports changes when a mutation landed and a later step failed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          { toolId: "files.write", mutating: true, success: true },
          { toolId: "project.build", mutating: false, success: false },
        ],
        changed(),
      ),
    );

    // A successful mutation exists, so this is not the no-mutation branch —
    // but the verdict must still never claim the workspace is untouched.
    expect(verdict.reason).not.toContain("nothing was changed");
  });

  // 2. mutation fails before any bytes change → no changes
  it("says the run failed BEFORE making changes when the diff is empty", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], unchanged),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChanged).toBe(false);
    expect(verdict.reason).toContain("failed before making changes");
  });

  // 3. the headline case: a failed mutation that still wrote bytes
  it("never claims nothing changed when the workspace differs", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChanged).toBe(true);
    expect(verdict.reason).not.toContain("nothing was changed");
    expect(verdict.reason).toContain("failed after making changes");
  });

  // 4. partial multi-file mutation
  it("reports partial changes when one file landed and another failed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [
          { toolId: "files.write", mutating: true, success: false },
          { toolId: "files.write", mutating: true, success: false },
        ],
        changed(["index.html"]),
      ),
    );

    expect(verdict.workspaceChanged).toBe(true);
    expect(verdict.changedFiles).toEqual(["index.html"]);
    expect(verdict.reason).toContain("index.html");
  });

  it("summarises by count when several files changed", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence(
        [{ toolId: "files.write", mutating: true, success: false }],
        changed(["index.html", "style.css", "app.js"]),
      ),
    );

    expect(verdict.changedFiles).toHaveLength(3);
    expect(verdict.reason).toContain("3 files");
  });

  // 5. cancelled after a mutation landed
  it("reports changes when a run was cancelled after a write", () => {
    const verdict = evaluateCompletion(
      BUILD,
      // Cancellation leaves the call with no result — absence of a result is
      // not success, and not proof the disk is untouched.
      evidence([{ toolId: "files.write", mutating: true, success: undefined }], changed()),
    );

    expect(verdict.workspaceChanged).toBe(true);
    expect(verdict.reason).not.toContain("nothing was changed");
  });

  // 6 & 7. the diff is the authority
  it("checkpoint diff empty → no changes", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], unchanged),
    );
    expect(verdict.workspaceChanged).toBe(false);
  });

  it("checkpoint diff non-empty → changes reported", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );
    expect(verdict.workspaceChanged).toBe(true);
  });

  // 8. the verdict may never contradict the diff
  it("no verdict contradicts the diff across the evidence matrix", () => {
    const flags: Array<boolean | undefined> = [true, false, undefined];
    for (const success of flags) {
      for (const change of [changed(), unchanged]) {
        const verdict = evaluateCompletion(
          BUILD,
          evidence([{ toolId: "files.write", mutating: true, success }], change),
        );
        if (change.changed) {
          expect(verdict.reason).not.toContain("nothing was changed");
          expect(verdict.reason).not.toContain("before making changes");
          expect(verdict.workspaceChanged).toBe(true);
        } else {
          expect(verdict.workspaceChanged).toBe(false);
        }
      }
    }
  });

  // Absence of evidence is not evidence of absence.
  it("does not assert the workspace is untouched when no diff was taken", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], null),
    );

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChanged).toBeUndefined();
    expect(verdict.reason).not.toContain("nothing was changed");
    expect(verdict.reason).not.toContain("before making changes");
  });

  it("carries checkpoint and rollback availability for the UI", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.checkpointSha).toBe("abc1234");
    expect(verdict.rollbackAvailable).toBe(true);
  });

  // No auto-rollback: the changes must survive for the user to inspect.
  it("reports rollback as available without implying it happened", () => {
    const verdict = evaluateCompletion(
      BUILD,
      evidence([{ toolId: "files.write", mutating: true, success: false }], changed()),
    );

    expect(verdict.rollbackAvailable).toBe(true);
    expect(verdict.reason).not.toMatch(/rolled back|reverted|restored/i);
  });

  it("still reports nothing changed when no mutation was even attempted", () => {
    const verdict = evaluateCompletion(BUILD, evidence([], unchanged));

    expect(verdict.state).toBe("not_started");
    expect(verdict.reason).toContain("nothing was changed");
  });
});
