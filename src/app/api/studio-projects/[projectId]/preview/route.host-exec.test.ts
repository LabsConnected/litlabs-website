import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/studio-projects/[projectId]/preview/route";

/**
 * Host-exec seam: POST /preview already threads the failure code into the
 * body (wave-4) but answers 500 for the terminal-server's fail-closed
 * HOST_EXECUTION_DISABLED refusal — an expected, known state reported as a
 * server fault. When the resolved runtimeErrorCode is
 * HOST_EXECUTION_DISABLED the status must be 503; every other failure
 * keeps 500.
 *
 * Self-contained sibling of route.test.ts: it additionally mocks
 * preview-asset-manifest so this file does not depend on the acorn import
 * chain (the manifest is irrelevant to the POST start path).
 */

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(),
  updateProjectRuntime: vi.fn(),
}));

vi.mock("@/lib/studio/workspace-recovery", () => ({
  ensureWorkspaceAlive: vi.fn(),
  provisionWorkspaceForProject: vi.fn(),
}));

vi.mock("@/lib/terminal-v1/secret-broker", () => ({
  SecretBroker: vi.fn(),
}));

vi.mock("@/lib/preview-clerk-env", () => ({
  extractClerkEnvFromSecrets: vi.fn(() => ({})),
}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "test-token", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/projects/preview-token", () => ({
  createPreviewToken: vi.fn(() => ({ token: "preview-token-1", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/projects/preview-asset-manifest", () => ({
  collectPreviewAssetManifest: vi.fn(async () => ({ assets: ["index.html"], complete: true })),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

vi.mock("@/lib/terminal-internal-client", () => ({
  startPreviewInternal: vi.fn(),
  getPreviewStatusInternal: vi.fn(),
  stopPreviewInternal: vi.fn(),
  buildPreviewProxyUrl: vi.fn((workspaceId: string) => `https://proxy.test/${workspaceId}`),
}));

import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { startPreviewInternal } from "@/lib/terminal-internal-client";
import { ensureWorkspaceAlive, provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const startPreviewMock = vi.mocked(startPreviewInternal);
const provisionMock = vi.mocked(provisionWorkspaceForProject);
const ensureAliveMock = vi.mocked(ensureWorkspaceAlive);

const HOST_EXEC_STORED =
  'Workspace prepare failed (503): {"error":"Host execution is disabled in production (workspace.prepare(git,install)); a verified sandbox is required","code":"HOST_EXECUTION_DISABLED"}';

function postPreview() {
  return POST(
    new Request("https://x.test/api/studio-projects/proj-1/preview", { method: "POST" }) as unknown as import("next/server").NextRequest,
    { params: Promise.resolve({ projectId: "proj-1" }) },
  );
}

function hostExecError(): Error & { code?: string } {
  const err = new Error(HOST_EXEC_STORED) as Error & { code?: string };
  err.code = "HOST_EXECUTION_DISABLED";
  return err;
}

describe("studio-projects preview route — POST host-exec status mapping (seam close)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ userId: "user-1" } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("answers 503 (not 500) when provisioning refuses with HOST_EXECUTION_DISABLED", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: HOST_EXEC_STORED, framework: "nextjs",
      sourceType: "github",
    } as never);
    provisionMock.mockRejectedValue(hostExecError());

    const res = await postPreview();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("failed");
    expect(body.runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("recovers the code from the message text when provisioning attaches no .code", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: HOST_EXEC_STORED, framework: "nextjs",
      sourceType: "github",
    } as never);
    provisionMock.mockRejectedValue(new Error(HOST_EXEC_STORED));

    const res = await postPreview();
    expect(res.status).toBe(503);
    expect((await res.json()).runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("keeps 500 for a generic provisioning failure", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: null, workspaceRoot: null,
      workspaceStatus: "failed", workspaceError: "terminal down", framework: "nextjs",
      sourceType: "github",
    } as never);
    provisionMock.mockRejectedValue(new Error("terminal down"));

    const res = await postPreview();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.runtimeErrorCode).toBeNull();
  });

  it("answers 503 when the preview start itself refuses with HOST_EXECUTION_DISABLED", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: "ws-1", workspaceRoot: "/ws/root",
      workspaceStatus: "ready", workspaceError: null, framework: "nextjs",
      sourceType: "blank",
    } as never);
    ensureAliveMock.mockResolvedValue({ workspaceId: "ws-1" } as never);
    startPreviewMock.mockRejectedValue(hostExecError());

    const res = await postPreview();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.runtimeStatus).toBe("failed");
    expect(body.runtimeErrorCode).toBe("HOST_EXECUTION_DISABLED");
  });

  it("keeps 500 for a generic preview start failure", async () => {
    getProjectMock.mockResolvedValue({
      id: "proj-1", userId: "user-1", workspaceId: "ws-1", workspaceRoot: "/ws/root",
      workspaceStatus: "ready", workspaceError: null, framework: "nextjs",
      sourceType: "blank",
    } as never);
    ensureAliveMock.mockResolvedValue({ workspaceId: "ws-1" } as never);
    startPreviewMock.mockRejectedValue(new Error("port busy"));

    const res = await postPreview();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.runtimeErrorCode).toBeNull();
  });
});
