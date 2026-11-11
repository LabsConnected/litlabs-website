import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/studio-projects/[projectId]/workspace/prepare/route";

/**
 * Host-exec seam: when workspace provisioning fails because the terminal
 * server refuses host execution (fail-closed 503 HOST_EXECUTION_DISABLED),
 * this route must answer with the mapped 503 + code body — not a bare 500
 * that drops the code and leaves every caller showing raw message text.
 * Genuinely unexpected errors keep the existing 500 shape.
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
}));

vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: vi.fn(),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const provisionMock = vi.mocked(provisionWorkspaceForProject);

const project = { id: "proj-1", userId: "user-1" };

function postPrepare() {
  return POST(
    new Request("https://x.test/api/studio-projects/proj-1/workspace/prepare", { method: "POST" }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ projectId: "proj-1" }) },
  );
}

describe("POST /api/studio-projects/[projectId]/workspace/prepare — host-exec mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ ...project } as never);
  });

  it("maps a host-execution refusal (code attached) to 503 with the code in the body", async () => {
    const refusal = new Error(
      'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}',
    ) as Error & { code?: string };
    refusal.code = "HOST_EXECUTION_DISABLED";
    provisionMock.mockRejectedValue(refusal);

    const res = await postPrepare();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("HOST_EXECUTION_DISABLED");
    // The body carries the guard's human sentence, never the raw throw text.
    expect(body.error).not.toContain("Workspace prepare failed (503)");
    expect(body.error).not.toContain('"code"');
  });

  it("recovers the code from the message text when no .code is attached", async () => {
    provisionMock.mockRejectedValue(
      new Error('Workspace prepare failed (503): {"error":"Host execution is disabled in production","code":"HOST_EXECUTION_DISABLED"}'),
    );

    const res = await postPrepare();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("HOST_EXECUTION_DISABLED");
  });

  it("keeps genuinely unexpected errors at 500 with the existing shape", async () => {
    provisionMock.mockRejectedValue(new Error("database exploded"));

    const res = await postPrepare();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "database exploded" });
  });

  it("returns the provisioned workspace on success", async () => {
    provisionMock.mockResolvedValue("ws-1");
    getProjectMock
      .mockResolvedValueOnce({ ...project } as never)
      .mockResolvedValueOnce({ ...project, workspaceRoot: "/ws/root", workspaceBranch: "main" } as never);

    const res = await postPrepare();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceId).toBe("ws-1");
    expect(body.workspaceStatus).toBe("ready");
  });
});
