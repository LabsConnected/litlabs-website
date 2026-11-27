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

const listPendingApprovalsMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const listCheckpointsMock = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
vi.mock("@/lib/missions/mission-repository", () => ({
  listPendingApprovals: (...args: unknown[]) => listPendingApprovalsMock(...args),
  listCheckpoints: (...args: unknown[]) => listCheckpointsMock(...args),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: () => "http://terminal.test",
  terminalNotConfiguredResponse: () => null,
}));

import {
  ProjectChecksUnavailableError,
  completionChecksFailureMessage,
  completionChecksNotConfiguredNote,
  completionChecksNotSavedNote,
  completionChecksPartiallyNotConfiguredNote,
  completionChecksUnavailableNotSavedNote,
  completionChecksUnavailableNote,
  getLatestProjectCheckRun,
  runAllProjectChecks,
  saveProjectCheckRun,
  unavailableCheckSet,
  unavailableCheckSetFromError,
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
    listPendingApprovalsMock.mockReset();
    listPendingApprovalsMock.mockResolvedValue([]);
    listCheckpointsMock.mockReset();
    listCheckpointsMock.mockResolvedValue([]);
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

  // ACC-08 Defect 1: the garnish reads (pending approvals /
  // checkpoints) run AFTER the seven checks. Their failure used to
  // propagate out and discard the completed results entirely — one
  // of the ranked throw points behind Run 1 on ba16d435's silent
  // "Not run" panel.
  it("still returns the seven completed results when the garnish reads throw", async () => {
    listCheckpointsMock.mockRejectedValue(new Error("missions db unavailable"));
    const outcome = await runAllProjectChecks({ projectId: "proj-1", userId: "user-1" });
    expect(outcome.checks).toHaveLength(7);
    expect(outcome.summary).toMatchObject({ total: 7, passed: 5, failed: 0, notConfigured: 2 });
    expect(outcome.pendingApprovals).toEqual([]);
    expect(outcome.checkpoints).toEqual([]);
  });

  it("still returns the seven completed results when the approvals read throws", async () => {
    listPendingApprovalsMock.mockRejectedValue(new Error("missions db unavailable"));
    const outcome = await runAllProjectChecks({ projectId: "proj-1", userId: "user-1" });
    expect(outcome.checks).toHaveLength(7);
    expect(outcome.summary.failed).toBe(0);
  });
});

describe("unavailable check sets and notes (ACC-08 Defect 1)", () => {
  it("builds the full seven-check unavailable set from a bare reason", () => {
    const { checks, summary } = unavailableCheckSet("terminal not configured");
    expect(checks).toHaveLength(7);
    expect(checks.every((c) => c.status === "unavailable")).toBe(true);
    expect(checks.every((c) => c.error === "terminal not configured")).toBe(true);
    expect(summary).toEqual({ total: 7, passed: 0, failed: 0, notConfigured: 0, changedFileCount: 0 });
  });

  it("prefers the set carried by a ProjectChecksUnavailableError", () => {
    const carried = [
      {
        id: "build",
        label: "Build",
        status: "unavailable",
        source: "Active project workspace",
        timestamp: "2026-11-25T19:45:00.000Z",
        output: null,
        error: "Project workspace is not ready",
      },
    ];
    const error = new ProjectChecksUnavailableError(422, {
      error: "Project workspace is not ready",
      checks: carried,
    });
    const { checks } = unavailableCheckSetFromError(error);
    expect(checks).toHaveLength(7);
    expect(checks[0]).toMatchObject({ id: "build", error: "Project workspace is not ready" });
    expect(checks[1].error).toBe("Project workspace is not ready");
  });

  it("the unavailable note is loud and plain (Larry's ruling)", () => {
    const note = completionChecksUnavailableNote("Project workspace is not ready");
    expect(note).toContain("did NOT run");
    expect(note).toContain("Project workspace is not ready");
    expect(note).toContain("unavailable rather than passed");
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

  // ACC-09: every identity in this app is a Clerk user ID string
  // (studio_projects.user_id is text). The save path must pass the
  // ID through verbatim — the ACC-07 migration created the column
  // as uuid, so Postgres rejected every real user's save with
  // 22P02 while this mocked suite stayed green. The SQL-level
  // contract is pinned in tests/project-check-runs-sql.integration
  // .test.ts; this pins the code-level half: no ID mangling, and a
  // Clerk-shaped ID round-trips save → latest.
  it("round-trips a Clerk-shaped user ID verbatim (ACC-09 identity contract)", async () => {
    const clerkUserId = "user_3ACC09ClerkIdString";
    const checks = [
      {
        id: "build" as const,
        label: "Build",
        status: "passed" as const,
        source: "Workspace · pnpm run build",
        timestamp: new Date().toISOString(),
        durationMs: 42,
      },
    ];
    const summary = { total: 7, passed: 1, failed: 0, notConfigured: 2, changedFileCount: 1 };
    await expect(
      saveProjectCheckRun({
        projectId: "78ca9e96-1111-4111-8111-111111111111",
        userId: clerkUserId,
        conversationId: "conv-acc09",
        checks,
        summary,
      }),
    ).resolves.toBe(true);
    expect(insertCalls[0]).toMatchObject({ user_id: clerkUserId });

    const latest = await getLatestProjectCheckRun("78ca9e96-1111-4111-8111-111111111111", clerkUserId);
    expect(latest?.checks).toEqual(checks);
    expect(latest?.summary).toEqual(summary);
    expect(latest?.conversationId).toBe("conv-acc09");
  });
});

describe("checks note truthfulness (ACC-09)", () => {
  it("the not-saved note never claims the results are in the Jobs tab", () => {
    const note = completionChecksNotSavedNote();
    expect(note).toContain("could not be saved");
    expect(note).toContain("not run");
    // The ACC-08 wording claimed Jobs held the results; Jobs'
    // durable source is the same persisted set that just failed.
    expect(note).not.toContain("are in this run's Jobs tab");
    expect(note).not.toContain("results are in");
  });

  it("the unavailable-and-not-recorded note says the panel shows Not run, not unavailable", () => {
    const note = completionChecksUnavailableNotSavedNote("Project workspace is not ready");
    expect(note).toContain("did NOT run");
    expect(note).toContain("Project workspace is not ready");
    expect(note).toContain("could not be recorded");
    expect(note).toContain("as not run");
    expect(note).not.toContain("shows the checks as unavailable");
  });
});

describe("not-configured notes (ACC-10 Defect 1)", () => {
  it("the all-not-configured note is loud, admits nothing verified the site, and points at the panels that hold the persisted set", () => {
    const note = completionChecksNotConfiguredNote();
    expect(note).toContain("IMPORTANT");
    expect(note).toContain("none of them are configured");
    expect(note).toContain("nothing actually verified");
    // The set WAS persisted in this path, so pointing at the panels
    // is truthful — unlike the ACC-09 not-saved case.
    expect(note).toContain("Checks panel and the Jobs tab");
    expect(note).toContain("Not configured");
  });

  it("the partial note names exactly the checks that did not run", () => {
    const note = completionChecksPartiallyNotConfiguredNote([
      { id: "accessibility", label: "Accessibility" } as never,
      { id: "performance", label: "Performance" } as never,
    ]);
    expect(note).toContain("Accessibility, Performance");
    expect(note).toContain("did not run");
    expect(note).not.toContain("IMPORTANT");
  });
});
