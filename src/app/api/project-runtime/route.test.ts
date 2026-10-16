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
import { auth } from "@/lib/auth";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import { getProject } from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const mockAuth = vi.mocked(auth);
const mockResolve = vi.mocked(resolveCurrentProject);
const mockGetProject = vi.mocked(getProject);
const mockProvision = vi.mocked(provisionWorkspaceForProject);
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
