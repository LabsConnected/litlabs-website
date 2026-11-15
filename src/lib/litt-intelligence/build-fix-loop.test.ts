// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { runBuildFixLoop } from "./build-fix-loop";
import type { WorkspaceTransport, ProjectPackageInfo } from "./workspace-transport";

/**
 * Build-fix loop failure containment.
 *
 * Production defect (2026-11-14): a resumed approval run executed the
 * approved file write, then the build-fix loop's first check exec hit
 * the terminal's sandbox 500 ("exec failed (500): Sandbox execution
 * failed"). transport.runCheck THREW, runBuildFixLoop had no containment,
 * and the throw propagated out of the agent loop — the whole resumed run
 * died as "The resumed run failed: exec failed (500)..." even though the
 * approved mutation had landed. A check that cannot execute is a FAILED
 * check with the transport error as its output — never a fatal run error.
 */

const PACKAGE_INFO: ProjectPackageInfo = {
  packageManager: "pnpm",
  scripts: {},
  hasPackageJson: true,
  hasTypecheck: true,
  hasLint: true,
  hasBuild: true,
  hasTest: true,
};

function stubTransport(overrides: Partial<WorkspaceTransport>): WorkspaceTransport {
  return {
    discoverPackageInfo: vi.fn(async () => PACKAGE_INFO),
    runCheck: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
    ...overrides,
  } as unknown as WorkspaceTransport;
}

describe("runBuildFixLoop transport failure containment", () => {
  it("converts a throwing check exec into a failed CheckResult instead of throwing", async () => {
    const transport = stubTransport({
      runCheck: vi.fn(async () => {
        throw new Error("exec failed (500): Sandbox execution failed");
      }),
    });

    const result = await runBuildFixLoop(transport);

    expect(result.allPassed).toBe(false);
    expect(result.finalState).toBe("failed");
    expect(result.results).toHaveLength(4);
    for (const check of result.results) {
      expect(check.passed).toBe(false);
      expect(check.exitCode).toBe(1);
      expect(check.stderr).toContain("exec failed (500): Sandbox execution failed");
    }
  });

  it("keeps passing checks passing when a sibling check's exec throws", async () => {
    const transport = stubTransport({
      runCheck: vi.fn(async (checkId: string) => {
        if (checkId === "typecheck") {
          throw new Error("exec failed (500): Sandbox execution failed");
        }
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      }),
    });

    const result = await runBuildFixLoop(transport, undefined, {
      onRepair: async () => false,
    });

    expect(result.allPassed).toBe(false);
    const byCheck = new Map(result.results.map((r) => [r.check, r]));
    expect(byCheck.get("typecheck")?.passed).toBe(false);
    expect(byCheck.get("typecheck")?.stderr).toContain("Sandbox execution failed");
    expect(byCheck.get("lint")?.passed).toBe(true);
    expect(byCheck.get("build")?.passed).toBe(true);
  });

  it("feeds the transport error to the repair callback as check output", async () => {
    const transport = stubTransport({
      runCheck: vi.fn(async () => {
        throw new Error("exec failed (500): Sandbox execution failed");
      }),
    });
    const onRepair = vi.fn(async () => false);

    const result = await runBuildFixLoop(transport, undefined, { onRepair });

    expect(onRepair).toHaveBeenCalledTimes(1);
    expect(onRepair.mock.calls[0][1]).toContain("exec failed (500): Sandbox execution failed");
    expect(result.finalState).toBe("failed");
  });

  it("treats a throwing repair callback as a failed repair attempt, not a fatal error", async () => {
    const transport = stubTransport({
      runCheck: vi.fn(async () => ({ exitCode: 2, stdout: "", stderr: "tsc: error TS1", durationMs: 1 })),
    });
    const onRepair = vi.fn(async () => {
      throw new Error("exec failed (500): Sandbox execution failed");
    });

    const result = await runBuildFixLoop(transport, undefined, { onRepair });

    expect(result.allPassed).toBe(false);
    expect(result.finalState).toBe("failed");
    expect(result.repairAttempts).toBe(1);
  });

  it("returns an honest no-checks-executed failure when package discovery throws", async () => {
    const transport = stubTransport({
      discoverPackageInfo: vi.fn(async () => {
        throw new Error("readFile failed (404): workspace not ready");
      }),
    });

    const result = await runBuildFixLoop(transport);

    expect(result.allPassed).toBe(false);
    expect(result.finalState).toBe("failed");
    expect(result.results).toEqual([]);
    expect(result.repairAttempts).toBe(0);
  });

  it("still reports allPassed when every check passes (sanity)", async () => {
    const transport = stubTransport({});
    const result = await runBuildFixLoop(transport);
    expect(result.allPassed).toBe(true);
    expect(result.finalState).toBe("passed");
    expect(result.results).toHaveLength(4);
  });
});
