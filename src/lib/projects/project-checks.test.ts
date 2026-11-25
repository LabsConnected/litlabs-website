import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ACC-07 Item 2 — the shared project-checks implementation behind
 * both the on-demand routes and the agent loop's automatic
 * completion checks. The workspace exec endpoint is faked at the
 * fetch layer; repository/mission/supabase modules are mocked.
 */

const insertCalls: Array<Record<string, unknown>> = [];
let latestRow: Record<string, unknown> | null = null;

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "project_check_runs") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: Record<string, unknown>) => {
          insertCalls.push(row);
          latestRow = {
            results: row.results,
            summary: row.summary,
            conversation_id: row.conversation_id,
            created_at: new Date().toISOString(),
          };
          return { error: null };
        },
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: latestRow, error: null }),
                }),
              }),
            }),
          }),
        }),
      };
    },
  },
}));

vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));

const getProjectMock = vi.fn();
const verifyProjectWorkspaceMock = vi.fn();
vi.mock("@/lib/projects/project-repository", () => ({
  getProject: (...args: unknown[]) => getProjectMock(...args),
  verifyProjectWorkspace: (...args: unknown[]) => verifyProjectWorkspaceMock(...args),
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  listPendingApprovals: vi.fn(async () => []),
  listCheckpoints: vi.fn(async () => []),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: () => "http://terminal.test",
  terminalNotConfiguredResponse: () => null,
}));

import {
  ProjectChecksUnavailableError,
  completionChecksFailureMessage,
  getLatestProjectCheckRun,
  runAllProjectChecks,
  saveProjectCheckRun,
} from "./project-checks";

const execResponses = new Map<string, { exitCode: number; stdout?: string; durationMs?: number }>();

function fakeFetch(url: string, init?: { body?: string }) {
  const body = JSON.parse(init?.body ?? "{}") as { command?: string };
  const command = body.command ?? "";
  if (command.startsWith("git status")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ exitCode: 0, stdout: "?? index.html\n", durationMs: 5 }),
    });
  }
  const response = execResponses.get(command) ?? { exitCode: 0, durationMs: 11 };
  return Promise.resolve({
    ok: true,
    json: async () => ({ stdout: "", stderr: "", ...response }),
  });
}

describe("runAllProjectChecks (ACC-07 Item 2)", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    latestRow = null;
    execResponses.clear();
    getProjectMock.mockReset();
    verifyProjectWorkspaceMock.mockReset();
    getProjectMock.mockResolvedValue({
      id: "proj-1",
      name: "Bakery",
      packageManager: "pnpm",
      githubBranch: "main",
      githubDefaultBranch: "main",
      workspaceStatus: "ready",
    });
    verifyProjectWorkspaceMock.mockResolvedValue({ workspaceId: "ws-1" });
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  it("runs all seven checks and reports per-check durations", async () => {
    const outcome = await runAllProjectChecks({ projectId: "proj-1", userId: "user-1" });
    expect(outcome.checks.map((c) => c.id)).toEqual([
      "build",
      "typecheck",
      "lint",
      "test",
      "security",
      "accessibility",
      "performance",
    ]);
    // The five command-backed checks pass with the exec duration.
    for (const check of outcome.checks.slice(0, 5)) {
      expect(check.status, check.id).toBe("passed");
      expect(check.durationMs, check.id).toBe(11);
    }
    // Accessibility/performance have no configured script — a real
    // result with a reason, never "Not run".
    expect(outcome.checks[5].status).toBe("not_configured");
    expect(outcome.checks[6].status).toBe("not_configured");
    expect(outcome.summary).toMatchObject({ total: 7, passed: 5, failed: 0, notConfigured: 2 });
    expect(outcome.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.changedFiles).toEqual(["index.html"]);
  });

  it("marks a non-zero exit as failed with the command named", async () => {
    execResponses.set("pnpm exec tsc --noEmit", { exitCode: 2, durationMs: 42 });
    const outcome = await runAllProjectChecks({ projectId: "proj-1", userId: "user-1" });
    const typecheck = outcome.checks.find((c) => c.id === "typecheck");
    expect(typecheck?.status).toBe("failed");
    expect(typecheck?.durationMs).toBe(42);
    expect(typecheck?.error).toContain("code 2");
    expect(outcome.summary.failed).toBe(1);
  });

  it("throws the route-shaped 404 when the project is gone", async () => {
    getProjectMock.mockResolvedValue(null);
    await expect(runAllProjectChecks({ projectId: "nope", userId: "user-1" })).rejects.toMatchObject({
      name: "ProjectChecksUnavailableError",
      status: 404,
      body: { error: "Project not found" },
    });
  });

  it("throws the route-shaped 422 with unavailable checks when the workspace is not ready", async () => {
    verifyProjectWorkspaceMock.mockRejectedValue(new Error("workspace not mounted"));
    const err = await runAllProjectChecks({ projectId: "proj-1", userId: "user-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(ProjectChecksUnavailableError);
    expect(err.status).toBe(422);
    expect(err.body.checks).toHaveLength(7);
    expect(err.body.checks[0].status).toBe("unavailable");
  });
});

describe("project check persistence (ACC-07 Item 2)", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    latestRow = null;
  });

  it("saves a run and reads the latest back, tied to its conversation", async () => {
    const checks = [
      {
        id: "build" as const,
        label: "Build",
        status: "passed" as const,
        source: "Workspace · pnpm run build",
        timestamp: new Date().toISOString(),
        durationMs: 100,
      },
    ];
    const summary = { total: 7, passed: 1, failed: 0, notConfigured: 2, changedFileCount: 0 };
    await expect(
      saveProjectCheckRun({ projectId: "proj-1", userId: "user-1", conversationId: "conv-9", checks, summary }),
    ).resolves.toBe(true);
    expect(insertCalls[0]).toMatchObject({ project_id: "proj-1", user_id: "user-1", conversation_id: "conv-9" });

    const latest = await getLatestProjectCheckRun("proj-1", "user-1");
    expect(latest?.conversationId).toBe("conv-9");
    expect(latest?.checks).toEqual(checks);
    expect(latest?.summary).toEqual(summary);
  });

  it("the failure message names the failed checks in plain language", () => {
    const message = completionChecksFailureMessage([
      { id: "typecheck", label: "TypeScript", status: "failed", source: "", timestamp: null },
      { id: "test", label: "Test", status: "failed", source: "", timestamp: null },
    ]);
    expect(message).toContain("TypeScript, Test failed");
    expect(message).toContain("Checks panel");
    expect(message).toContain("can't call this build successful");
  });
});
