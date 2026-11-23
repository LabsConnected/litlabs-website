import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * GET /api/studio-projects/[projectId]/deployments — ACC-01 F8a: the
 * response carries the project's ONE stable public address when the
 * LiTT Hosting deployment is live, so the Deploy surface can present
 * an address that does not rotate on every publish. Per-deployment
 * records keep their immutable snapshot URLs.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/project-repository", () => ({ getProject: vi.fn() }));
vi.mock("@/lib/deployments/deployment-store", () => ({
  findLatestDeploymentForProject: vi.fn(),
  findLatestDeploymentForProjectTarget: vi.fn(),
  listDeploymentHistoryForProject: vi.fn(),
}));
vi.mock("@/lib/netlify-connection", () => ({ getNetlifyConnection: vi.fn() }));

import { GET } from "./route";
import { auth } from "@/lib/auth";
import { getProject } from "@/lib/projects/project-repository";
import {
  findLatestDeploymentForProject,
  findLatestDeploymentForProjectTarget,
  listDeploymentHistoryForProject,
} from "@/lib/deployments/deployment-store";
import { getNetlifyConnection } from "@/lib/netlify-connection";

const authMock = vi.mocked(auth);
const getProjectMock = vi.mocked(getProject);
const latestMock = vi.mocked(findLatestDeploymentForProject);
const byTargetMock = vi.mocked(findLatestDeploymentForProjectTarget);
const historyMock = vi.mocked(listDeploymentHistoryForProject);

const READY_DEP = {
  id: "dep-2",
  userId: "user-1",
  projectId: "proj-1",
  workspaceId: "ws-1",
  status: "ready",
  target: "litt-static",
  publicUrl: "https://example.litt.host/sites/dep-2/",
  urlVerified: true,
  fileCount: 7,
  totalBytes: 2048,
  contentHash: "def",
  errorClass: null,
  errorMessage: null,
  externalSiteId: null,
  createdAt: "2026-11-23T16:44:01.000Z",
  updatedAt: "2026-11-23T16:44:01.000Z",
};

function makeRequest(): NextRequest {
  return new NextRequest("https://test.local/api/studio-projects/proj-1/deployments");
}

const PREV_ENV = process.env.DEPLOY_PRODUCTION_URL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DEPLOY_PRODUCTION_URL = "https://hosting.example.test";
  authMock.mockResolvedValue({ userId: "user-1" } as never);
  getProjectMock.mockResolvedValue({
    id: "proj-1",
    workspaceStatus: "ready",
    runtimeStatus: "idle",
    workspaceError: null,
    runtimeError: null,
    previewUrl: null,
    updatedAt: "2026-11-23T16:00:00.000Z",
  } as never);
  latestMock.mockResolvedValue(READY_DEP as never);
  byTargetMock.mockImplementation(async (_p: string, _u: string, target: string) =>
    (target === "litt-static" ? READY_DEP : null) as never,
  );
  historyMock.mockResolvedValue([READY_DEP] as never);
  vi.mocked(getNetlifyConnection).mockResolvedValue(null as never);
});

afterEach(() => {
  if (PREV_ENV === undefined) delete process.env.DEPLOY_PRODUCTION_URL;
  else process.env.DEPLOY_PRODUCTION_URL = PREV_ENV;
});

describe("GET deployments — stable public URL (F8a)", () => {
  it("exposes the stable project URL when the LiTT deployment is live", async () => {
    const res = await GET(makeRequest(), { params: Promise.resolve({ projectId: "proj-1" }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.stablePublicUrl).toBe("https://hosting.example.test/sites/project/proj-1/");
    // Snapshot URLs stay on their records (history + per-target latest).
    expect(data.latestByTarget["litt-static"].publicUrl).toBe(
      "https://example.litt.host/sites/dep-2/",
    );
    expect(data.history[0].publicUrl).toBe("https://example.litt.host/sites/dep-2/");
  });

  it("omits the stable URL when nothing is live", async () => {
    latestMock.mockResolvedValue(null as never);
    byTargetMock.mockResolvedValue(null as never);
    historyMock.mockResolvedValue([] as never);
    const res = await GET(makeRequest(), { params: Promise.resolve({ projectId: "proj-1" }) });
    const data = await res.json();
    expect(data.stablePublicUrl).toBeNull();
  });

  it("omits the stable URL when the latest LiTT deployment is ready but unverified", async () => {
    byTargetMock.mockImplementation(async (_p: string, _u: string, target: string) =>
      (target === "litt-static" ? { ...READY_DEP, urlVerified: false } : null) as never,
    );
    const res = await GET(makeRequest(), { params: Promise.resolve({ projectId: "proj-1" }) });
    const data = await res.json();
    expect(data.stablePublicUrl).toBeNull();
  });
});
