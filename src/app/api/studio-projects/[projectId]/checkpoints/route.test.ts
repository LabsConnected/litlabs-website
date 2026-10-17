import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class FakeProjectVerificationError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
      this.name = "ProjectVerificationError";
    }
  }
  return {
    userId: "user-b" as string | null,
    verifyError: null as Error | null,
    FakeProjectVerificationError,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: mocks.userId, clerkId: mocks.userId })),
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(async () => null),
  verifyProjectWorkspace: vi.fn(async () => {
    if (mocks.verifyError) throw mocks.verifyError;
    return {
      project: { id: "p1", userId: "user-b" },
      workspaceId: "ws-1",
      workspaceRoot: "/work",
    };
  }),
  ProjectVerificationError: mocks.FakeProjectVerificationError,
}));

vi.mock("@/lib/missions/mission-repository", () => ({
  listCheckpoints: vi.fn(async () => []),
  createCheckpoint: vi.fn(),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: () => "http://terminal.internal",
  terminalNotConfiguredResponse: () => null,
}));

import { POST } from "./route";

function req() {
  return new NextRequest(
    "https://staging.example/api/studio-projects/p1/checkpoints",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "user-b-injected-checkpoint" }),
    },
  );
}

const params = { params: Promise.resolve({ projectId: "p1" }) };

describe("POST /api/studio-projects/:id/checkpoints status mapping", () => {
  beforeEach(() => {
    mocks.userId = "user-b";
    mocks.verifyError = null;
  });

  it("returns 404 — not 500 — when the project is foreign or missing", async () => {
    mocks.verifyError = new mocks.FakeProjectVerificationError(
      "Project not found",
      "PROJECT_NOT_FOUND",
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("returns 404 for a forbidden project", async () => {
    mocks.verifyError = new mocks.FakeProjectVerificationError(
      "Forbidden",
      "FORBIDDEN",
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(404);
  });

  it("returns 409 when the workspace is not ready", async () => {
    mocks.verifyError = new mocks.FakeProjectVerificationError(
      "Workspace not ready",
      "WORKSPACE_NOT_READY",
    );
    const res = await POST(req(), params);
    expect(res.status).toBe(409);
  });

  it("returns 500 for unrelated failures", async () => {
    mocks.verifyError = new Error("terminal exploded");
    const res = await POST(req(), params);
    expect(res.status).toBe(500);
  });
});
