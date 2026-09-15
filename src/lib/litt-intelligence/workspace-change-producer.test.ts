import { describe, it, expect, vi } from "vitest";
import {
  computeWorkspaceChange,
  changedPathsFromStatus,
} from "./workspace-change-producer";
import { evaluateCompletion, requirementForMode } from "@/lib/studio/completion-evidence";
import type { GitStatusResult, CheckpointInfo } from "./workspace-transport";

/**
 * The producer answers "are my files different now?" from the workspace
 * itself, not from tool success flags.
 *
 * The critical property is that a failure to look NEVER becomes "unchanged".
 */

const CHECKPOINT: CheckpointInfo = {
  checkpointId: "cp_1",
  label: "Pre-agent-loop: fix the footer",
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

const probe = (impl: () => Promise<GitStatusResult>) => ({ gitStatus: vi.fn(impl) });

describe("computeWorkspaceChange", () => {
  // 1. checkpoint + empty diff → no changes
  it("reports unchanged when the diff is empty", async () => {
    const result = await computeWorkspaceChange(
      probe(async () => status({ clean: true })),
      CHECKPOINT,
    );

    expect(result.status).toBe("unchanged");
    expect(result.files).toEqual([]);
    expect(result.checkpointSha).toBe("abc1234");
  });

  // 2. checkpoint + one modified file → changes + filename
  it("reports the modified file by name", async () => {
    const result = await computeWorkspaceChange(
      probe(async () =>
        status({ modified: [{ path: "index.html", status: "M" }], clean: false }),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
  });

  // 3. multiple files → full evidence
  it("reports every changed path, deduped and sorted", async () => {
    const result = await computeWorkspaceChange(
      probe(async () =>
        status({
          staged: [{ path: "style.css", status: "M" }],
          modified: [
            { path: "index.html", status: "M" },
            { path: "style.css", status: "M" },
          ],
          untracked: ["app.js"],
          clean: false,
        }),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["app.js", "index.html", "style.css"]);
  });

  // 4. created file → detected (git reports it as untracked)
  it("detects a newly created file", async () => {
    const result = await computeWorkspaceChange(
      probe(async () => status({ untracked: ["about.html"], clean: false })),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["about.html"]);
  });

  // 5. deleted file → detected (git reports it as modified with status D)
  it("detects a deleted file", async () => {
    const result = await computeWorkspaceChange(
      probe(async () =>
        status({ modified: [{ path: "old.html", status: "D" }], clean: false }),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["old.html"]);
  });

  // 6. cancelled after a mutation → still detected, because the producer
  //    reads the workspace rather than the run's own bookkeeping
  it("detects a change left behind by a cancelled run", async () => {
    const result = await computeWorkspaceChange(
      probe(async () =>
        status({ modified: [{ path: "index.html", status: "M" }], clean: false }),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
  });

  // 7. diff command fails → unknown, never a false "nothing changed"
  it("reports unknown when the status command throws", async () => {
    const result = await computeWorkspaceChange(
      probe(async () => {
        throw new Error("git exited 128");
      }),
      CHECKPOINT,
    );

    expect(result.status).toBe("unknown");
    expect(result.status).not.toBe("unchanged");
    expect(result.unknownReason).toContain("git exited 128");
    // The checkpoint is still reported so a rollback remains reachable.
    expect(result.checkpointSha).toBe("abc1234");
    expect(result.rollbackAvailable).toBe(true);
  });

  // 8. workspace unavailable → unknown
  it("reports unknown when the workspace is unreachable", async () => {
    const result = await computeWorkspaceChange(null, CHECKPOINT);

    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toMatch(/not reachable/i);
  });

  // 9. checkpoint missing → unknown
  it("reports unknown when there is no checkpoint to compare against", async () => {
    const result = await computeWorkspaceChange(
      probe(async () => status()),
      null,
    );

    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toMatch(/checkpoint/i);
  });

  it("reports unknown when the checkpoint has no git sha", async () => {
    const result = await computeWorkspaceChange(
      probe(async () => status()),
      { checkpointId: "cp", label: "l", gitSha: "" },
    );

    expect(result.status).toBe("unknown");
  });

  it("reports unknown when the status payload is unusable", async () => {
    const result = await computeWorkspaceChange(
      { gitStatus: vi.fn(async () => null as unknown as GitStatusResult) },
      CHECKPOINT,
    );

    expect(result.status).toBe("unknown");
  });

  // A named changed path outweighs a stale `clean: true` summary flag.
  it("trusts an enumerated path over a contradicting clean flag", async () => {
    const result = await computeWorkspaceChange(
      probe(async () =>
        status({ modified: [{ path: "index.html", status: "M" }], clean: true }),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
  });

  it("never auto-rolls-back — it only reports that rollback is possible", async () => {
    const gitStatus = vi.fn(async () =>
      status({ modified: [{ path: "index.html", status: "M" }], clean: false }),
    );
    const result = await computeWorkspaceChange({ gitStatus }, CHECKPOINT);

    expect(result.rollbackAvailable).toBe(true);
    // gitStatus is the only call made — nothing mutating, nothing restored.
    expect(gitStatus).toHaveBeenCalledTimes(1);
  });
});

describe("changedPathsFromStatus", () => {
  it("returns an empty list for a clean tree", () => {
    expect(changedPathsFromStatus(status())).toEqual([]);
  });

  it("tolerates missing arrays", () => {
    const partial = { branch: "main", ahead: 0, behind: 0, clean: true } as GitStatusResult;
    expect(changedPathsFromStatus(partial)).toEqual([]);
  });
});

/**
 * 10. The completion evidence consumes the real producer output — the two
 * halves must agree end to end, not just in isolation.
 */
describe("producer → completion evidence", () => {
  const BUILD = requirementForMode("build");

  it("a failed run that wrote bytes is reported as having made changes", async () => {
    const workspaceChange = await computeWorkspaceChange(
      probe(async () =>
        status({ modified: [{ path: "index.html", status: "M" }], clean: false }),
      ),
      CHECKPOINT,
    );

    const verdict = evaluateCompletion(BUILD, {
      // The mutation tool reported failure, yet the bytes changed — the
      // exact false-negative this whole path exists to prevent.
      toolCalls: [{ toolId: "files.write", mutating: true, success: false }],
      workspaceChange,
    });

    expect(verdict.state).toBe("failed");
    expect(verdict.workspaceChange).toBe("changed");
    expect(verdict.changedFiles).toEqual(["index.html"]);
    expect(verdict.reason).toContain("failed after making changes");
    expect(verdict.reason).toContain("index.html");
    expect(verdict.reason).not.toContain("nothing was changed");
  });

  it("a failed run that wrote nothing is reported as having made none", async () => {
    const workspaceChange = await computeWorkspaceChange(
      probe(async () => status({ clean: true })),
      CHECKPOINT,
    );

    const verdict = evaluateCompletion(BUILD, {
      toolCalls: [{ toolId: "files.write", mutating: true, success: false }],
      workspaceChange,
    });

    expect(verdict.workspaceChange).toBe("unchanged");
    expect(verdict.reason).toContain("failed before making changes");
  });

  it("an unverifiable workspace never becomes a no-change claim", async () => {
    const workspaceChange = await computeWorkspaceChange(
      probe(async () => {
        throw new Error("workspace gone");
      }),
      CHECKPOINT,
    );

    const verdict = evaluateCompletion(BUILD, {
      toolCalls: [{ toolId: "files.write", mutating: true, success: false }],
      workspaceChange,
    });

    expect(verdict.workspaceChange).toBe("unknown");
    expect(verdict.reason).not.toContain("nothing was changed");
    expect(verdict.reason).not.toContain("before making changes");
    expect(verdict.reason).not.toContain("after making changes");
  });
});
