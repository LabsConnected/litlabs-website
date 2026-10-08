import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  resolveApproval: vi.fn(),
  createRun: vi.fn(),
  getMission: vi.fn(),
  updateRunStatus: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(() =>
    Promise.resolve({ workspaceId: "ws", workspaceRoot: "/w", project: {} }),
  ),
}));
vi.mock("@/lib/terminal-auth", () => ({ createTerminalToken: vi.fn() }));
vi.mock("@/lib/file-audit", () => ({ logFileOperation: vi.fn() }));
vi.mock("./mission-repository", () => repo);
// Unconfigured production: the resolver yields "".
vi.mock("@/lib/terminal-url", () => ({ getTerminalServerUrl: vi.fn(() => "") }));

import { resolveMissionApproval, startMissionRun } from "./mission-executor";

afterEach(() => vi.unstubAllEnvs());

describe("mission executor with no terminal configured", () => {
  it("does not persist an approval decision it cannot apply", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    await expect(resolveMissionApproval("a1", "u1", "approved")).rejects.toMatchObject({
      code: "terminal_not_configured",
    });
    expect(repo.resolveApproval).not.toHaveBeenCalled();
  });

  it("does not create or start a run", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    await expect(startMissionRun("m1", "p1", "u1", "go")).rejects.toMatchObject({
      code: "terminal_not_configured",
    });
    expect(repo.createRun).not.toHaveBeenCalled();
    expect(repo.updateRunStatus).not.toHaveBeenCalled();
  });
});
