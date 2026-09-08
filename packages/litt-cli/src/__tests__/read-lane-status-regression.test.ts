import { describe, expect, it } from "vitest";
import {
  formatDeterministicReadAnswer,
  matchReadTools,
  type ReadToolResult,
} from "../lib/read-lane.js";

describe("git status READ lane regression", () => {
  it.each([
    "Check the git status.",
    "Check the current git status.",
    "Check the current git status and tell me what changed.",
    "What files changed?",
  ])("maps %j to one deterministic project.status read", (input) => {
    const match = matchReadTools(input);

    expect(match).not.toBeNull();
    expect(match!.calls).toHaveLength(1);
    expect(match!.calls[0].toolId).toBe("project.status");
    expect(match!.needsSynthesis).toBe(false);
  });

  it("formats exact tracked and untracked filenames", () => {
    const result = formatDeterministicReadAnswer([
      {
        toolId: "project.status",
        label: "Get git status",
        ms: 1,
        result: {
          success: true,
          message: "Repository has changes",
          data: {
            branch: "fix/litt-agent-identity-tui",
            clean: false,
            changed: 4,
            untracked: 3,
            gitStatus: {
              changeCount: 7,
              files: [
                " M packages/litt-cli/src/ink/controller.ts",
                " M packages/litt-cli/src/lib/intent.ts",
                " M packages/litt-cli/src/lib/read-lane.ts",
                " M packages/litt-cli/src/lib/tool-call-stream.ts",
                "?? packages/litt-cli/src/__tests__/intent-git-status-regression.test.ts",
                "?? packages/litt-cli/src/__tests__/read-lane-status-regression.test.ts",
                "?? packages/litt-cli/src/__tests__/tool-call-stream-regression.test.ts",
              ],
            },
          },
        },
      } as ReadToolResult,
    ]);

    expect(result).toContain("7 working-tree changes");
    expect(result).toContain("4 tracked");
    expect(result).toContain("3 untracked");
    expect(result).toContain("controller.ts");
    expect(result).toContain("intent.ts");
    expect(result).toContain("read-lane.ts");
    expect(result).toContain("tool-call-stream.ts");
    expect(result).toContain("intent-git-status-regression.test.ts");
    expect(result).toContain("read-lane-status-regression.test.ts");
    expect(result).toContain("tool-call-stream-regression.test.ts");
  });

  it("formats a clean repository concisely", () => {
    const result = formatDeterministicReadAnswer([
      {
        toolId: "project.status",
        label: "Get git status",
        ms: 1,
        result: {
          success: true,
          message: "Clean",
          data: {
            branch: "main",
            clean: true,
            changed: 0,
            untracked: 0,
            gitStatus: {
              changeCount: 0,
              files: [],
            },
          },
        },
      } as ReadToolResult,
    ]);

    expect(result).toBe("The working tree on `main` is clean.");
  });
});
