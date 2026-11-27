import { describe, it, expect } from "vitest";
import { checkSiteQuality, siteQualityFailureMessage } from "./site-quality";
import { auditStaticSiteHtml, detectMarkdownLeaks, detectStyling } from "@/lib/site-enrich/audit";

/**
 * ACC-10 Defect 3 — the quality floor. Acceptance Run 1 on 4adcdd4c
 * settled "Complete" on a page with no styling at all and a raw
 * markdown link rendered literally. These cases pin the floor: a
 * full page with no styling signal, or with markdown leaks, is a
 * violation; styled pages, stubs and fragments are not judged.
 */

const LONG_TEXT =
  "Welcome to Sunny Crust Bakery, a neighborhood bakery serving fresh sourdough, " +
  "croissants, muffins, cakes and pies every morning from seven until three, with " +
  "coffee, tea and a small lunch menu at midday. Find us on Main Street, call ahead " +
  "for large orders, and ask about our weekend baking classes for kids and adults.";

function page(bodyInner: string, headInner = ""): string {
  return `<!DOCTYPE html>\n<html><head><title>Sunny Crust Bakery</title>${headInner}</head><body>${bodyInner}</body></html>`;
}

const BARE_PAGE = page(`<h1>Sunny Crust Bakery</h1><p>${LONG_TEXT}</p>`);
const STYLED_PAGE = page(`<h1>Sunny Crust Bakery</h1><p>${LONG_TEXT}</p>`, "<style>body { font-family: sans-serif; }</style>");
const TAILWIND_PAGE = page(
  `<h1 class="text-4xl font-bold">Sunny Crust Bakery</h1><p>${LONG_TEXT}</p>`,
  '<script src="https://cdn.tailwindcss.com"></script>',
);
const LEAK_PAGE = page(
  `<h1>Sunny Crust Bakery</h1><p>${LONG_TEXT}</p><p>Contact: [sunnycrustbakery@example.com](mailto:sunnycrustbakery@example.com)</p>`,
  "<style>p { margin: 0; }</style>",
);

function reader(files: Record<string, string>) {
  return async (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`404 not found: ${path}`);
    return { content };
  };
}

describe("checkSiteQuality (ACC-10 Defect 3)", () => {
  it("flags a full page with no styling at all", async () => {
    const result = await checkSiteQuality({
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": BARE_PAGE }),
    });
    expect(result.applies).toBe(true);
    expect(result.violations).toEqual([{ path: "index.html", kind: "unstyled" }]);
  });

  it("flags raw markdown link syntax left in the page", async () => {
    const result = await checkSiteQuality({
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": LEAK_PAGE }),
    });
    expect(result.applies).toBe(true);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].kind).toBe("markdown_leak");
    expect(result.violations[0].detail).toContain("mailto:sunnycrustbakery@example.com");
  });

  it("passes a styled page — style block or framework CDN alike", async () => {
    for (const html of [STYLED_PAGE, TAILWIND_PAGE]) {
      const result = await checkSiteQuality({
        candidatePaths: ["index.html"],
        readFile: reader({ "index.html": html }),
      });
      expect(result.applies).toBe(true);
      expect(result.violations).toEqual([]);
    }
  });

  it("does not judge stubs, fragments or non-HTML files", async () => {
    const stub = page("<p>Redirecting…</p>");
    const result = await checkSiteQuality({
      candidatePaths: ["index.html", "notes.txt"],
      readFile: reader({ "index.html": stub, "notes.txt": BARE_PAGE }),
    });
    expect(result.applies).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("skips unreadable candidates without failing the whole check", async () => {
    const result = await checkSiteQuality({
      candidatePaths: ["gone.html", "index.html"],
      readFile: reader({ "index.html": STYLED_PAGE }),
    });
    expect(result.applies).toBe(true);
    expect(result.checkedFiles).toEqual(["index.html"]);
    expect(result.violations).toEqual([]);
  });

  it("the failure message names the problem in plain language", () => {
    const message = siteQualityFailureMessage([
      { path: "index.html", kind: "unstyled" },
      { path: "index.html", kind: "markdown_leak", detail: "[a@b.com](mailto:a@b.com)" },
    ]);
    expect(message).toContain("no styling at all");
    expect(message).toContain("index.html");
    expect(message).toContain("[a@b.com](mailto:a@b.com)");
    expect(message).toContain("not a finished site");
  });
});

describe("audit detectors (ACC-10 Defect 3)", () => {
  it("detectStyling recognizes each styling signal and rejects a bare page", () => {
    expect(detectStyling(BARE_PAGE)).toBe(false);
    expect(detectStyling(STYLED_PAGE)).toBe(true);
    expect(detectStyling(TAILWIND_PAGE)).toBe(true);
    expect(detectStyling(page(`<p>${LONG_TEXT}</p>`, '<link rel="stylesheet" href="styles.css">'))).toBe(true);
    expect(
      detectStyling(
        page(
          `<p style="color: red">${LONG_TEXT}</p><p style="margin: 0">a</p><p style="padding: 0">b</p>`,
        ),
      ),
    ).toBe(true);
    // One or two inline styles are not a styled page.
    expect(detectStyling(page(`<p style="color: red">${LONG_TEXT}</p>`))).toBe(false);
  });

  it("detectMarkdownLeaks finds markdown links but not real anchors", () => {
    expect(detectMarkdownLeaks(LEAK_PAGE)).toHaveLength(1);
    expect(detectMarkdownLeaks(STYLED_PAGE)).toEqual([]);
    expect(
      detectMarkdownLeaks(page(`<p>${LONG_TEXT}</p><a href="mailto:a@b.com">a@b.com</a>`)),
    ).toEqual([]);
  });

  it("the visual audit carries the new signals and issues", () => {
    const bare = auditStaticSiteHtml(BARE_PAGE, new Set(["index.html"]));
    expect(bare.hasStyling).toBe(false);
    expect(bare.issues).toContain("page has no styling (unstyled HTML)");
    const leak = auditStaticSiteHtml(LEAK_PAGE, new Set(["index.html"]));
    expect(leak.markdownLeaks).toHaveLength(1);
    expect(leak.hasStyling).toBe(true);
  });
});
