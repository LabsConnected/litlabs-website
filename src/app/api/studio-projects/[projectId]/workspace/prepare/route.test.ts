import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@/lib/terminal-internal-client", () => ({
  // Phase 2 §3.2: default not available (fail closed) — preserves the
  // pre-Phase-2 gate expectations; the sandbox-open test opts in.
  isSandboxExecutionAvailable: vi.fn(async () => false),
  getSandboxAvailability: vi.fn(async () => ({
    provider: null,
    routingEnabled: false,
    verified: false,
    allowed: false,
    reason: "availability-unavailable",
  })),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import { isSandboxExecutionAvailable } from "@/lib/terminal-internal-client";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const provisionMock = vi.mocked(provisionWorkspaceForProject);
const sandboxAvailableMock = vi.mocked(isSandboxExecutionAvailable);

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

describe("POST /workspace/prepare — repo gate (B2)", () => {
  // The gate keys on the environment being production-like (host
  // execution not permitted). Vitest runs with no local-execution
  // opt-in, so the guard denies; stub the opt-in vars empty to keep
  // that true even if the surrounding shell exports them.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LITT_LOCAL_EXECUTION_OPT_IN", "");
    vi.stubEnv("LITT_ISOLATION_VERIFIED", "");
    authMock.mockResolvedValue({ userId: "user-1" } as never);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const githubProject = (overrides: Record<string, unknown> = {}) => ({
    id: "proj-1",
    userId: "user-1",
    sourceType: "github",
    githubFullName: "owner/repo",
    workspaceStatus: "not_prepared",
    workspaceId: null,
    ...overrides,
  }) as never;

  it("answers a not-ready repo project with the coded gate WITHOUT provisioning", async () => {
    getProjectMock.mockResolvedValue(githubProject());
    const res = await postPrepare();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("HOST_EXECUTION_DISABLED");
    expect(body.error).not.toContain("{");
    // The whole point: no doomed attempt is run, so the project row is
    // never stamped "failed" for a deliberate product decision.
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("gates a previously failed repo project the same way", async () => {
    getProjectMock.mockResolvedValue(githubProject({ workspaceStatus: "failed" }));
    const res = await postPrepare();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("HOST_EXECUTION_DISABLED");
    expect(provisionMock).not.toHaveBeenCalled();
  });

  it("opens the gate when the terminal reports sandbox execution available for the user", async () => {
    sandboxAvailableMock.mockResolvedValue(true);
    getProjectMock.mockResolvedValue(githubProject());
    provisionMock.mockResolvedValue("ws-1");
    const res = await postPrepare();
    expect(sandboxAvailableMock).toHaveBeenCalledWith("user-1");
    expect(provisionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceStatus).toBe("ready");
  });

  it("lets a ready repo workspace fall through to provisioning (mirror refresh)", async () => {
    getProjectMock.mockResolvedValue(
      githubProject({ workspaceStatus: "ready", workspaceId: "ws-1" }),
    );
    provisionMock.mockResolvedValue("ws-1");
    const res = await postPrepare();
    expect(provisionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect((await res.json()).workspaceStatus).toBe("ready");
  });

  it("does not gate managed projects — provisioning runs as before", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1",
      userId: "user-1",
      sourceType: "blank",
      githubFullName: null,
      workspaceStatus: "not_prepared",
      workspaceId: null,
    } as never);
    provisionMock.mockResolvedValue("ws-9");
    const res = await postPrepare();
    expect(provisionMock).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });
});
