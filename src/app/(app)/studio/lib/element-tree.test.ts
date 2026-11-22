import { describe, expect, it } from "vitest";
import { buildStructureTree, type ElementTreeNode } from "./element-tree";
import { locateElement } from "./element-edits";

const HTML = `<!DOCTYPE html>
<html>
<head><title>Site</title><style>.x{color:red}</style></head>
<body>
  <header class="site-header"><nav><a href="/">Home</a></nav></header>
  <main>
    <section class="hero"><h1 id="hero-title" style="color: rgb(255, 255, 255); font-size: 48px; position: relative">Hello world</h1><p>Sub</p></section>
    <section class="features"><p>One</p><p>Two</p></section>
  </main>
  <script src="script.js"></script>
</body>
</html>`;

function flatten(nodes: ElementTreeNode[]): ElementTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("buildStructureTree", () => {
  it("roots the tree at the body's sections, skipping script/style/head content", () => {
    const roots = buildStructureTree(HTML);
    expect(roots).not.toBeNull();
    expect(roots!.map((n) => n.tagName)).toEqual(["header", "main"]);
    const all = flatten(roots!);
    expect(all.some((n) => n.tagName === "script")).toBe(false);
    expect(all.some((n) => n.tagName === "style")).toBe(false);
    expect(all.some((n) => n.tagName === "title")).toBe(false);
  });

  it("uses the bridge identity rules: #id shortcut, semantic labels, ancestor paths", () => {
    const roots = buildStructureTree(HTML)!;
    const all = flatten(roots);
    const h1 = all.find((n) => n.tagName === "h1")!;
    expect(h1.selector).toBe("#hero-title");
    expect(h1.label).toBe("Heading");
    expect(h1.path).toBe("html > body > main > section:nth-of-type(1) > h1");
    const header = roots.find((n) => n.tagName === "header")!;
    expect(header.label).toBe("Header");
    const nav = header.children[0];
    expect(nav.label).toBe("Navigation");
  });

  it("disambiguates repeated siblings with :nth-of-type, like the bridge", () => {
    const roots = buildStructureTree(HTML)!;
    const all = flatten(roots);
    const paragraphs = all.filter((n) => n.tagName === "p" && (n.text === "One" || n.text === "Two"));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].path).toContain("p:nth-of-type(1)");
    expect(paragraphs[1].path).toContain("p:nth-of-type(2)");
    const sections = all.filter((n) => n.tagName === "section");
    expect(sections[0].path).toContain("section:nth-of-type(1)");
    expect(sections[1].path).toContain("section:nth-of-type(2)");
  });

  it("captures bridge attrs and only the inspector's inline style props", () => {
    const roots = buildStructureTree(HTML)!;
    const h1 = flatten(roots).find((n) => n.tagName === "h1")!;
    expect(h1.attrs?.id).toBe("hero-title");
    expect(h1.styles).toEqual({ color: "rgb(255, 255, 255)", "font-size": "48px" });
    // `position` is not one of the bridge's STYLE_PROPS — never captured.
    expect(h1.styles).not.toHaveProperty("position");
  });

  it("every node's identity resolves back to its element via locateElement", () => {
    const doc = parse(HTML);
    const roots = buildStructureTree(HTML)!;
    for (const node of flatten(roots)) {
      const found = locateElement(doc, node);
      expect(found, `identity for ${node.path} should resolve`).not.toBeNull();
      expect(found!.tagName.toLowerCase()).toBe(node.tagName);
    }
  });

  it("returns null for empty source and [] for a page with no structure", () => {
    expect(buildStructureTree("")).toBeNull();
    expect(buildStructureTree("   ")).toBeNull();
    expect(buildStructureTree("<html><body></body></html>")).toEqual([]);
  });
});
