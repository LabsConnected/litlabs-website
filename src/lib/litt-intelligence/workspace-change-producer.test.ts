import { describe, it, expect, vi } from "vitest";
import {
  computeWorkspaceChange,
  changedPathsFromStatus,
  pathsFromDiff,
  unquoteGitPath,
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

const probe = (
  impl: () => Promise<GitStatusResult>,
  diff = "",
) => ({
  gitStatus: vi.fn(impl),
  gitDiff: vi.fn(async () => ({ diff })),
});

/** A `git diff <sha>` for the given files — the baseline-diff shape the
 *  producer now reads the changed-file list from. */
const baseDiff = (...files: string[]) =>
  files
    .map(
      (f) =>
        `diff --git a/${f} b/${f}\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-old\n+new`,
    )
    .join("\n");

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
        baseDiff("index.html"),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
  });

  it("includes the real unified diff and line counts", async () => {
    const diff = "--- a/index.html\n+++ b/index.html\n-old\n+new\n+line";
    const result = await computeWorkspaceChange(
      probe(async () => status({ modified: [{ path: "index.html", status: "M" }], clean: false }), diff),
      CHECKPOINT,
    );

    expect(result.diff).toBe(diff);
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(1);
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
        baseDiff("index.html", "style.css"),
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
        baseDiff("old.html"),
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
        baseDiff("index.html"),
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
        baseDiff("index.html"),
      ),
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
  });

  // The diff runs against the BASELINE sha, not HEAD: work an intermediate
  // pre-mutation checkpoint already committed (clean HEAD status) still
  // counts — this is the "legitimate overwrite" case where a trailing
  // no-op mutation must not erase earlier real work.
  it("sees changes committed by later checkpoints — a clean HEAD status does not erase baseline diff evidence", async () => {
    const gitDiff = vi.fn(async (opts?: { base?: string }) => ({
      diff: opts?.base ? baseDiff("index.html") : "",
    }));
    const result = await computeWorkspaceChange(
      { gitStatus: vi.fn(async () => status({ clean: true })), gitDiff },
      CHECKPOINT,
    );

    expect(gitDiff).toHaveBeenCalledWith(expect.objectContaining({ base: "abc1234" }));
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
    expect(result.checkpointSha).toBe("abc1234");
  });

  it("reports unchanged when nothing differs from the baseline even though HEAD moved", async () => {
    // A write that netted out identical to the run's start state: the
    // baseline diff is empty, so "unchanged" is the honest verdict — a
    // HEAD-only view could not tell this apart from real work.
    const result = await computeWorkspaceChange(
      probe(async () => status({ clean: true })),
      CHECKPOINT,
    );

    expect(result.status).toBe("unchanged");
  });

  it("falls back to the status enumeration when the baseline diff fails", async () => {
    // An unreachable/invalid baseline SHA must not fabricate "unchanged":
    // the producer degrades to the HEAD-status evidence instead.
    const result = await computeWorkspaceChange(
      {
        gitStatus: vi.fn(async () =>
          status({ modified: [{ path: "index.html", status: "M" }], clean: false }),
        ),
        gitDiff: vi.fn(async () => {
          throw new Error("fatal: bad revision 'abc1234'");
        }),
      },
      CHECKPOINT,
    );

    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
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
        baseDiff("index.html"),
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

// ─── Quoted/escaped paths (core.quotePath) ──────────────────────────

describe("pathsFromDiff with core.quotePath headers", () => {
  // With default git settings a tracked non-ASCII filename is emitted
  // fully quoted: diff --git "a/caf\303\251.txt" "b/caf\303\251.txt".
  // The old header regex could not match it, so a real change produced
  // an empty baseFiles and reported "unchanged" (Greptile P1 #3).
  it("decodes octal-escaped UTF-8 filenames", () => {
    const diff = [
      'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"',
      '--- "a/caf\\303\\251.txt"',
      '+++ "b/caf\\303\\251.txt"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(pathsFromDiff(diff)).toEqual(["café.txt"]);
  });

  it("keeps plain headers working", () => {
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y";
    expect(pathsFromDiff(diff)).toEqual(["src/a.ts"]);
  });

  it("unescapes simple C escapes and backslashes", () => {
    expect(unquoteGitPath('"a\\\\b.txt"')).toBe("a\\b.txt");
    expect(unquoteGitPath('"say \\"hi\\".txt"')).toBe('say "hi".txt');
    expect(unquoteGitPath("plain.txt")).toBe("plain.txt");
  });
});
