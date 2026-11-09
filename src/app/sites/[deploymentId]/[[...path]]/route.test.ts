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
vi.mock("@/lib/deployments/user-deployment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/deployments/user-deployment")>()),
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
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('name="deploymentId" value="dep_abc123"');
    expect(text).not.toContain('name="deploymentId" value=""');
  });

  it("injects the Built with LiTT badge into HTML pages", async () => {
    const plain = "<!DOCTYPE html><html><body><p>Hello</p></body></html>";
    mockRead.mockResolvedValue({ content: plain, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toContain('id="litt-badge"');
    expect(text).toContain("Built with LiTT");
  });

  it("does not inject the badge when data-litt-badge=\"0\" is present", async () => {
    const optedOut = '<!DOCTYPE html><html><body data-litt-badge="0"><p>Hello</p></body></html>';
    mockRead.mockResolvedValue({ content: optedOut, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toBe(optedOut);
    expect(text).not.toContain('id="litt-badge"');
  });

  it("injects the badge with uppercase or spaced </body> tags", async () => {
    const upper = "<!DOCTYPE html><html><body><p>Hello</p></BODY></html>";
    mockRead.mockResolvedValue({ content: upper, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toContain('id="litt-badge"');
  });

  it("does not inject when the form already carries a deployment id", async () => {
    const filled = FORM_HTML.replace('value=""', 'value="dep_other"');
    mockRead.mockResolvedValue({ content: filled, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toContain('value="dep_other"');
    expect(text).not.toContain('value="dep_abc123"');
  });

  it("serves base64-stored binary artifacts as decoded bytes", async () => {
    // Binary artifacts (images/fonts) are stored base64 in the text-shaped
    // files table; the route must decode before serving or images corrupt.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockRead.mockResolvedValue({
      content: png.toString("base64"),
      contentType: "image/png",
    });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(png);
  });

  it("decodes on the explicit encoding column, not just content type", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    mockRead.mockResolvedValue({
      content: jpeg.toString("base64"),
      contentType: "image/jpeg",
      encoding: "base64",
    });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(jpeg);
  });

  it("answers a store error with 503 + Retry-After (propagation hint)", async () => {
    // Freshly deployed assets blip ~1s while file rows settle; the 503
    // tells an automated verifier to come back rather than record a
    // permanent "broken image" (staging acceptance 42447010290).
    mockRead.mockRejectedValue(new Error("PostgREST blip"));
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("1");
  });

  it("serves encoding=utf-8 rows verbatim even under a binary content type", async () => {
    // The stored encoding is authoritative — an explicit utf-8 row is text,
    // never base64-decoded.
    mockRead.mockResolvedValue({
      content: "plain stored text",
      contentType: "image/png",
      encoding: "utf-8",
    });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(await res.text()).toBe("plain stored text");
  });
});

describe("sites route — <base> injection for relative asset resolution", () => {
  // Regression: staging acceptance 42693622298 — deployed markup references
  // assets relatively (assets/images/x); at the slash-less URL "/sites/{id}"
  // the browser resolves them to "/sites/assets/images/x" — "assets" is then
  // parsed as a deploymentId and every asset request failed while
  // index.html itself served 200. A redirect cannot fix this (Next.js
  // trailing-slash normalization strips "/" upstream → redirect loop; and
  // rebuilding the target from request.url leaked https://0.0.0.0:8080,
  // failing the deploy verifier's fetch — acceptance 42704026836). The
  // route instead injects <base> so relative refs resolve against the
  // artifact's real directory under every URL form.
  const HEAD_HTML = `<!DOCTYPE html><html><head><title>t</title></head><body><img src="assets/images/x.jpeg"></body></html>`;

  it("serves the slash-less root with 200 + <base>, never a redirect", async () => {
    mockRead.mockResolvedValue({ content: HEAD_HTML, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    const text = await res.text();
    expect(text).toContain('<base href="/sites/dep_abc123/">');
    expect(text.indexOf("<base")).toBeLessThan(text.indexOf("<img"));
  });

  it("serves the trailing-slash root identically (no redirect loop)", async () => {
    mockRead.mockResolvedValue({ content: HEAD_HTML, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/"), {
      params: Promise.resolve({ deploymentId: "dep_abc123", path: [] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain('<base href="/sites/dep_abc123/">');
  });

  it("serves explicit index.html with the same deployment-root base", async () => {
    mockRead.mockResolvedValue({ content: HEAD_HTML, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/index.html"), {
      params: Promise.resolve({ deploymentId: "dep_abc123", path: ["index.html"] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(mockRead).toHaveBeenCalledWith("dep_abc123", "index.html");
    expect(await res.text()).toContain('<base href="/sites/dep_abc123/">');
  });

  it("bases nested documents on their own artifact directory", async () => {
    mockRead.mockResolvedValue({ content: HEAD_HTML, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123/guide/index.html"), {
      params: Promise.resolve({ deploymentId: "dep_abc123", path: ["guide", "index.html"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<base href="/sites/dep_abc123/guide/">');
  });

  it("respects an author-supplied <base> tag", async () => {
    const authored = HEAD_HTML.replace("<head>", '<head><base href="/custom/">');
    mockRead.mockResolvedValue({ content: authored, contentType: "text/html" });
    const res = await GET(req("/sites/dep_abc123"), {
      params: Promise.resolve({ deploymentId: "dep_abc123" }),
    });
    const text = await res.text();
    expect(text).toContain('<base href="/custom/">');
    expect(text).not.toContain("/sites/dep_abc123/");
    expect(text.match(/<base/g)).toHaveLength(1);
  });

  it("does not inject <base> into non-HTML artifacts", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    mockRead.mockResolvedValue({
      content: png.toString("base64"),
      contentType: "image/png",
      encoding: "base64",
    });
    const res = await GET(req("/sites/dep_abc123/assets/logo.png"), {
      params: Promise.resolve({ deploymentId: "dep_abc123", path: ["assets", "logo.png"] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});
