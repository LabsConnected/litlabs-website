import { describe, expect, it, vi } from "vitest";
import { inlineStaticPreviewTextAssets } from "./static-preview-document";

describe("authenticated static preview document", () => {
  it("embeds local CSS and JS while retaining media and script attributes", async () => {
    const read = vi.fn(async (path: string) => path.endsWith(".css") ? "body { color: red; }" : "window.loaded = true;");
    const result = await inlineStaticPreviewTextAssets('<link id="theme" rel="stylesheet" href="../style.css" media="screen"><script defer src="app.js"></script>', "pages/index.html", read);
    expect(read.mock.calls.map(([path]) => path)).toEqual(["style.css", "pages/app.js"]);
    expect(result).toContain('<style id="theme" media="screen" data-preview-file="style.css">body { color: red; }</style>');
    expect(result).toContain('<script defer="" data-preview-file="pages/app.js">window.loaded = true;</script>');
  });

  it("never reads external, hidden, encoded traversal or non-text assets", async () => {
    const read = vi.fn();
    const html = '<link rel="stylesheet" href="https://outside.test/style.css"><script src="//outside.test/app.js"></script><script src="/.private/key.js"></script><script src="%2e%2e%2f.env.js"></script><script src="secret.env"></script>';
    expect(await inlineStaticPreviewTextAssets(html, "index.html", read)).toBe(html);
    expect(read).not.toHaveBeenCalled();
  });

  it("does not parse apparent link tags inside scripts as resources", async () => {
    const read = vi.fn();
    const html = '<script>const example = \'<link rel="stylesheet" href="secret.css">\';</script>';
    expect(await inlineStaticPreviewTextAssets(html, "index.html", read)).toBe(html);
    expect(read).not.toHaveBeenCalled();
  });

  it("escapes closing raw-text tags and keeps missing files unchanged", async () => {
    const read = vi.fn(async (path: string) => path === "app.js" ? 'window.label = "</script>";' : null);
    const html = '<link rel="stylesheet" href="missing.css"><script src="app.js"></script>';
    const result = await inlineStaticPreviewTextAssets(html, "index.html", read);
    expect(result).toContain('href="missing.css"');
    expect(result).toContain('window.label = "<\\/script>";');
  });
});
