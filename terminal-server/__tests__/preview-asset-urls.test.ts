/**
 * Regression tests for preview subresource rewriting (2026-09-18).
 *
 * Production defect: a generated <img src="/assets/images/x.jpeg">
 * rendered as alt text inside the Studio preview iframe. Root-relative
 * refs resolve against the terminal host root — escaping the
 * /preview/:workspaceId mount entirely (404) — while relative refs stay
 * in the mount but carry no ?token= (401). The API-level fetch
 * (mount path + token) returned the bytes fine; only the browser's
 * URL resolution was broken.
 *
 * rewritePreviewAssetUrls re-homes every document-local URL inside the
 * mount and merges the preview token into the query. External, data:,
 * protocol-relative, and fragment URLs must pass through untouched.
 */

import { describe, it, expect } from "vitest";

import { rewritePreviewAssetUrls } from "../preview/asset-urls";

const OPTS = { workspaceId: "ws-abc123", token: "tok-9", pagePath: "/" };
const M = "/preview/ws-abc123";

describe("rewritePreviewAssetUrls — root-relative refs re-home under the mount", () => {
  it("rewrites src/href/action/poster attributes", () => {
    const html = `<html><body>
      <img src="/assets/images/puppy.jpeg" alt="puppy" />
      <link href="/styles/site.css" rel="stylesheet" />
      <script src="/_next/static/chunk.js"></script>
      <form action="/submit"><input /></form>
      <video poster="/poster.png"></video>
    </body></html>`;
    const out = rewritePreviewAssetUrls(html, OPTS);
    expect(out).toContain(`src="${M}/assets/images/puppy.jpeg?token=tok-9"`);
    expect(out).toContain(`href="${M}/styles/site.css?token=tok-9"`);
    expect(out).toContain(`src="${M}/_next/static/chunk.js?token=tok-9"`);
    expect(out).toContain(`action="${M}/submit?token=tok-9"`);
    expect(out).toContain(`poster="${M}/poster.png?token=tok-9"`);
  });

  it("merges into an existing query instead of producing two ?", () => {
    const out = rewritePreviewAssetUrls(`<img src="/x.png?v=2">`, OPTS);
    expect(out).toContain(`src="${M}/x.png?v=2&token=tok-9"`);
  });

  it("keeps fragments after the query", () => {
    const out = rewritePreviewAssetUrls(`<a href="/docs/page.html#top">x</a>`, OPTS);
    expect(out).toContain(`href="${M}/docs/page.html?token=tok-9#top"`);
  });
});

describe("rewritePreviewAssetUrls — relative refs resolve against the page", () => {
  it("root page: relative asset resolves at the mount root", () => {
    const out = rewritePreviewAssetUrls(`<img src="assets/images/puppy.jpeg">`, OPTS);
    expect(out).toContain(`src="${M}/assets/images/puppy.jpeg?token=tok-9"`);
  });

  it("nested page: relative asset resolves against the page directory", () => {
    const out = rewritePreviewAssetUrls(
      `<img src="img/photo.png">`,
      { ...OPTS, pagePath: "/about/index.html" },
    );
    expect(out).toContain(`src="${M}/about/img/photo.png?token=tok-9"`);
  });

  it("dot-relative links stay inside the mount", () => {
    const out = rewritePreviewAssetUrls(
      `<a href="../other.html">x</a>`,
      { ...OPTS, pagePath: "/docs/guide.html" },
    );
    expect(out).toContain(`href="${M}/other.html?token=tok-9"`);
  });
});

describe("rewritePreviewAssetUrls — srcset and inline CSS", () => {
  it("rewrites each srcset candidate, preserving descriptors", () => {
    const out = rewritePreviewAssetUrls(
      `<img srcset="/a.png 1x, /b@2x.png 2x">`,
      OPTS,
    );
    expect(out).toContain(
      `srcset="${M}/a.png?token=tok-9 1x, ${M}/b@2x.png?token=tok-9 2x"`,
    );
  });

  it("rewrites root-relative url() in inline styles", () => {
    const out = rewritePreviewAssetUrls(
      `<div style="background:url('/bg.png')"></div>`,
      OPTS,
    );
    expect(out).toContain(`url('${M}/bg.png?token=tok-9')`);
  });
});

describe("rewritePreviewAssetUrls — external and special URLs untouched", () => {
  it("never rewrites absolute, protocol-relative, data:, or fragment URLs", () => {
    const html = `<body>
      <img src="https://cdn.example.com/x.png">
      <img src="//cdn.example.com/y.png">
      <img src="data:image/png;base64,iVBOR">
      <a href="#section">jump</a>
      <a href="mailto:a@b.c">mail</a>
      <a href="javascript:void(0)">x</a>
    </body>`;
    const out = rewritePreviewAssetUrls(html, OPTS);
    expect(out).toBe(html);
  });

  it("does not double-append an existing token param", () => {
    const out = rewritePreviewAssetUrls(`<img src="/x.png?token=tok-9">`, OPTS);
    expect(out).toContain(`src="${M}/x.png?token=tok-9"`);
    expect(out).not.toContain("token=tok-9&token=");
  });

  it("omits the token entirely when none is configured", () => {
    const out = rewritePreviewAssetUrls(`<img src="/x.png">`, { ...OPTS, token: "" });
    expect(out).toContain(`src="${M}/x.png"`);
    expect(out).not.toContain("token=");
  });
});
