import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/studio-projects/[projectId]/workspace/prepare/route";

/**
 * Route honesty (console-errors diagnosis §1.1): the terminal-server's
 * fail-closed HOST_EXECUTION_DISABLED refusal reaches this route with
 * its code attached — the adapter must map it to the standard 503 +
 * coded body instead of an unmapped 500 carrying the raw message
 * (which embeds the JSON code string callers then render verbatim).
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

const HOST_EXEC_STORED =
  'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

function postPrepare() {
  return POST(
    new Request("https://x.test/api/studio-projects/proj-1/workspace/prepare", { method: "POST" }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ projectId: "proj-1" }) },
  );
}

describe("POST /workspace/prepare — host-execution mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
    getProjectMock.mockResolvedValue({ id: "proj-1", userId: "user-1" } as never);
  });

  it("maps a carried HOST_EXECUTION_DISABLED code to 503 + coded body", async () => {
    const err = new Error(HOST_EXEC_STORED) as Error & { code?: string };
    err.code = "HOST_EXECUTION_DISABLED";
    provisionMock.mockRejectedValue(err);
    const res = await postPrepare();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("HOST_EXECUTION_DISABLED");
    // The human sentence, NOT the raw stored message with embedded JSON.
    expect(body.error).not.toContain("HOST_EXECUTION_DISABLED");
    expect(body.error).not.toContain("{");
  });

  it("maps an embedded-code-only refusal to 503 as well", async () => {
    provisionMock.mockRejectedValue(new Error(HOST_EXEC_STORED));
    const res = await postPrepare();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("HOST_EXECUTION_DISABLED");
  });

  it("keeps genuinely unexpected failures at 500 with their message", async () => {
    provisionMock.mockRejectedValue(new Error("terminal down"));
    const res = await postPrepare();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("terminal down");
    expect(body.code).toBeUndefined();
  });
});
