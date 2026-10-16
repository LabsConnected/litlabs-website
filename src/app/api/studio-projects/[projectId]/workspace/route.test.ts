/**
 * GET /api/studio-projects/[projectId]/workspace — recovery contract tests.
 *
 * The route must report the truthful workspace state AND kick recovery
 * for every recoverable state (not_prepared / failed / interrupted
 * provisioning / lost-on-terminal-server) via after(), without blocking
 * the response on the prepare.
 *
 * Run: npx vitest run src/app/api/studio-projects/[projectId]/workspace/route.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// after() callbacks are captured, never awaited — registering must not
// block the response, and tests drain them explicitly to observe the kick.
const { afterCallbacks } = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => unknown>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/terminal-internal-client", () => ({ getWorkspaceInternal: vi.fn() }));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      afterCallbacks.push(callback);
    },
  };
});

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { getWorkspaceInternal } from "@/lib/terminal-internal-client";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const mockAuth = vi.mocked(auth);
const mockGetProject = vi.mocked(getProject);
const mockGetWorkspace = vi.mocked(getWorkspaceInternal);
const mockProvision = vi.mocked(provisionWorkspaceForProject);

const USER = "user-1";
const PROJECT = "proj-1";

const fakeProject = (overrides: Record<string, unknown> = {}) =>
  ({
    id: PROJECT,
    userId: USER,
    workspaceId: null,
    workspaceStatus: "not_prepared",
    workspaceError: null,
    workspaceBranch: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  }) as never;

function get(projectId = PROJECT) {
  return GET(
    new NextRequest(`http://localhost/api/studio-projects/${projectId}/workspace`),
    { params: Promise.resolve({ projectId }) },
  );
}

/** Drain the registered after() work — the real runtime does this post-response. */
async function drainRecovery() {
  for (const cb of afterCallbacks.splice(0)) await cb();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterCallbacks.length = 0;
  mockAuth.mockResolvedValue({ userId: USER, clerkId: "clerk_1" } as never);
  mockProvision.mockResolvedValue("ws-new" as never);
});

describe("authentication and ownership", () => {
  it("401s when unauthenticated and kicks no recovery", async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);
    const res = await get();
    expect(res.status).toBe(401);
    expect(afterCallbacks).toHaveLength(0);
  });

  it("404s for a project the user does not own", async () => {
    mockGetProject.mockResolvedValue(null as never);
    const res = await get();
    expect(res.status).toBe(404);
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("recovery kick — never-started workspace", () => {
  it("returns not_prepared immediately and schedules provisioning via after()", async () => {
    mockGetProject.mockResolvedValue(fakeProject({ workspaceStatus: "not_prepared" }));

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspaceId: null, workspaceStatus: "not_prepared" });

    // The response did NOT wait on provisioning — it was registered with
    // after() instead. Draining runs it.
    expect(afterCallbacks).toHaveLength(1);
    await drainRecovery();
    expect(mockProvision).toHaveBeenCalledWith(PROJECT, USER);
  });
});

describe("recovery kick — failed workspace", () => {
  it("reports failed truthfully and schedules a retry once the backoff has passed", async () => {
    mockGetProject.mockResolvedValue(
      fakeProject({
        workspaceStatus: "failed",
        workspaceError: "Disk full",
        updatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    );

    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.workspaceStatus).toBe("failed");
    expect(body.workspaceError).toBe("Disk full");
    expect(afterCallbacks).toHaveLength(1);
  });

  it("does not re-kick a failure that just landed (30s backoff)", async () => {
    mockGetProject.mockResolvedValue(
      fakeProject({
        workspaceStatus: "failed",
        workspaceError: "Disk full",
        updatedAt: new Date().toISOString(),
      }),
    );

    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceStatus).toBe("failed");
    expect(afterCallbacks).toHaveLength(0);
  });
});

describe("recovery kick — interrupted provisioning", () => {
  it("returns provisioning promptly and schedules lock reconciliation without awaiting it", async () => {
    // The lock owner died mid-prepare: status stays provisioning forever.
    // The kick must not park the response — provision is mocked to never
    // resolve, so any await would hang this test.
    mockProvision.mockReturnValue(new Promise(() => {}) as never);
    mockGetProject.mockResolvedValue(
      fakeProject({
        workspaceStatus: "provisioning",
        updatedAt: new Date(Date.now() - 120_000).toISOString(),
      }),
    );

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspaceId: null, workspaceStatus: "provisioning" });
    expect(afterCallbacks).toHaveLength(1);
    // Draining starts the never-resolving provision — do not await it;
    // the real runtime drains it inside the request lifecycle.
    for (const cb of afterCallbacks.splice(0)) void cb();
    expect(mockProvision).toHaveBeenCalledWith(PROJECT, USER);
  });
});

describe("live workspace", () => {
  it("returns ready when the terminal server still has the workspace", async () => {
    mockGetProject.mockResolvedValue(
      fakeProject({ workspaceId: "ws-1", workspaceStatus: "ready" }),
    );
    mockGetWorkspace.mockResolvedValue(
      { workspaceId: "ws-1", ready: true, branch: "main", commitSha: "abc" } as never,
    );

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspaceId: "ws-1", workspaceStatus: "ready", branch: "main" });
    expect(afterCallbacks).toHaveLength(0);
  });

  it("returns preparing while the live workspace finishes its prepare", async () => {
    mockGetProject.mockResolvedValue(
      fakeProject({ workspaceId: "ws-1", workspaceStatus: "ready" }),
    );
    mockGetWorkspace.mockResolvedValue({ workspaceId: "ws-1", ready: false } as never);

    const res = await get();
    expect((await res.json()).workspaceStatus).toBe("preparing");
  });

  it("kicks adoption-first recovery when the terminal server lost the workspace", async () => {
    mockGetProject.mockResolvedValue(
      fakeProject({ workspaceId: "ws-lost", workspaceStatus: "ready" }),
    );
    mockGetWorkspace.mockResolvedValue(null as never);

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ workspaceId: "ws-lost", workspaceStatus: "provisioning" });
    expect(afterCallbacks).toHaveLength(1);
    await drainRecovery();
    expect(mockProvision).toHaveBeenCalledWith(PROJECT, USER);
  });
});
