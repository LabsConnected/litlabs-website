/**
 * GET /sites/project/[projectId]/[...path] — the project's ONE stable
 * public address (ACC-01 F8a).
 *
 * Every publish mints a new per-deployment snapshot URL and the old
 * address serves the old snapshot forever. This route resolves the
 * project's latest READY deployment at request time, so the stable
 * address always serves the newest publish — while the per-deployment
 * route keeps serving its own snapshot.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/deployments/deployment-store", () => ({
  findLatestReadyDeploymentForProjectPublic: vi.fn(),
  readPublishedFile: vi.fn(),
}));
vi.mock("@/lib/deployments/user-deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployments/user-deployment")>()),
  deploymentPublicPath: vi.fn((_id: string, p: string) => p || "index.html"),
}));

import { GET } from "./route";
import {
  findLatestReadyDeploymentForProjectPublic,
  readPublishedFile,
} from "@/lib/deployments/deployment-store";

const mockResolve = vi.mocked(findLatestReadyDeploymentForProjectPublic);
const mockRead = vi.mocked(readPublishedFile);

const PROJECT_ID = "1795e626-73be-4043-9386-a898e3fdea98";
const DEP_1 = "7e762ec2-3f47-4531-9619-2036d78e6e3c";
const DEP_2 = "223cefb2-d519-481b-99f9-80ffa4b5d1d2";

const V1_HTML = "<!DOCTYPE html><html><head></head><body><p>delightful pastries</p></body></html>";
const V2_HTML = "<!DOCTYPE html><html><head></head><body><p>delightful fresh pastries</p></body></html>";

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

function get(projectId: string, path: string[] = []) {
  return GET(req(`/sites/project/${projectId}/`), {
    params: Promise.resolve({ projectId, path }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sites/project route — stable public address", () => {
  it("serves the latest ready deployment's files", async () => {
    mockResolve.mockResolvedValue({ id: DEP_1 } as never);
    mockRead.mockResolvedValue({ content: V1_HTML, contentType: "text/html" });

    const res = await get(PROJECT_ID);
    expect(res.status).toBe(200);
    expect(mockResolve).toHaveBeenCalledWith(PROJECT_ID);
    expect(mockRead).toHaveBeenCalledWith(DEP_1, "index.html");
    const text = await res.text();
    expect(text).toContain("delightful pastries");
  });

  it("serves the NEWER publish after a second publish — the address does not change", async () => {
    // First publish is live at the stable address…
    mockResolve.mockResolvedValue({ id: DEP_1 } as never);
    mockRead.mockResolvedValue({ content: V1_HTML, contentType: "text/html" });
    const first = await get(PROJECT_ID);
    expect(await first.text()).toContain("delightful pastries");
    expect(mockRead).toHaveBeenLastCalledWith(DEP_1, "index.html");

    // …a second publish lands; the SAME stable address now serves it,
    // because resolution follows the latest ready deployment.
    mockResolve.mockResolvedValue({ id: DEP_2 } as never);
    mockRead.mockResolvedValue({ content: V2_HTML, contentType: "text/html" });
    const second = await get(PROJECT_ID);
    const text = await second.text();
    expect(text).toContain("delightful fresh pastries");
    expect(mockRead).toHaveBeenLastCalledWith(DEP_2, "index.html");
  });

  it("answers an honest 404 when the project has no ready deployment", async () => {
    mockResolve.mockResolvedValue(null);
    const res = await get(PROJECT_ID);
    expect(res.status).toBe(404);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("answers 503 (not 404) when the deployment lookup throws — a store outage is not 'never published'", async () => {
    mockResolve.mockRejectedValue(new Error("Latest deployment lookup failed: postgrest down"));
    const res = await get(PROJECT_ID);
    expect(res.status).toBe(503);
    expect(mockRead).not.toHaveBeenCalled();
  });

  it("points the injected <base> at the stable mount so relative assets resolve", async () => {
    mockResolve.mockResolvedValue({ id: DEP_2 } as never);
    mockRead.mockResolvedValue({ content: V2_HTML, contentType: "text/html" });
    const res = await get(PROJECT_ID);
    const text = await res.text();
    expect(text).toContain(`<base href="/sites/project/${PROJECT_ID}/">`);
  });

  it("fills LiTT form deploymentId inputs with the RESOLVED deployment's id", async () => {
    const formHtml = `<!DOCTYPE html><html><body>
<form action="/api/forms/submit" method="post" data-litt-form="1">
<input type="hidden" name="deploymentId" value="" />
</form></body></html>`;
    mockResolve.mockResolvedValue({ id: DEP_2 } as never);
    mockRead.mockResolvedValue({ content: formHtml, contentType: "text/html" });
    const res = await get(PROJECT_ID);
    const text = await res.text();
    expect(text).toContain(`name="deploymentId" value="${DEP_2}"`);
  });

  it("rejects malformed project ids", async () => {
    const res = await get("../etc/passwd");
    expect(res.status).toBe(404);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});
