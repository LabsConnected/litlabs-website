// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  checkRenderedLayout,
  findLayoutViolations,
  renderedLayoutFailureMessage,
  renderedLayoutRepairPrompt,
} from "./rendered-layout";

/**
 * ACC-08 Defect 2b — the static desktop-collapse judge. Acceptance
 * Run 1 on ba16d435 rendered a generated bakery site in a ~230px
 * column at desktop width (correct at phone width) and no check
 * caught it. These fixtures pin the exact failure shape: a wrapper
 * around the WHOLE page capped at phone width, in each declaration
 * channel (author CSS, Tailwind utilities, inline style) — plus the
 * false-positive guards: wide containers, section-level narrow
 * cards, phone-only media-query caps, and breakpoint overrides.
 */

const SECTIONS = [
  "<header><h1>Sunny Crust Bakery</h1><nav>Menu · Hours · Contact</nav></header>",
  "<main>",
  '  <section class="hero"><h2>Fresh from the oven</h2><p>Warm bread and pastries every morning for the whole neighborhood.</p></section>',
  '  <section class="menu"><h2>Menu</h2><p>Sourdough, croissants, muffins, and the famous cinnamon rolls.</p></section>',
  '  <section class="hours"><h2>Hours</h2><p>Open Monday to Saturday, seven in the morning until six in the evening.</p></section>',
  "</main>",
  "<footer><p>Sunny Crust Bakery · 12 Main Street</p></footer>",
].join("\n");

function page(wrapperOpen: string, wrapperClose: string, headExtra = ""): string {
  return [
    "<!DOCTYPE html>",
    "<html><head><title>Sunny Crust Bakery</title>",
    headExtra,
    "</head><body>",
    wrapperOpen,
    SECTIONS,
    wrapperClose,
    "</body></html>",
  ].join("\n");
}

describe("findLayoutViolations — the collapse shape", () => {
  it("flags a page wrapped by an author-CSS max-width under 40rem", () => {
    const html = page(
      '<div class="page-wrap">',
      "</div>",
      "<style>.page-wrap { max-width: 24rem; margin: 0 auto; }</style>",
    );
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      element: "div.page-wrap",
      property: "max-width",
      declaredPx: 384,
      thresholdPx: 640,
    });
  });

  it("flags a Tailwind arbitrary max-w cap on the page wrapper", () => {
    const html = page('<div class="mx-auto w-full max-w-[230px]">', "</div>");
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0].property).toBe("max-width");
    expect(violations[0].declaredPx).toBe(230);
  });

  it("flags a Tailwind scale max-w cap (max-w-md = 28rem) on the page wrapper", () => {
    const html = page('<div class="mx-auto max-w-md px-4">', "</div>");
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0].declaredPx).toBe(448);
  });

  it("flags a fixed pixel width on the page wrapper via inline style", () => {
    const html = page('<div style="width: 480px; margin: 0 auto">', "</div>");
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ property: "width", declaredPx: 480, thresholdPx: 600 });
  });

  it("flags a narrow cap declared on body itself", () => {
    const html = page("", "", "<style>body { max-width: 600px; margin: 0 auto; }</style>");
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0].element).toBe("body");
  });

  it("flags a cap on a nested single-child wrapper chain", () => {
    const html = page(
      '<div class="outer"><div class="inner">',
      "</div></div>",
      "<style>.inner { max-width: 20rem; }</style>",
    );
    const violations = findLayoutViolations(html);
    expect(violations).toHaveLength(1);
    expect(violations[0].element).toBe("div.inner");
  });
});

describe("findLayoutViolations — healthy pages and false-positive guards", () => {
  it("passes a wide Tailwind container (the contract shape)", () => {
    const html = page('<div class="mx-auto w-full max-w-6xl px-4">', "</div>");
    expect(findLayoutViolations(html)).toEqual([]);
  });

  it("passes a wide author-CSS container", () => {
    const html = page(
      '<div class="wrap">',
      "</div>",
      "<style>.wrap { max-width: 72rem; margin: 0 auto; padding: 0 1.5rem; }</style>",
    );
    expect(findLayoutViolations(html)).toEqual([]);
  });

  it("passes a page with no caps at all", () => {
    expect(findLayoutViolations(page("", ""))).toEqual([]);
  });

  it("does NOT flag a narrow card inside a wide page (section-level, not page-level)", () => {
    const html = page(
      '<div class="mx-auto w-full max-w-6xl px-4">',
      "</div>",
      "<style>.promo-card { max-width: 20rem; }</style>",
    ).replace(
      '<section class="hours">',
      '<aside class="promo-card"><p>A short promo card with a little text.</p></aside><section class="hours">',
    );
    expect(findLayoutViolations(html)).toEqual([]);
  });

  it("does NOT flag a narrow cap that only applies inside a phone media query", () => {
    const html = page(
      '<div class="wrap">',
      "</div>",
      "<style>.wrap { max-width: 72rem; margin: 0 auto; } @media (max-width: 640px) { .wrap { max-width: 24rem; } }</style>",
    );
    expect(findLayoutViolations(html)).toEqual([]);
  });

  it("does NOT flag a narrow base cap overridden wide at the md breakpoint", () => {
    const html = page('<div class="mx-auto max-w-sm md:max-w-6xl px-4">', "</div>");
    expect(findLayoutViolations(html)).toEqual([]);
  });

  it("does NOT flag a relative width (w-full / percentage caps)", () => {
    const html = page('<div style="width: 100%; max-width: 90%">', "</div>");
    expect(findLayoutViolations(html)).toEqual([]);
  });
});

describe("checkRenderedLayout — loop-facing evidence rules", () => {
  const COLLAPSED = page('<div class="mx-auto w-full max-w-[230px]">', "</div>");
  const HEALTHY = page('<div class="mx-auto w-full max-w-6xl px-4">', "</div>");

  function reader(files: Record<string, string>) {
    return async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`404 not found: ${path}`);
      return { content };
    };
  }

  it("reports the collapse with the file path stamped on the violation", async () => {
    const result = await checkRenderedLayout({
      candidatePaths: ["index.html"],
      readFile: reader({ "index.html": COLLAPSED }),
    });
    expect(result.applies).toBe(true);
    expect(result.checkedFiles).toEqual(["index.html"]);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].path).toBe("index.html");
  });

  it("is clean for a healthy page and ignores non-HTML candidates", async () => {
    const result = await checkRenderedLayout({
      candidatePaths: ["index.html", "styles.css", "app.ts"],
      readFile: reader({ "index.html": HEALTHY }),
    });
    expect(result.applies).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not apply when no HTML file can be read back", async () => {
    const result = await checkRenderedLayout({
      candidatePaths: ["index.html"],
      readFile: reader({}),
    });
    expect(result.applies).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("does not apply when there are no HTML candidates", async () => {
    const result = await checkRenderedLayout({
      candidatePaths: ["src/app.ts"],
      readFile: reader({}),
    });
    expect(result.applies).toBe(false);
  });
});

describe("rendered-layout messages", () => {
  const violations = [
    {
      path: "index.html",
      element: "div.page-wrap",
      property: "max-width" as const,
      declared: "24rem",
      declaredPx: 384,
      thresholdPx: 640,
    },
  ];

  it("the failure message names the collapse in plain language", () => {
    const message = renderedLayoutFailureMessage(violations);
    expect(message).toContain("narrow column");
    expect(message).toContain("index.html");
    expect(message).toContain("24rem");
    expect(message).toContain("can't confirm this build landed as intended");
  });

  it("the repair prompt teaches the wide-container fix", () => {
    const prompt = renderedLayoutRepairPrompt(violations);
    expect(prompt).toContain("COLLAPSE INTO A NARROW COLUMN");
    expect(prompt).toContain("max-w-6xl");
    expect(prompt).toContain("64rem");
  });
});
