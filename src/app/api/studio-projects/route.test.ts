import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/studio-projects — sandbox availability for the Projects
 * cards (stored-refusal fix, 2026-11-14).
 *
 * The list response carries a top-level `sandboxAvailable` flag: the
 * SAME availability truth Studio's workspace-state route probes, so
 * a card carrying a stored HOST_EXECUTION_DISABLED refusal can read
 * as a retryable setup failure once the sandbox exists. The probe
 * must run ONLY when some listed project matches the refusal shape
 * (repo-backed + settled failed/error + host guard refusing — the
 * test env is not local development, so the guard refuses) and must
 * fail closed without ever failing the list itself.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/github-app", () => ({ getInstallationOctokit: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({
  createBlankProject: vi.fn(),
  createGithubProject: vi.fn(),
  findReusableEmptyBlankProject: vi.fn(),
  listProjects: vi.fn(),
  getProject: vi.fn(),
  ProjectConflictError: class ProjectConflictError extends Error {},
  PROJECT_TEMPLATES: {},
}));
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: vi.fn() } }));
vi.mock("@/lib/studio/workspace-recovery", () => ({
  provisionWorkspaceForProject: vi.fn(),
}));
vi.mock("@/lib/terminal-internal-client", () => ({
  isSandboxExecutionAvailable: vi.fn(async () => false),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { listProjects } from "@/lib/projects/project-repository";
import { isSandboxExecutionAvailable } from "@/lib/terminal-internal-client";

const mockAuth = vi.mocked(auth);
const mockList = vi.mocked(listProjects);
const mockSandboxAvailable = vi.mocked(isSandboxExecutionAvailable);

const REFUSAL_ERROR =
  'Workspace prepare failed (503): {"error":"Execution is unavailable on this deployment.","code":"HOST_EXECUTION_DISABLED"}';

const project = (over: Record<string, unknown>) =>
  ({
    id: "p1",
    userId: "u1",
    name: "Demo",
    sourceType: "github",
    workspaceStatus: "failed",
    workspaceError: REFUSAL_ERROR,
    runtimeStatus: "stopped",
    updatedAt: new Date().toISOString(),
    ...over,
  }) as never;

const listResult = (projects: unknown[]) =>
  ({ projects, legacyOnly: [] }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "u1" } as never);
  mockSandboxAvailable.mockResolvedValue(false);
});

describe("GET /api/studio-projects — sandboxAvailable", () => {
  it("probes once and reports true when a repo-backed failed project exists and the sandbox is available", async () => {
    mockList.mockResolvedValue(listResult([project({})]));
    mockSandboxAvailable.mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio-projects"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sandboxAvailable).toBe(true);
    expect(body.projects).toHaveLength(1);
    expect(mockSandboxAvailable).toHaveBeenCalledTimes(1);
    expect(mockSandboxAvailable).toHaveBeenCalledWith("u1");
  });

  it("reports false when the probe says the sandbox is not available", async () => {
    mockList.mockResolvedValue(listResult([project({})]));

    const res = await GET(new NextRequest("http://localhost/api/studio-projects"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sandboxAvailable).toBe(false);
    expect(mockSandboxAvailable).toHaveBeenCalledTimes(1);
  });

  it("does NOT probe when no project matches the refusal shape", async () => {
    mockList.mockResolvedValue(
      listResult([
        project({ id: "p-ready", workspaceStatus: "ready", workspaceError: null }),
        project({ id: "p-blank", sourceType: "blank", workspaceStatus: "failed", workspaceError: "boom" }),
      ]),
    );
    mockSandboxAvailable.mockResolvedValue(true);

    const res = await GET(new NextRequest("http://localhost/api/studio-projects"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sandboxAvailable).toBe(false);
    expect(mockSandboxAvailable).not.toHaveBeenCalled();
  });

  it("a throwing probe still returns the list, failed closed", async () => {
    mockList.mockResolvedValue(listResult([project({})]));
    mockSandboxAvailable.mockRejectedValue(new Error("terminal unreachable"));

    const res = await GET(new NextRequest("http://localhost/api/studio-projects"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sandboxAvailable).toBe(false);
    expect(body.projects).toHaveLength(1);
  });

  it("rejects unauthenticated requests without listing or probing", async () => {
    mockAuth.mockResolvedValue({ userId: null } as never);

    const res = await GET(new NextRequest("http://localhost/api/studio-projects"));

    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockSandboxAvailable).not.toHaveBeenCalled();
  });
});
