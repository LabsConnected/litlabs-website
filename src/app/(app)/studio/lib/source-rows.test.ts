import { describe, it, expect } from "vitest";
import { describeSourceRows } from "./source-rows";

/**
 * Repo gate (B2): the Inspector fact rows must present a gated repo
 * project as deliberately unavailable — Source stays the truthful
 * "GitHub" and Workspace reads "Unavailable" — never "Error"/"Failed",
 * which read as breakage. Genuine failures keep the failure wording.
 */

type RowsInput = Parameters<typeof describeSourceRows>[0];

function capabilities(overrides: Partial<RowsInput> = {}): RowsInput {
  return {
    sourceKind: "github",
    sourceLabel: "GitHub",
    sourceStatus: "unavailable",
    versionControl: "none",
    activeBranch: "main",
    repositoryName: "owner/repo",
    githubConnected: true,
    workspaceStatus: "failed",
    ...overrides,
  } as RowsInput;
}

describe("describeSourceRows — repo gate", () => {
  it("presents a gated project as unavailable, not failed", () => {
    const rows = describeSourceRows(capabilities());
    expect(rows.source).toBe("GitHub");
    expect(rows.workspace).toBe("Unavailable");
    expect(rows.github).toBe("owner/repo");
    expect(rows.branch).toBe("main");
  });

  it("keeps genuine failures reading as failures", () => {
    const rows = describeSourceRows(capabilities({ sourceStatus: "error" }));
    expect(rows.source).toBe("Error");
    expect(rows.workspace).toBe("Failed");
  });

  it("keeps a ready project ready", () => {
    const rows = describeSourceRows(
      capabilities({ sourceStatus: "ready", workspaceStatus: "ready", versionControl: "git" }),
    );
    expect(rows.source).toBe("GitHub");
    expect(rows.workspace).toBe("Ready");
  });

  it("keeps a managed project on the managed wording", () => {
    const rows = describeSourceRows(
      capabilities({
        sourceKind: "managed",
        sourceLabel: "LiTT Managed",
        sourceStatus: "needs_setup",
        workspaceStatus: "not_prepared",
        githubConnected: false,
        repositoryName: null,
      }),
    );
    expect(rows.source).toBe("Needs setup");
    expect(rows.workspace).toBe("Not prepared");
    expect(rows.github).toBe("Not connected");
  });
});
