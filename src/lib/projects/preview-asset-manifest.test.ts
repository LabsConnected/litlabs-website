import { describe, expect, it, vi } from "vitest";
import { collectPreviewAssetManifest } from "./preview-asset-manifest";

/**
 * The manifest is the security boundary of the corrected preview token:
 * it must contain EXACTLY the publishable reference closure of the served
 * document — every script the page can legitimately load (so previews keep
 * working) and nothing else in the workspace (so the bearer cannot read
 * arbitrary files). The reader map below deliberately contains sensitive
 * files; the tests prove they are never swept in unless the site's own
 * reference graph names them as scripts/documents.
 */
function reader(files: Record<string, string>) {
  return vi.fn(async (path: string) => files[path] ?? null);
}

const SENSITIVE = {
  "QUALITY_LOG.md": "# quality log",
  ".env": "SECRET=1",
  "secret.txt": "marker",
  "notes.md": "private notes",
};

describe("collectPreviewAssetManifest", () => {
  it("contains the entry document and its direct scripts only", async () => {
    const files = {
      ...SENSITIVE,
      "index.html": '<script defer src="app.js"></script><script type="module" src="mod.js"></script>',
      "app.js": "window.a = 1;",
      "mod.js": "window.m = 1;",
      "unreferenced.js": "window.u = 1;",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["app.js", "index.html", "mod.js"]);
  });

  it("follows the transitive static import closure (import, export-from, side-effect)", async () => {
    const files = {
      "index.html": '<script type="module" src="src/main.js"></script>',
      "src/main.js": 'import { a } from "./a.js"; import "./side.js"; export { b } from "./b.js";',
      "src/a.js": 'import { c } from "../lib/c.js"; export const a = c;',
      "src/side.js": "window.side = true;",
      "src/b.js": "export const b = 2;",
      "lib/c.js": "export const c = 3;",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["index.html", "lib/c.js", "src/a.js", "src/b.js", "src/main.js", "src/side.js"]);
  });

  it("follows literal dynamic imports, including from classic scripts", async () => {
    const files = {
      "index.html": '<script src="classic.js"></script>',
      "classic.js": 'button.onclick = () => import("./lazy.js");',
      "lazy.js": "export default {};",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["classic.js", "index.html", "lazy.js"]);
  });

  it("ignores bare specifiers, external URLs and non-script imports", async () => {
    const files = {
      "index.html": '<script type="module" src="mod.js"></script>',
      "mod.js": 'import react from "react"; import x from "https://cdn.test/x.js"; import data from "./data.json";',
      "data.json": "{}",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["index.html", "mod.js"]);
  });

  it("terminates on import cycles", async () => {
    const files = {
      "index.html": '<script type="module" src="a.js"></script>',
      "a.js": 'import "./b.js";',
      "b.js": 'import "./a.js";',
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["a.js", "b.js", "index.html"]);
  });

  it("crawls linked HTML documents and their script closures (navigation targets)", async () => {
    const files = {
      ...SENSITIVE,
      "index.html": '<script src="app.js"></script><a href="pages/two.html">two</a>',
      "app.js": "window.a = 1;",
      "pages/two.html": '<script type="module" src="two.js"></script><a href="../three.html">three</a>',
      "pages/two.js": 'import "./helper.js";',
      "pages/helper.js": "export {};",
      "three.html": "<h1>three</h1>",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["app.js", "index.html", "pages/helper.js", "pages/two.html", "pages/two.js", "three.html"]);
  });

  it("never sweeps in stylesheets, images or unreferenced files", async () => {
    const files = {
      ...SENSITIVE,
      "index.html": '<link rel="stylesheet" href="style.css"><img src="logo.png"><script src="app.js"></script>',
      "style.css": "body { color: red; }",
      "logo.png": "binary",
      "app.js": "window.a = 1;",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["app.js", "index.html"]);
  });

  it("keeps a referenced asset in the manifest even when its read fails", async () => {
    const files = {
      "index.html": '<script type="module" src="ghost.js"></script>',
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["ghost.js", "index.html"]);
  });

  it("rejects references into hidden segments when resolving imports", async () => {
    const files = {
      "index.html": '<script type="module" src="mod.js"></script>',
      "mod.js": 'import "./.private/key.js"; import "./ok.js";',
      ".private/key.js": "secret",
      "ok.js": "export {};",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest).toEqual(["index.html", "mod.js", "ok.js"]);
  });
});
