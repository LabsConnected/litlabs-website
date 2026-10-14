import { describe, expect, it, vi } from "vitest";
import { prepareStaticPreviewDocument } from "./static-preview-document";

const ASSET_BASE = "/api/preview/proj-1/t/fixture-token/";

describe("authenticated static preview document", () => {
  it("embeds local CSS while keeping scripts external with token-authorized URLs", async () => {
    const readStylesheet = vi.fn(async (path: string) => path === "style.css" ? "body { color: red; }" : null);
    const result = await prepareStaticPreviewDocument(
      '<link id="theme" rel="stylesheet" href="../style.css" media="screen"><script defer src="app.js"></script>',
      "pages/index.html",
      { assetBase: ASSET_BASE, readStylesheet },
    );
    // Only the stylesheet is read during the authenticated document request.
    expect(readStylesheet.mock.calls.map(([path]) => path)).toEqual(["style.css"]);
    expect(result).toContain('<style id="theme" media="screen" data-preview-file="style.css">body { color: red; }</style>');
    // The script is NOT inlined and NOT relocated: its URL is rewritten to the
    // token-authorized preview path and `defer` stays exactly as authored, so
    // the browser applies native deferred execution (after parsing, in
    // document order, shared with module scripts).
    expect(result).toContain(`<script defer="" src="${ASSET_BASE}pages/app.js"></script>`);
    expect(result).not.toContain("window.loaded");
  });

  it("rewrites multiple scripts in place, preserving document order and position", async () => {
    const readStylesheet = vi.fn(async () => null);
    const html = '<html><head><script defer src="a.js"></script><script type="module" src="m.js"></script></head><body><p>x</p><script src="b.js"></script></body></html>';
    const result = await prepareStaticPreviewDocument(html, "index.html", { assetBase: ASSET_BASE, readStylesheet });
    expect(result).toContain(`<head><script defer="" src="${ASSET_BASE}a.js"></script><script type="module" src="${ASSET_BASE}m.js"></script></head>`);
    expect(result).toContain(`<body><p>x</p><script src="${ASSET_BASE}b.js"></script></body>`);
    expect(readStylesheet).not.toHaveBeenCalled();
  });

  it("preserves async and integrity attributes untouched (native semantics)", async () => {
    const readStylesheet = vi.fn(async () => null);
    const html = '<html><head><script async defer src="x.js" integrity="sha384-abc" crossorigin="anonymous"></script></head><body></body></html>';
    const result = await prepareStaticPreviewDocument(html, "index.html", { assetBase: ASSET_BASE, readStylesheet });
    expect(result).toContain(`<script async="" defer="" src="${ASSET_BASE}x.js" integrity="sha384-abc" crossorigin="anonymous"></script>`);
  });

  it("never rewrites or reads external, hidden, encoded traversal or non-text assets", async () => {
    const readStylesheet = vi.fn(async () => null);
    const html = '<link rel="stylesheet" href="https://outside.test/style.css"><script src="//outside.test/app.js"></script><script src="/.private/key.js"></script><script src="%2e%2e%2f.env.js"></script><script src="secret.env"></script>';
    expect(await prepareStaticPreviewDocument(html, "index.html", { assetBase: ASSET_BASE, readStylesheet })).toBe(html);
    expect(readStylesheet).not.toHaveBeenCalled();
  });

  it("does not parse apparent link tags inside scripts as resources", async () => {
    const readStylesheet = vi.fn(async () => null);
    const html = '<script>const example = \'<link rel="stylesheet" href="secret.css">\';</script>';
    expect(await prepareStaticPreviewDocument(html, "index.html", { assetBase: ASSET_BASE, readStylesheet })).toBe(html);
    expect(readStylesheet).not.toHaveBeenCalled();
  });

  it("escapes closing style tags in embedded CSS and keeps missing stylesheets unchanged", async () => {
    const readStylesheet = vi.fn(async (path: string) => path === "ok.css" ? 'a::after { content: "</style>"; }' : null);
    const html = '<link rel="stylesheet" href="missing.css"><link rel="stylesheet" href="ok.css">';
    const result = await prepareStaticPreviewDocument(html, "index.html", { assetBase: ASSET_BASE, readStylesheet });
    expect(result).toContain('href="missing.css"');
    expect(result).toContain('content: "\\3c /style>"; }');
  });
});
