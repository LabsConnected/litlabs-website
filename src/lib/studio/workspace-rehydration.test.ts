import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock server-only to allow test execution
vi.mock("server-only", () => ({}));

vi.mock("@/lib/terminal-auth", () => ({
  createTerminalToken: vi.fn(() => ({ token: "term-token", expiresAt: Date.now() + 60000 })),
}));

vi.mock("@/lib/terminal-config", () => ({
  requireTerminalBaseUrl: vi.fn(() => "https://terminal.test"),
}));

vi.mock("@/lib/deployments/deployment-store", () => ({
  findLatestDeploymentForProject: vi.fn(),
  findLatestReadyDeploymentForProject: vi.fn(),
  readDeploymentSnapshotFiles: vi.fn(),
}));

import { restoreWorkspaceFromLatestDeployment } from "@/lib/studio/workspace-rehydration";
import {
  findLatestDeploymentForProject,
  findLatestReadyDeploymentForProject,
  readDeploymentSnapshotFiles,
} from "@/lib/deployments/deployment-store";

const findAnyMock = vi.mocked(findLatestDeploymentForProject);
const findReadyMock = vi.mocked(findLatestReadyDeploymentForProject);
const readSnapshotMock = vi.mocked(readDeploymentSnapshotFiles);

const ARGS = { projectId: "proj-1", userId: "user-1", workspaceId: "ws-1" };

function record(id: string, fileCount = 0) {
  return { id, fileCount } as never;
}

interface WriteCall {
  path: string;
  content: string;
  encoding: string;
}

let writes: WriteCall[] = [];
let writeStatus = 200;

function stubFetch() {
  writes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string | URL | Request, opts?: RequestInit) => {
      writes.push(JSON.parse(String(opts?.body ?? "{}")) as WriteCall);
      return new Response(JSON.stringify({ ok: writeStatus < 300 }), { status: writeStatus });
    }),
  );
}

describe("restoreWorkspaceFromLatestDeployment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeStatus = 200;
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no-deployments for a project that has never deployed (scaffold is correct)", async () => {
    findAnyMock.mockResolvedValue(null);

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome).toEqual({ kind: "no-deployments" });
    expect(findReadyMock).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it("returns content-loss when deployments exist but none is ready", async () => {
    findAnyMock.mockResolvedValue(record("dep-old"));
    findReadyMock.mockResolvedValue(null);

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome.kind).toBe("content-loss");
    if (outcome.kind === "content-loss") {
      expect(outcome.survivingDeploymentId).toBe("dep-old");
    }
    expect(writes).toHaveLength(0);
  });

  it("restores every snapshot file — nested paths and stored encodings win", async () => {
    findAnyMock.mockResolvedValue(record("dep-1", 3));
    findReadyMock.mockResolvedValue(record("dep-1", 3));
    readSnapshotMock.mockResolvedValue([
      { path: "index.html", content: "<html>Grand Haven Roofing</html>", contentType: "text/html", encoding: "utf-8" },
      { path: "assets/images/team.jpg", content: "aGVsbG8=", contentType: "image/jpeg", encoding: "base64" },
      // Legacy row: no encoding column — content type decides (text → utf-8).
      { path: "assets/site.css", content: "body{}", contentType: "text/css", encoding: null },
    ] as never);

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome).toEqual({ kind: "restored", deploymentId: "dep-1", fileCount: 3 });
    expect(writes).toEqual([
      { path: "index.html", content: "<html>Grand Haven Roofing</html>", encoding: "utf-8" },
      { path: "assets/images/team.jpg", content: "aGVsbG8=", encoding: "base64" },
      { path: "assets/site.css", content: "body{}", encoding: "utf-8" },
    ]);
  });

  it("returns content-loss when the ready snapshot reads back null or empty", async () => {
    findAnyMock.mockResolvedValue(record("dep-1", 2));
    findReadyMock.mockResolvedValue(record("dep-1", 2));

    readSnapshotMock.mockResolvedValue(null);
    let outcome = await restoreWorkspaceFromLatestDeployment(ARGS);
    expect(outcome.kind).toBe("content-loss");
    if (outcome.kind === "content-loss") expect(outcome.survivingDeploymentId).toBe("dep-1");

    readSnapshotMock.mockResolvedValue([] as never);
    outcome = await restoreWorkspaceFromLatestDeployment(ARGS);
    expect(outcome.kind).toBe("content-loss");
    expect(writes).toHaveLength(0);
  });

  it("refuses a partial restore when the snapshot is shorter than the record's fileCount", async () => {
    findAnyMock.mockResolvedValue(record("dep-1", 5));
    findReadyMock.mockResolvedValue(record("dep-1", 5));
    readSnapshotMock.mockResolvedValue([
      { path: "index.html", content: "<html/>", contentType: "text/html", encoding: "utf-8" },
      { path: "app.js", content: "1", contentType: "text/javascript", encoding: "utf-8" },
    ] as never);

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome.kind).toBe("content-loss");
    if (outcome.kind === "content-loss") {
      expect(outcome.survivingDeploymentId).toBe("dep-1");
      expect(outcome.reason).toContain("incomplete");
    }
    // No partial writes: a half-restored site must never ship silently.
    expect(writes).toHaveLength(0);
  });

  it("returns content-loss when a workspace write fails", async () => {
    findAnyMock.mockResolvedValue(record("dep-1", 1));
    findReadyMock.mockResolvedValue(record("dep-1", 1));
    readSnapshotMock.mockResolvedValue([
      { path: "index.html", content: "<html/>", contentType: "text/html", encoding: "utf-8" },
    ] as never);
    writeStatus = 500;

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome.kind).toBe("content-loss");
    if (outcome.kind === "content-loss") {
      expect(outcome.survivingDeploymentId).toBe("dep-1");
      expect(outcome.reason).toContain("Workspace write failed");
    }
  });

  it("skips snapshot paths that would escape the workspace", async () => {
    findAnyMock.mockResolvedValue(record("dep-1", 2));
    findReadyMock.mockResolvedValue(record("dep-1", 2));
    readSnapshotMock.mockResolvedValue([
      { path: "../evil.txt", content: "x", contentType: "text/plain", encoding: "utf-8" },
      { path: "index.html", content: "<html/>", contentType: "text/html", encoding: "utf-8" },
    ] as never);

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome).toEqual({ kind: "restored", deploymentId: "dep-1", fileCount: 1 });
    expect(writes).toEqual([{ path: "index.html", content: "<html/>", encoding: "utf-8" }]);
  });

  it("never throws when the store fails — the verdict is content-loss", async () => {
    findAnyMock.mockResolvedValue(record("dep-1"));
    findReadyMock.mockRejectedValue(new Error("store down"));

    const outcome = await restoreWorkspaceFromLatestDeployment(ARGS);

    expect(outcome.kind).toBe("content-loss");
    if (outcome.kind === "content-loss") {
      // The catch-path fallback still names the newest surviving deployment.
      expect(outcome.survivingDeploymentId).toBe("dep-1");
    }
  });
});
