/**
 * element-edits — the preview-element write path. These tests pin the
 * honesty contract: unique+verified match or explicit refusal, real
 * HTML output, and truthful no-op reporting.
 */
import { describe, expect, it } from "vitest";
import {
  applyElementPatch,
  candidateHtmlFiles,
  describePatch,
  isEditableSourceFile,
  locateElement,
  type ElementIdentity,
} from "./element-edits";

const DOC = `<!DOCTYPE html>
<html><body>
  <nav><a href="/" class="brand">LiTT</a></nav>
  <main>
    <section class="hero"><h1 id="hero-title">Hello world</h1><p>Sub copy</p></section>
    <section class="grid"><div class="card">A</div><div class="card">B</div></section>
    <img src="/old.png" alt="Old shot" />
  </main>
</body></html>`;

const hero: ElementIdentity = {
  selector: "main > section.hero > h1#hero-title",
  tagName: "h1",
  attrs: { id: "hero-title", class: "" },
};

describe("applyElementPatch", () => {
  it("replaces element text and returns the full document", () => {
    const r = applyElementPatch(DOC, hero, { text: "New headline" });
    expect(r.ok).toBe(true);
    expect(r.html).toContain("<h1 id=\"hero-title\">New headline</h1>");
    expect(r.html).toContain("class=\"card\""); // rest of doc intact
    expect(r.changed.join(" ")).toContain("text");
  });

  it("sets inline styles as real style properties", () => {
    const r = applyElementPatch(DOC, hero, { styles: { color: "#ff0000", "font-size": "40px" } });
    expect(r.ok).toBe(true);
    expect(r.html).toMatch(/<h1[^>]*style="[^"]*color: rgb\(255, 0, 0\)/);
    expect(r.changed.length).toBe(2);
  });

  it("sets and removes attributes (src/href/alt)", () => {
    const img: ElementIdentity = { selector: "img", tagName: "img", attrs: { src: "/old.png", alt: "Old shot" } };
    const r = applyElementPatch(DOC, img, { attrs: { src: "/new.png", alt: "New shot" } });
    expect(r.ok).toBe(true);
    expect(r.html).toContain('src="/new.png"');
    expect(r.html).toContain('alt="New shot"');
  });

  it("refuses when the selector matches multiple elements (no tagName narrowing)", () => {
    const sel: ElementIdentity = { selector: ".card", tagName: "div" };
    const r = applyElementPatch(DOC, sel, { text: "x" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/uniquely/i);
    expect(r.html).toBe(DOC);
  });

  it("resolves via the ancestor path when the short selector is ambiguous", () => {
    const sel: ElementIdentity = {
      selector: ".card", // 2 matches — ambiguous on its own
      tagName: "div",
      path: "html > body > main > section:nth-of-type(2) > div:nth-of-type(2)",
    };
    const r = applyElementPatch(DOC, sel, { text: "Second" });
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<div class="card">A</div><div class="card">Second</div>');
  });

  it("refuses a tagName mismatch (selector matched a different element)", () => {
    const r = applyElementPatch(DOC, { selector: "#hero-title", tagName: "p" }, { text: "x" });
    expect(r.ok).toBe(false);
  });

  it("falls back to the captured id attribute when selectors miss", () => {
    const sel: ElementIdentity = { selector: ".does-not-exist", tagName: "h1", attrs: { id: "hero-title" } };
    const r = applyElementPatch(DOC, sel, { styles: { color: "red" } });
    expect(r.ok).toBe(true);
  });

  it("refuses when the captured attributes disagree with the match", () => {
    const sel: ElementIdentity = { selector: "#hero-title", tagName: "h1", attrs: { id: "other-title" } };
    const r = applyElementPatch(DOC, sel, { text: "x" });
    expect(r.ok).toBe(false);
  });

  it("supports element removal and duplication", () => {
    const gone = applyElementPatch(DOC, hero, { remove: true });
    expect(gone.ok).toBe(true);
    expect(gone.html).not.toContain("hero-title");

    const dup = applyElementPatch(DOC, hero, { duplicate: true });
    expect(dup.ok).toBe(true);
    expect(dup.html.match(/hero-title/g)?.length).toBe(2);
  });

  it("reports a no-op truthfully (nothing written)", () => {
    const r = applyElementPatch(DOC, hero, {});
    expect(r.ok).toBe(true);
    expect(r.changed).toHaveLength(0);
    expect(r.error).toMatch(/no change/i);
  });

  it("preserves the doctype exactly as present", () => {
    const noDoctype = DOC.replace("<!DOCTYPE html>\n", "");
    const r = applyElementPatch(noDoctype, hero, { text: "x" });
    expect(r.ok).toBe(true);
    expect(r.html.startsWith("<!DOCTYPE")).toBe(false);
  });
});

describe("candidateHtmlFiles", () => {
  const files = ["index.html", "about.html", "docs/index.html", "style.css", "app/page.tsx"];

  it("prefers the route-derived file, then index.html, then all .html — existing files only", () => {
    expect(candidateHtmlFiles("/about", files)).toEqual(["about.html", "index.html", "docs/index.html"]);
  });

  it("falls back to index.html for the root route", () => {
    expect(candidateHtmlFiles("/", files)[0]).toBe("index.html");
  });
});

describe("isEditableSourceFile + describePatch", () => {
  it("only marks html/svg sources editable", () => {
    expect(isEditableSourceFile("index.html")).toBe(true);
    expect(isEditableSourceFile("app/page.tsx")).toBe(false);
    expect(isEditableSourceFile("logo.svg")).toBe(true);
  });

  it("describes edits compactly", () => {
    expect(describePatch({ text: "hi", styles: { color: "red" } })).toBe("text · color");
    expect(describePatch({ remove: true })).toBe("remove");
  });
});

describe("locateElement", () => {
  it("returns null for invalid selector syntax instead of throwing", () => {
    const doc = new DOMParser().parseFromString(DOC, "text/html");
    expect(locateElement(doc, { selector: ">>>", tagName: "div" })).toBeNull();
  });
});
