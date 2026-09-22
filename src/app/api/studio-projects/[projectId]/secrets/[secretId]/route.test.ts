/**
 * Project secrets API — DELETE tests.
 *
 * Run: npx vitest run "src/app/api/studio-projects/[projectId]/secrets/[secretId]/route.test.ts"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/terminal-v1/secret-broker", () => ({ SecretBroker: vi.fn() }));
vi.mock("@/lib/terminal-internal-client", () => ({ ensurePreviewEnvInternal: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ rateLimit: vi.fn() }));

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import { SecretBroker } from "@/lib/terminal-v1/secret-broker";
import { ensurePreviewEnvInternal } from "@/lib/terminal-internal-client";
import { rateLimit } from "@/lib/rate-limiter";

const mockAuth = vi.mocked(auth);
const mockGetProject = vi.mocked(getProject);
const MockBroker = vi.mocked(SecretBroker);
const mockEnsureEnv = vi.mocked(ensurePreviewEnvInternal);
const mockRateLimit = vi.mocked(rateLimit);

const USER = "user_123";
const PROJECT = "proj_abc";
const SECRET = "sec-1";
const params = { params: Promise.resolve({ projectId: PROJECT, secretId: SECRET }) };

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/studio-projects/${PROJECT}/secrets/${SECRET}`,
    { method: "DELETE" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: USER, clerkId: "clerk_1" });
  mockGetProject.mockResolvedValue({ id: PROJECT, workspaceId: "ws_1" } as never);
  mockRateLimit.mockResolvedValue({ success: true, remaining: 29, resetTime: 3600 });
  mockEnsureEnv.mockResolvedValue({ restarted: true, status: "ready" });
});

function mockBroker(meta: Record<string, unknown> | null) {
  const del = vi.fn().mockResolvedValue(true);
  MockBroker.mockImplementation(
    () =>
      ({
        getById: vi.fn().mockResolvedValue(meta),
        delete: del,
        resolveForSandbox: vi.fn().mockResolvedValue({}),
      }) as never,
  );
  return del;
}

describe("DELETE", () => {
  it("401s when unauthenticated", async () => {
    mockAuth.mockResolvedValue({ userId: null, clerkId: null });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(401);
  });

  it("404s when the project is not the caller's", async () => {
    mockGetProject.mockResolvedValue(null);
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
  });

  it("429s when rate-limited", async () => {
    mockRateLimit.mockResolvedValue({ success: false, remaining: 0, resetTime: 60 });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(429);
  });

  it("404s when the secret does not exist", async () => {
    const del = mockBroker(null);
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });

  it("404s when the secret belongs to a different project — never deletes it", async () => {
    const del = mockBroker({
      secretId: SECRET,
      userId: USER,
      projectId: "proj_OTHER",
      name: "CLERK_SECRET_KEY",
    });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes an owned project secret and nudges the preview", async () => {
    const del = mockBroker({
      secretId: SECRET,
      userId: USER,
      projectId: PROJECT,
      name: "CLERK_SECRET_KEY",
    });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith(SECRET, USER);
    expect(mockEnsureEnv).toHaveBeenCalledWith("ws_1", USER, {});
    const payload = (await res.json()) as { deleted: boolean; previewRestarted: boolean };
    expect(payload).toEqual({ deleted: true, previewRestarted: true });
  });
});
