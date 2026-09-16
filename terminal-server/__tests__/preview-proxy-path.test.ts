import { describe, expect, it } from "vitest";
import {
  previewTargetPath,
  rewritePreviewDocument,
} from "../preview/proxy-path";

describe("workspace preview proxy URL normalization", () => {
  it("strips the mount and access token before forwarding", () => {
    expect(previewTargetPath("/preview/ws-1/?token=secret&studioRefresh=2", "ws-1"))
      .toBe("/?studioRefresh=2");
    expect(previewTargetPath("/preview/ws-1/_next/app.css?token=secret", "ws-1"))
      .toBe("/_next/app.css");
  });

  it("scopes explicit HTML resources and navigation without touching prose", () => {
    const html = '<a href="/menu">Menu</a><img src="/hero.png"><style>.hero{background:url("/hero.png")}</style><script>const x = "url(/leave-me)"</script><p>JSON {"href":"/do-not-guess"}</p>';
    const rewritten = rewritePreviewDocument(html, "ws-1", "text/html");
    expect(rewritten).toContain('href="/preview/ws-1/menu"');
    expect(rewritten).toContain('src="/preview/ws-1/hero.png"');
    expect(rewritten).toContain('url("/preview/ws-1/hero.png")');
    expect(rewritten).toContain('"url(/leave-me)"');
    expect(rewritten).toContain('{"href":"/do-not-guess"}');
  });

  it("scopes CSS assets but leaves JavaScript content unsupported", () => {
    expect(rewritePreviewDocument(".hero{background:url('/hero.png')}", "ws-1", "text/css"))
      .toContain("url('/preview/ws-1/hero.png')");
    expect(rewritePreviewDocument("fetch('/api/data')", "ws-1", "application/javascript"))
      .toBe("fetch('/api/data')");
  });
});
