/**
 * GET /sites/[deploymentId]/[...path] — LiTT form deploymentId injection.
 *
 * Static exports render LiTT forms with an empty `deploymentId` hidden
 * input (the id doesn't exist until the deploy is created). At serve
 * time the id is known from the URL, so the route fills it in for any
 * HTML page carrying a LiTT form — the form backend resolves the site
 * owner from this id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/deployments/deployment-store", () => ({
  readPublishedFile: vi.fn(),
}));
vi.mock("@/lib/deployments/user-deployment", () => ({
  deploymentPublicPath: vi.fn((_id: string, p: string) => p || "index.html"),
}));

import { GET } from "./route";
import { readPublishedFile } from "@/lib/deployments/deployment-store";

const mockRead = vi.mocked(readPublishedFile);

const FORM_HTML = `<!DOCTYPE html><html><body>
<form action="/api/forms/submit" method="post" data-litt-form="1">
<input type="hidden" name="deploymentId" value="" />
<input name="email" />
</form></body></html>`;

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sites route — form deploymentId injection", () => {
  it("fills the empty deploymentId input for HTML pages with a LiTT form", async () => {
    mockRead.mockResolvedValue({ content: FORM_HTML, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('name="deploymentId" value="dep_abc123"');
    expect(text).not.toContain('name="deploymentId" value=""');
  });

  it("leaves HTML without a LiTT form untouched", async () => {
    const plain = "<!DOCTYPE html><html><body><p>Hello</p></body></html>";
    mockRead.mockResolvedValue({ content: plain, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toBe(plain);
  });

  it("does not inject when the form already carries a deployment id", async () => {
    const filled = FORM_HTML.replace('value=""', 'value="dep_other"');
    mockRead.mockResolvedValue({ content: filled, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toContain('value="dep_other"');
    expect(text).not.toContain('value="dep_abc123"');
  });
});
