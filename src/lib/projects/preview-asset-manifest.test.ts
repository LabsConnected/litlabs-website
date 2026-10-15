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
    expect(manifest.assets).toEqual(["app.js", "index.html", "mod.js"]);
    expect(manifest.complete).toBe(true);
  });

  it("follows static imports, export-from, side effects, and transitive closure", async () => {
    const files = {
      "index.html": '<script type="module" src="src/main.js"></script>',
      "src/main.js": 'import { a } from "./a.js"; import "./side.js"; export { b } from "./b.js";',
      "src/a.js": 'import { c } from "../lib/c.js"; export const a = c;',
      "src/side.js": "window.side = true;",
      "src/b.js": "export const b = 2;",
      "lib/c.js": "export const c = 3;",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["index.html", "lib/c.js", "src/a.js", "src/b.js", "src/main.js", "src/side.js"]);
  });

  it("follows literal dynamic imports, including classic scripts", async () => {
    const files = {
      "index.html": '<script src="classic.js"></script>',
      "classic.js": 'button.onclick = () => import("./lazy.js");',
      "lazy.js": "export default {};",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["classic.js", "index.html", "lazy.js"]);
  });

  it("ignores bare, external, and non-script specifiers", async () => {
    const files = {
      "index.html": '<script type="module" src="mod.js"></script>',
      "mod.js": 'import react from "react"; import x from "https://cdn.test/x.js"; import data from "./data.json";',
      "data.json": "{}",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["index.html", "mod.js"]);
  });

  it("terminates on import cycles", async () => {
    const files = { "index.html": '<script type="module" src="a.js"></script>', "a.js": 'import "./b.js";', "b.js": 'import "./a.js";' };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["a.js", "b.js", "index.html"]);
  });

  it("crawls linked HTML documents and their script closures", async () => {
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
    expect(manifest.assets).toEqual(["app.js", "index.html", "pages/helper.js", "pages/two.html", "pages/two.js", "three.html"]);
  });

  it("never sweeps stylesheets, images, or unreferenced files", async () => {
    const files = { ...SENSITIVE, "index.html": '<link rel="stylesheet" href="style.css"><img src="logo.png"><script src="app.js"></script>', "style.css": "body {}", "logo.png": "binary", "app.js": "window.a = 1;" };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["app.js", "index.html"]);
  });

  it("fails closed when a referenced file cannot be read", async () => {
    const files = { "index.html": '<script type="module" src="ghost.js"></script>' };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["ghost.js", "index.html"]);
    expect(manifest.complete).toBe(false);
    expect(manifest.truncationReasons).toContain("read_failure");
  });

  it("ignores import-shaped text inside comments and strings", async () => {
    const files = {
      "index.html": '<script type="module" src="main.js"></script>',
      "main.js": [
        'const text = "import \\\"./secret.js\\\"";',
        '// export { hidden } from "./secret.js";',
        '/* import("./secret.js") */',
        "export const ok = true;",
      ].join("\n"),
      "secret.js": "window.secret = true;",
    };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["index.html", "main.js"]);
    expect(manifest.complete).toBe(true);
  });

  it("reports the asset cap and fails closed", async () => {
    const files: Record<string, string> = { "index.html": '<script type="module" src="main.js"></script>', "main.js": "" };
    for (let i = 0; i < 130; i++) files[`asset-${i}.js`] = "export {};";
    files["main.js"] = Array.from({ length: 130 }, (_, i) => `import "./asset-${i}.js";`).join("\n");
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toHaveLength(128);
    expect(manifest.complete).toBe(false);
    expect(manifest.truncationReasons).toContain("assets");
  });

  it("reports the document cap and fails closed", async () => {
    const files: Record<string, string> = { "index.html": "" };
    files["index.html"] = Array.from({ length: 40 }, (_, i) => `<a href="page-${i}.html">page</a>`).join("");
    for (let i = 0; i < 40; i++) files[`page-${i}.html`] = "<p>page</p>";
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.documentsVisited).toBe(32);
    expect(manifest.complete).toBe(false);
    expect(manifest.truncationReasons).toContain("documents");
  });

  it("reports the depth cap and fails closed", async () => {
    const files: Record<string, string> = { "index.html": '<script type="module" src="level-0.js"></script>' };
    for (let i = 0; i < 10; i++) files[`level-${i}.js`] = i === 9 ? "export {};" : `import "./level-${i + 1}.js";`;
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.complete).toBe(false);
    expect(manifest.truncationReasons).toContain("depth");
  });

  it("bounds concurrent reads and fails closed at the overall deadline", async () => {
    let active = 0;
    let maxActive = 0;
    const read = async (path: string) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return path === "main.js" ? Array.from({ length: 12 }, (_, i) => `import "./dep-${i}.js";`).join("\n") : "export {};";
    };
    const manifest = await collectPreviewAssetManifest("index.html", '<script type="module" src="main.js"></script>', read, { concurrency: 3, deadlineMs: 5 });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(manifest.complete).toBe(false);
    expect(manifest.timedOut).toBe(true);
    expect(manifest.truncationReasons).toContain("timeout");
  });

  it("reduces collection latency with bounded concurrency", async () => {
    const files: Record<string, string> = { "index.html": Array.from({ length: 12 }, (_, i) => `<a href="page-${i}.html">page</a>`).join("") };
    for (let i = 0; i < 12; i++) files[`page-${i}.html`] = "<p>page</p>";
    const read = async (path: string) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return files[path] ?? null;
    };
    const startedAt = Date.now();
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], read, { concurrency: 4, deadlineMs: 1_000 });
    const elapsedMs = Date.now() - startedAt;
    expect(manifest.complete).toBe(true);
    expect(manifest.documentsVisited).toBe(13);
    expect(elapsedMs).toBeLessThan(180);
  });

  it("rejects references into hidden segments", async () => {
    const files = { "index.html": '<script type="module" src="mod.js"></script>', "mod.js": 'import "./.private/key.js"; import "./ok.js";', ".private/key.js": "secret", "ok.js": "export {};" };
    const manifest = await collectPreviewAssetManifest("index.html", files["index.html"], reader(files));
    expect(manifest.assets).toEqual(["index.html", "mod.js", "ok.js"]);
  });
});
