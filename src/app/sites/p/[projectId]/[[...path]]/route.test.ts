import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * /sites/p/[projectId] — stable public project URL.
 *
 * The route must resolve the project's newest ready deployment and
 * rewrite internally so the visible URL never changes across republishes.
 */

const { findLatestReadyForProject } = vi.hoisted(() => ({
  findLatestReadyForProject: vi.fn(),
}));
vi.mock("@/lib/deployments/deployment-store", () => ({
  findLatestReadyForProject,
}));

import { GET } from "./route";

function req(url = "https://sites.test/sites/p/proj_1/") {
  return new NextRequest(url);
}

const params = (projectId: string, path?: string[]) =>
  ({ params: Promise.resolve({ projectId, path }) }) as never;

describe("sites/p route — stable project URL", () => {
  beforeEach(() => {
    findLatestReadyForProject.mockReset();
  });

  it("rewrites to the newest ready deployment, preserving the visible URL", async () => {
    findLatestReadyForProject.mockResolvedValue({ id: "dep_9" });
    const res = await GET(req(), params("proj_1"));
    expect(res.status).toBe(200);
    const rewrite = res.headers.get("x-middleware-rewrite");
    expect(rewrite).toBe("https://sites.test/sites/dep_9/");
    // The browser never sees a redirect — the stable URL stays put.
    expect(res.headers.get("location")).toBeNull();
    expect(findLatestReadyForProject).toHaveBeenCalledWith("proj_1");
  });

  it("forwards nested paths to the resolved deployment", async () => {
    findLatestReadyForProject.mockResolvedValue({ id: "dep_9" });
    const res = await GET(
      req("https://sites.test/sites/p/proj_1/assets/logo.png"),
      params("proj_1", ["assets", "logo.png"]),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      "https://sites.test/sites/dep_9/assets/logo.png",
    );
  });

  it("404s when no ready deployment exists for the project", async () => {
    findLatestReadyForProject.mockResolvedValue(null);
    const res = await GET(req(), params("proj_1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rejects malformed project ids without touching the store", async () => {
    const res = await GET(
      req("https://sites.test/sites/p/..%2Fetc/"),
      params("..%2Fetc"),
    );
    expect(res.status).toBe(404);
    expect(findLatestReadyForProject).not.toHaveBeenCalled();
  });

  it("503s on storage errors without leaking internals", async () => {
    findLatestReadyForProject.mockRejectedValue(new Error("pg down"));
    const res = await GET(req(), params("proj_1"));
    expect(res.status).toBe(503);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });
});
