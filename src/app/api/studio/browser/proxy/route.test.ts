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

  // ─── Error documents: Studio-native HTML, never raw JSON ──────
  describe("error documents", () => {
    it("serves a styled HTML error page for policy blocks", async () => {
      const res = await GET(req("?url=https://g00gle.com/"));
      expect(res.status).toBe(403);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("LiTT Studio Browser");
      expect(body).toContain("can&#39;t be shown");
      expect(body).toContain("g00gle.com");
      expect(body).not.toContain('"error"'); // no raw JSON
      expect(res.headers.get("content-security-policy")).toContain("sandbox");
    });

    it("serves HTML for unreachable upstreams and missing url", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      const down = await GET(req("?url=https://down.example.com/"));
      expect(down.status).toBe(502);
      expect(down.headers.get("content-type")).toContain("text/html");
      expect(await down.text()).toContain("could not be reached");

      const missing = await GET(req(""));
      expect(missing.status).toBe(400);
      expect(missing.headers.get("content-type")).toContain("text/html");
    });

    it("HTML-escapes the attempted URL in the error page", async () => {
      // A policy-blocked URL containing markup must appear escaped in
      // the error document, never as live HTML.
      const res = await GET(
        req(`?url=${encodeURIComponent("https://g00gle.com/<script>alert(1)</script>")}`),
      );
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).not.toContain("<script>alert(1)</script>");
      expect(body).toContain("&lt;script&gt;");
    });
  });

  // ─── Redirect validation: every hop passes the URL policy ──────
  describe("redirect handling", () => {
    it("follows allowed redirects and serves the final document", async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/final" },
          }),
        )
        .mockResolvedValueOnce(
          new Response("<html><body>landed</body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
        );
      const res = await GET(req("?url=https://example.com/start"));
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/start");
      expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/final");
      const body = await res.text();
      expect(body).toContain("landed");
      expect(body).toContain('<base href="https://example.com/final">');
    });

    it("blocks a redirect into a policy-denied host", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
      );
      const res = await GET(req("?url=https://example.com/"));
      expect(res.status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1); // blocked hop never fetched
      const body = await res.text();
      expect(body).toContain("security policy");
    });

    it("blocks a redirect into a phishing host", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://g00gle.com/" },
        }),
      );
      const res = await GET(req("?url=https://example.com/"));
      expect(res.status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("resolves relative redirect locations against the current URL", async () => {
      fetchMock
        .mockResolvedValueOnce(
          new Response(null, { status: 307, headers: { location: "/next" } }),
        )
        .mockResolvedValueOnce(
          new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
        );
      const res = await GET(req("?url=https://example.com/a/b"));
      expect(res.status).toBe(200);
      expect(fetchMock.mock.calls[1][0]).toBe("https://example.com/next");
    });

    it("gives up after too many redirects", async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "https://example.com/loop" },
          }),
        ),
      );
      const res = await GET(req("?url=https://example.com/"));
      expect(res.status).toBe(508);
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(7);
      expect(await res.text()).toContain("Too many redirects");
    });
  });
});
