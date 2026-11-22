// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { GET } from "./route";

function req(query: string) {
  return new NextRequest(`https://app.litlabs.net/api/studio/browser/proxy${query}`);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user-1" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("GET /api/studio/browser/proxy", () => {
  it("rejects unauthenticated requests", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await GET(req("?url=https://example.com"));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a url parameter", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses policy-blocked targets without fetching them", async () => {
    const res = await GET(req("?url=http://169.254.169.254/latest/meta-data"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();

    const local = await GET(req("?url=http://localhost:3000/admin"));
    expect(local.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves HTML with framing headers stripped, sandbox CSP stamped, and the bootstrap injected", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html><head><title>x</title></head><body>hello</body></html>", {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "x-frame-options": "DENY",
          "content-security-policy": "frame-ancestors 'none'",
          "set-cookie": "sid=1; Path=/",
        },
      }),
    );
    const res = await GET(req("?url=https://example.com/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    const body = await res.text();
    expect(body).toContain('<base href="https://example.com/">');
    expect(body).toContain("post('landed', TARGET)");
    expect(body).toContain("hello");
  });

  it("injects the bootstrap with an absolute proxy URL on the request's own origin", async () => {
    // Regression (2026-11-22): with a root-relative proxy URL, the
    // injected <base href="https://example.com/"> made in-page link
    // clicks resolve the proxy path against the TARGET origin and the
    // frame loaded a framing-blocked page ("This content is blocked").
    fetchMock.mockResolvedValue(
      new Response("<html><head><title>x</title></head><body>hello</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    const res = await GET(req("?url=https://example.com/"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('var PROXY = "https://app.litlabs.net/api/studio/browser/proxy"');
    expect(body).not.toContain('var PROXY = "/api/studio/browser/proxy"');
  });

  it("passes non-HTML responses through with their content type", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png", "x-frame-options": "SAMEORIGIN" },
      }),
    );
    const res = await GET(req("?url=https://example.com/logo.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-frame-options")).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes]).toEqual([137, 80, 78, 71]);
  });

  it("surfaces an unreachable upstream as 502", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await GET(req("?url=https://down.example.com/"));
    expect(res.status).toBe(502);
  });
});
