import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Refusal derivation that does not depend on the stored error TEXT
// (follow-up to ART-20261111-024 / PR #901).
//
// #901 recovered the refusal only by parsing the machine code back out
// of the stored workspaceError, and only inside the verify-error branch
// — which sits BEHIND the terminal-config gate. Two production shapes
// defeated it:
//  1. The terminal base URL is unconfigured on the serving deployment:
//     the route returned a bare 503 before any recovery ran.
//  2. The stored error is a settled message with no embedded code
//     (e.g. "Provisioning timed out", persisted by the stale-provisioning
//     settle) even though the project is repo-backed, its workspace
//     preparation failed, and this deployment cannot execute host work —
//     the refusal is deterministic, not textual.
// The route must derive HOST_EXECUTION_DISABLED for exactly that shape
// (repo-backed + settled workspace failure + host execution not
// permitted) and must NOT derive it for managed projects.

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({ userId: "user-123" })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  verifyProjectWorkspace: vi.fn(),
  getProject: vi.fn(),
  // Mirrors the real class so the route's instanceof check works.
  ProjectVerificationError: class ProjectVerificationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = "ProjectVerificationError";
    }
  },
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "tok", expiresAt: 9999999999 })),
}));

vi.mock("@/lib/terminal-url", () => ({
  getTerminalServerUrl: vi.fn(() => "http://terminal:1234"),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  // Phase 2 §3.2: default not available (fail closed) — preserves the
  // derivation expectations; the suppression test opts in.
  isSandboxExecutionAvailable: vi.fn(async () => false),
  getSandboxAvailability: vi.fn(async () => ({
    provider: null,
    routingEnabled: false,
    verified: false,
    allowed: false,
    reason: "availability-unavailable",
  })),
}));

import { GET } from "./route";
import { verifyProjectWorkspace, getProject, ProjectVerificationError } from "@/lib/projects/project-repository";
import { getTerminalServerUrl } from "@/lib/terminal-url";
import { isSandboxExecutionAvailable } from "@/lib/terminal-internal-client";

const verifyMock = vi.mocked(verifyProjectWorkspace);
const getProjectMock = vi.mocked(getProject);
const terminalUrlMock = vi.mocked(getTerminalServerUrl);
const sandboxAvailableMock = vi.mocked(isSandboxExecutionAvailable);

function callRoute() {
  return GET(
    new NextRequest("http://localhost:3000/api/studio-projects/p1/workspace-state"),
    { params: Promise.resolve({ projectId: "p1" }) },
  );
}

describe("GET workspace-state — deterministic refusal derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalUrlMock.mockReturnValue("http://terminal:1234");
  });

  it("unconfigured terminal + repo-backed failed project with a code-less stored error → coded 200 naming the refusal", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    terminalUrlMock.mockReturnValue("");
    getProjectMock.mockResolvedValue({
      sourceType: "github",
      workspaceStatus: "failed",
      workspaceError: "Provisioning timed out",
    } as never);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspaceErrorCode).toBe("HOST_EXECUTION_DISABLED");
    expect(body.scaffolded).toBe(false);
    expect(body.touched).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("verify NOT_READY + repo-backed failed project with a code-less stored error → workspaceErrorCode derived", async () => {
    verifyMock.mockRejectedValue(
      new ProjectVerificationError("Workspace not ready (current: failed)", "WORKSPACE_NOT_READY"),
    );
    getProjectMock.mockResolvedValue({
      sourceType: "github",
      workspaceStatus: "failed",
      workspaceError: "Provisioning timed out",
    } as never);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_READY");
    expect(body.workspaceErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("managed project with the same settled failure → no derivation (code stays null)", async () => {
    verifyMock.mockRejectedValue(
      new ProjectVerificationError("Workspace not ready (current: failed)", "WORKSPACE_NOT_READY"),
    );
    getProjectMock.mockResolvedValue({
      sourceType: "blank",
      workspaceStatus: "failed",
      workspaceError: "Provisioning timed out",
    } as never);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_READY");
    expect(body.workspaceErrorCode).toBeNull();
  });

  // Phase 2 §3.2: when the terminal reports sandboxed execution
  // available for the user, the deterministic refusal is NOT derived —
  // the settled failure is retryable through the sandbox. The verify
  // outcome (WORKSPACE_NOT_READY) is unaffected.
  it("verify NOT_READY + repo-backed failed project + sandbox available → no derived refusal", async () => {
    sandboxAvailableMock.mockResolvedValue(true);
    verifyMock.mockRejectedValue(
      new ProjectVerificationError("Workspace not ready (current: failed)", "WORKSPACE_NOT_READY"),
    );
    getProjectMock.mockResolvedValue({
      sourceType: "github",
      workspaceStatus: "failed",
      workspaceError: "Provisioning timed out",
    } as never);
    const res = await callRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("WORKSPACE_NOT_READY");
    expect(body.workspaceErrorCode).toBeNull();
    expect(sandboxAvailableMock).toHaveBeenCalledWith("user-123");
  });

  it("unconfigured terminal + managed failed project → the explicit 503 stands", async () => {
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "");
    terminalUrlMock.mockReturnValue("");
    getProjectMock.mockResolvedValue({
      sourceType: "blank",
      workspaceStatus: "failed",
      workspaceError: "Provisioning timed out",
    } as never);
    const res = await callRoute();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("terminal_not_configured");
    vi.unstubAllEnvs();
  });
});
