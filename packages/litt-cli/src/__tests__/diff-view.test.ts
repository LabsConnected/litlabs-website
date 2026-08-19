/**
 * DiffView tests — pure diff parsing + commit message suggestion.
 * Runs against the real repo cwd (git is available).
 */

import { describe, expect, it } from "vitest";
import {
  parseNumstat, parseNameStatus, countChangedLines,
  getDiffData, suggestCommitMessage,
} from "../lib/diff-view.js";

describe("diff-view", () => {
  it("parses numstat lines into entries", () => {
    const files = parseNumstat("12\t4\tsrc/a.ts\n0\t8\tsrc/b.ts\n-\t-\tsrc/binary.png\n");
    expect(files).toHaveLength(3);
    expect(files[0]).toMatchObject({ path: "src/a.ts", additions: 12, deletions: 4 });
    expect(files[1]).toMatchObject({ path: "src/b.ts", additions: 0, deletions: 8 });
    expect(files[2]).toMatchObject({ path: "src/binary.png", additions: 0, deletions: 0 });
  });

  it("parses name-status into a path→status map", () => {
    const map = parseNameStatus("M\tsrc/a.ts\nA\tsrc/new.ts\nD\tsrc/old.ts\nR100\tsrc/x.ts\tsrc/y.ts\n");
    expect(map.get("src/a.ts")).toBe("M");
    expect(map.get("src/new.ts")).toBe("A");
    expect(map.get("src/old.ts")).toBe("D");
    expect(map.get("src/y.ts")).toBe("R");
    expect(map.get("src/x.ts")).toBeUndefined();
  });

  it("counts added/removed lines from a raw diff", () => {
    const diff = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -1,3 +1,4 @@",
      " context",
      "+added",
      "-removed",
      "+++ not a count",
      "--- not a count",
    ].join("\n");
    const { added, removed } = countChangedLines(diff);
    expect(added).toBe(1);
    expect(removed).toBe(1);
  });

  it("getDiffData returns entries + raw diff for the repo", () => {
    const data = getDiffData(process.cwd());
    expect(Array.isArray(data.files)).toBe(true);
    expect(typeof data.raw).toBe("string");
  });

  it("suggestCommitMessage inherits the last commit's type/scope", () => {
    const msg = suggestCommitMessage(process.cwd(), [
      { path: "src/ink/app.tsx", status: "M", additions: 5, deletions: 1 },
      { path: "src/ink/controller.ts", status: "M", additions: 2, deletions: 2 },
    ]);
    expect(msg).toMatch(/^(feat|fix|chore|refactor|docs|test|perf|build|ci|style)(\([^)]+\))?: app and 1 more$/);
  });

  it("suggestCommitMessage handles a single new file", () => {
    const msg = suggestCommitMessage(process.cwd(), [
      { path: "packages/litt-cli/src/lib/new-util.ts", status: "A", additions: 40, deletions: 0 },
    ]);
    expect(msg).toMatch(/: new util$/);
  });

  it("suggestCommitMessage falls back gracefully with no files", () => {
    const msg = suggestCommitMessage(process.cwd(), []);
    expect(msg).toMatch(/^[a-z]+\([^)]+\): update$/);
  });
});
