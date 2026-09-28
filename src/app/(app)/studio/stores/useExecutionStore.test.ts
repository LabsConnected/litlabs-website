import { beforeEach, describe, expect, it } from "vitest";
import { feedSSEEventToExecutionStore, useExecutionStore } from "./useExecutionStore";

describe("execution event projections", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
  });

  it("keeps real workspace diff evidence visible in activity events", () => {
    feedSSEEventToExecutionStore({
      type: "workspace_change",
      status: "changed",
      files: ["src/App.tsx"],
      diff: "-old\n+new",
      additions: 1,
      deletions: 1,
    });

    const event = useExecutionStore.getState().events[0];
    expect(event.summary).toContain("1 file changed");
    expect(event.filePath).toBe("src/App.tsx");
    expect(event.diff).toBe("-old\n+new");
  });

  it("keeps structured verification diagnostics attached to failed checks", () => {
    feedSSEEventToExecutionStore({
      type: "build_result",
      check: "typecheck",
      passed: false,
      errorCount: 1,
      diagnostics: [{
        file: "src/App.tsx",
        line: 12,
        severity: "error",
        message: "Type mismatch",
        source: "typecheck",
      }],
    });

    expect(useExecutionStore.getState().events[0].diagnostics?.[0]).toMatchObject({
      file: "src/App.tsx",
      line: 12,
      message: "Type mismatch",
    });
  });
});
