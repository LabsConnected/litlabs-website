import { describe, expect, it } from "vitest";
import {
  browserProxyUrl,
  buildProxyBootstrapScript,
  buildProxyErrorPage,
  buildProxyResponseHeaders,
  injectProxyBootstrap,
  isHtmlContentType,
  PROXIED_DOCUMENT_CSP,
} from "./browser-proxy";

describe("browserProxyUrl", () => {
  it("builds a same-origin proxy URL with the target encoded", () => {
    expect(browserProxyUrl("https://example.com/a?b=1&c=2")).toBe(
      "/api/studio/browser/proxy?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1%26c%3D2",
    );
  });
});

describe("isHtmlContentType", () => {
  it("matches html and xhtml, rejects other types", () => {
    expect(isHtmlContentType("text/html; charset=utf-8")).toBe(true);
    expect(isHtmlContentType("application/xhtml+xml")).toBe(true);
    expect(isHtmlContentType("image/png")).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
    expect(isHtmlContentType(undefined)).toBe(false);
  });
});

describe("buildProxyBootstrapScript", () => {
  it("announces the landing URL and routes clicks through the proxy path", () => {
    const script = buildProxyBootstrapScript("https://example.com/final");
    expect(script).toContain('"https://example.com/final"');
    expect(script).toContain("/api/studio/browser/proxy");
    expect(script).toContain("post('landed', TARGET)");
    expect(script).toContain("post('navigate', abs)");
    expect(script).toContain('"litt-browser"');
  });

  it("never navigates the frame itself: clicks and GET submits only report 'navigate' to the panel", () => {
    // Round 3: the proxied document runs in an opaque origin (CSP
    // sandbox without allow-same-origin), so a self-navigation goes
    // out as a cross-site request, the SameSite=Lax session cookies
    // are withheld, and the auth-gated proxy's answer is a page the
    // frame must refuse. The bootstrap must therefore contain no
    // self-navigation assignment at all — the panel drives the load
    // from the 'navigate' message, parent-side.
    const script = buildProxyBootstrapScript(
      "https://example.com/final",
      "https://app.litlabs.net",
    );
    expect(script).not.toContain("location.href");
    expect(script).not.toContain("location.assign");
    expect(script).not.toContain("location.replace");
    // Link clicks and GET form submits still report their target.
    expect(script).toContain("post('navigate', abs)");
    expect(script).toContain("post('navigate', dest)");
    // And the escape hatches are unchanged: _blank links and POST
    // forms are reported as external, never navigated in-frame.
    expect(script).toContain("post('external', abs)");
    expect(script).toContain("post('external', action)");
  });

  it("uses an absolute proxy URL when the app origin is supplied", () => {
    // The injected <base href="<target URL>"> would resolve a
    // root-relative proxy URL against the target origin — the
    // bootstrap must navigate the frame on OUR origin instead.
    const script = buildProxyBootstrapScript("https://example.com/final", "https://app.litlabs.net");
    expect(script).toContain('var PROXY = "https://app.litlabs.net/api/studio/browser/proxy"');
    expect(script).not.toContain('var PROXY = "/api/studio/browser/proxy"');
  });

  it("tolerates a trailing slash on the supplied origin", () => {
    const script = buildProxyBootstrapScript("https://example.com/final", "https://app.litlabs.net/");
    expect(script).toContain('var PROXY = "https://app.litlabs.net/api/studio/browser/proxy"');
  });

  it("falls back to the root-relative proxy path when no origin is supplied", () => {
    const script = buildProxyBootstrapScript("https://example.com/final");
    expect(script).toContain('var PROXY = "/api/studio/browser/proxy"');
  });

  it("cannot be broken out of by a URL containing a script close tag", () => {
    const script = buildProxyBootstrapScript("https://example.com/</script><script>alert(1)</script>");
    // Only the wrapper's own closing tag may appear literally.
    expect(script.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("injectProxyBootstrap", () => {
  it("injects base + bootstrap right after <head> and drops the page's own base and meta CSP", () => {
    const html =
      '<html><head><base href="https://old.example/"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><title>t</title></head><body>hi</body></html>';
    const out = injectProxyBootstrap(html, "https://example.com/page");
    expect(out).toContain('<base href="https://example.com/page">');
    expect(out).not.toContain("old.example");
    expect(out).not.toContain("Content-Security-Policy");
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<title>"));
    expect(out).toContain("post('landed', TARGET)");
  });

  it("threads the app origin into the bootstrap so in-page navigation stays on the proxy", () => {
    const out = injectProxyBootstrap(
      "<html><head><title>t</title></head><body>hi</body></html>",
      "https://example.com/page",
      "https://app.litlabs.net",
    );
    expect(out).toContain('var PROXY = "https://app.litlabs.net/api/studio/browser/proxy"');
    expect(out).toContain('<base href="https://example.com/page">');
  });

  it("creates a head when the document has none", () => {
    const out = injectProxyBootstrap("<html><body>hi</body></html>", "https://example.com/");
    expect(out).toContain("<head><base href=\"https://example.com/\">");
  });

  it("prepends when there is no html element at all", () => {
    const out = injectProxyBootstrap("<p>fragment</p>", "https://example.com/");
    expect(out.startsWith('<base href="https://example.com/">')).toBe(true);
    expect(out).toContain("<p>fragment</p>");
  });
});

describe("buildProxyResponseHeaders", () => {
  it("strips framing refusals and target cookies, stamps the sandbox CSP", () => {
    const upstream = new Headers({
      "content-type": "text/html; charset=utf-8",
      "x-frame-options": "SAMEORIGIN",
      "content-security-policy": "frame-ancestors 'none'",
      "set-cookie": "session=abc; Path=/",
      "strict-transport-security": "max-age=63072000",
      "content-length": "1234",
      "x-custom": "kept",
    });
    const out = buildProxyResponseHeaders(upstream);
    expect(out.get("x-frame-options")).toBeNull();
    expect(out.get("set-cookie")).toBeNull();
    expect(out.get("strict-transport-security")).toBeNull();
    expect(out.get("content-length")).toBeNull();
    expect(out.get("content-security-policy")).toBe(PROXIED_DOCUMENT_CSP);
    expect(out.get("content-type")).toBe("text/html; charset=utf-8");
    expect(out.get("x-custom")).toBe("kept");
    expect(out.get("cache-control")).toBe("no-store");
  });
});

describe("buildProxyErrorPage", () => {
  it("renders a self-contained Studio error document", () => {
    const html = buildProxyErrorPage({
      title: "This address can't be shown",
      message: "Blocked by the Studio browser's security policy: typosquat.",
      url: "https://g00gle.com/",
    });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("LiTT Studio Browser");
    expect(html).toContain("This address can&#39;t be shown");
    expect(html).toContain("g00gle.com");
    expect(html).toContain('href="https://g00gle.com/"');
    expect(html).toContain('target="_blank"');
    // No external resources — the document must render inside the
    // sandboxed iframe with no network fetches of its own.
    expect(html).not.toMatch(/<script|<link|src=|@import|url\(/);
  });

  it("escapes HTML in every interpolated field", () => {
    const html = buildProxyErrorPage({
      title: '<img src=x onerror=alert(1)>',
      message: '"><script>alert(2)</script>',
      url: 'https://evil.example/"<script>',
      hint: "<b>hint</b>",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;hint&lt;/b&gt;");
  });

  it("only renders the open-externally link for plain http(s) URLs", () => {
    const safe = buildProxyErrorPage({
      title: "t",
      message: "m",
      url: "https://example.com/",
    });
    expect(safe).toContain('href="https://example.com/"');

    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "not a url"]) {
      const html = buildProxyErrorPage({ title: "t", message: "m", url: bad });
      // Shown as inert text, never as a clickable link.
      expect(html).not.toContain("<a ");
      expect(html).toContain(bad);
    }
  });
});
