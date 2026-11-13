import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { afterCallbacks } = vi.hoisted(() => ({ afterCallbacks: [] as Array<() => unknown> }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/resolve-current-project", () => ({ resolveCurrentProject: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/projects/project-source", () => ({
  describeProjectSource: vi.fn(() => ({
    kind: "managed", label: "LiTT Managed", status: "ready", versionControl: "git",
    githubConnected: false, githubRepository: null, branch: "main",
  })),
}));
vi.mock("@/lib/studio/workspace-recovery", () => ({ provisionWorkspaceForProject: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => { afterCallbacks.push(callback); },
}));

import { GET } from "./route";
import { HOST_EXECUTION_UNAVAILABLE_MESSAGE } from "@/lib/projects/runtime-state";
import { auth } from "@/lib/auth";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { getProject } from "@/lib/projects/project-repository";
import { describeProjectSource } from "@/lib/projects/project-source";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const mockAuth = vi.mocked(auth);
const mockResolve = vi.mocked(resolveCurrentProject);
const mockGetProject = vi.mocked(getProject);
const mockProvision = vi.mocked(provisionWorkspaceForProject);
const mockDescribeSource = vi.mocked(describeProjectSource);
const project = (status: string, updatedAt = new Date().toISOString()) => ({
  id: "p1", userId: "u1", name: "Demo", sourceType: "blank", workspaceId: null,
  workspaceRoot: null, workspaceError: status === "failed" ? "terminal down" : null,
  workspaceStatus: status, updatedAt, previewUrl: null,
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockAuth.mockResolvedValue({ userId: "u1" } as never);
  mockResolve.mockResolvedValue({ projectId: "p1", projectName: "Demo" } as never);
  mockProvision.mockResolvedValue("ws-1" as never);
});

async function get() {
  return GET(new NextRequest("http://localhost/api/project-runtime?projectId=p1"));
}

describe("project-runtime recovery polling", () => {
  it("kicks never-started recovery without awaiting it", async () => {
    mockGetProject.mockResolvedValue(project("not_prepared"));
    const res = await get();
    expect((await res.json()).workspaceStatus).toBe("not_prepared");
    expect(afterCallbacks).toHaveLength(1);
  });

  it("does not repeatedly kick a healthy provisioning worker", async () => {
    mockGetProject.mockResolvedValue(project("provisioning", new Date().toISOString()));
    const res = await get();
    expect((await res.json()).workspaceStatus).toBe("provisioning");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("kicks genuinely stale provisioning and preserves failed retry backoff", async () => {
    mockGetProject.mockResolvedValue(project("provisioning", new Date(Date.now() - 60_000).toISOString()));
    await get();
    expect(afterCallbacks).toHaveLength(1);

    afterCallbacks.length = 0;
    mockGetProject.mockResolvedValue(project("failed", new Date().toISOString()));
    const failed = await get();
    const body = await failed.json();
    expect(body.error.message).toBe("terminal down");
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("project-runtime host-execution truth (wave-4)", () => {
  // The exact string production stores as workspaceError when a repo-backed
  // prepare hits the terminal-server's fail-closed 503.
  const HOST_EXEC_STORED =
    'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

  const failedProject = (overrides: Record<string, unknown> = {}) => ({
    id: "p1", userId: "u1", name: "Demo", sourceType: "github", workspaceId: null,
    workspaceRoot: null, workspaceError: HOST_EXEC_STORED,
    workspaceStatus: "failed", updatedAt: new Date().toISOString(), previewUrl: null,
    ...overrides,
  }) as never;

  it("surfaces HOST_EXECUTION_DISABLED with the honest message and no retry action", async () => {
    mockGetProject.mockResolvedValue(failedProject());
    const body = await (await get()).json();
    expect(body.error.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.error.message).toBe(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(body.error.recoveryAction).toBeUndefined();
  });

  it("does the same when a stale workspaceId keeps the project in workspace_not_ready", async () => {
    mockGetProject.mockResolvedValue(failedProject({ workspaceId: "ws-1", workspaceRoot: "/data/ws-1" }));
    const body = await (await get()).json();
    expect(body.phase).toBe("workspace_not_ready");
    expect(body.error.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.error.message).toBe(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(body.error.recoveryAction).toBeUndefined();
  });

  it("keeps generic provisioning failures exactly as before", async () => {
    mockGetProject.mockResolvedValue(failedProject({ workspaceError: "terminal down" }));
    const body = await (await get()).json();
    expect(body.error.code).toBe("WORKSPACE_PROVISIONING_FAILED");
    expect(body.error.message).toBe("terminal down");
    expect(body.error.recoveryAction).toBe("retry_workspace");
  });
});

describe("project-runtime repo gate (B2)", () => {
  // The gate is computed from first principles: GitHub-owned source
  // (the real describeProjectSource's verdict, mocked here) in an
  // environment where host execution is not permitted — vitest has no
  // local-execution opt-in, so the guard denies throughout this file.
  const githubSource = {
    kind: "github", label: "GitHub", status: "needs_setup", versionControl: "none",
    githubConnected: true, githubRepository: "owner/repo", branch: "main",
  };

  const repoProject = (overrides: Record<string, unknown> = {}) => ({
    id: "p1", userId: "u1", name: "Repo", sourceType: "github", workspaceId: null,
    workspaceRoot: null, workspaceError: null,
    workspaceStatus: "not_prepared", updatedAt: new Date().toISOString(), previewUrl: null,
    ...overrides,
  }) as never;

  it("gates a FRESH repo project from the first poll — no doomed recovery, no stored refusal needed", async () => {
    mockDescribeSource.mockReturnValue(githubSource as never);
    mockGetProject.mockResolvedValue(repoProject());
    const body = await (await get()).json();
    expect(afterCallbacks).toHaveLength(0);
    expect(body.phase).toBe("workspace_not_provisioned");
    expect(body.error.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.error.message).toBe(HOST_EXECUTION_UNAVAILABLE_MESSAGE);
    expect(body.error.recoveryAction).toBeUndefined();
    expect(body.sourceStatus).toBe("unavailable");
  });

  it("never schedules the failed-retry backoff for a gated repo project", async () => {
    mockDescribeSource.mockReturnValue({ ...githubSource, status: "unavailable" } as never);
    mockGetProject.mockResolvedValue(repoProject({
      workspaceStatus: "failed",
      workspaceError: "terminal down",
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
    }));
    const body = await (await get()).json();
    expect(afterCallbacks).toHaveLength(0);
    expect(body.error.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.sourceStatus).toBe("unavailable");
  });

  it("leaves a ready repo workspace fully ready (gate applies only when not ready)", async () => {
    mockDescribeSource.mockReturnValue({ ...githubSource, status: "ready", versionControl: "git" } as never);
    mockGetProject.mockResolvedValue(repoProject({
      workspaceStatus: "ready",
      workspaceId: "ws-1",
      workspaceRoot: "/data/ws-1",
    }));
    const body = await (await get()).json();
    expect(body.phase).toBe("ready");
    expect(body.error).toBeUndefined();
    expect(body.sourceStatus).toBe("ready");
  });
});
