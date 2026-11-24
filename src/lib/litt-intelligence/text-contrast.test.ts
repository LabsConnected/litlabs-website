import { describe, it, expect } from "vitest";
import {
  checkTextContrast,
  contrastRatio,
  findContrastViolations,
  parseCssColor,
} from "./text-contrast";

/**
 * ACC-02 Defect A (staging Acceptance Run 2, 2026-11-24): a generated
 * bakery page shipped with its tagline and opening-hours times
 * invisible — light text declared for a dark theme whose background
 * the document never actually had. The F9 read-back proved the text
 * EXISTED; nothing checked it could be SEEN. These tests pin the
 * read-back that does: judged only on the document's own declared
 * colors, firing only on clear light-on-light / dark-on-dark cases.
 */

const RUN2_PAGE = [
  "<!DOCTYPE html>",
  "<html>",
  "<head><title>Sunny Crust Bakery</title>",
  "<style>",
  "  body { background: #ffffff; font-family: sans-serif; }",
  "  h1 { color: #1c1917; }",
  "  .tagline { color: #f5f5f4; }",
  "  .label { color: #44403c; }",
  "  .hours-time { color: #e7e5e4; }",
  "  .menu-item { color: #292524; }",
  "</style>",
  "</head>",
  "<body>",
  "  <h1>Sunny Crust Bakery</h1>",
  '  <p class="tagline">Fresh from the oven every morning.</p>',
  '  <p><span class="label">Monday - Friday:</span> <span class="hours-time">7:00 AM - 5:00 PM</span></p>',
  '  <ul><li class="menu-item">Sourdough Loaf - $6</li></ul>',
  "</body>",
  "</html>",
].join("\n");

describe("findContrastViolations — the Run 2 shape", () => {
  it("catches the invisible tagline and hours times, and only those", () => {
    const { violations, reasoned } = findContrastViolations(RUN2_PAGE);
    expect(reasoned).toBe(true);
    const flagged = violations.map((v) => v.element).sort();
    expect(flagged).toEqual(["p.tagline", "span.hours-time"]);
    const tagline = violations.find((v) => v.element === "p.tagline");
    expect(tagline?.text).toContain("Fresh from the oven");
    expect(tagline?.color).toBe("#f5f5f4");
    expect(tagline?.background).toBe("#ffffff");
    expect(tagline?.ratio).toBeLessThan(1.2);
  });

  it("catches light text when NO background is declared anywhere", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #eeeeee; }",
      "</style></head><body>",
      "  <p>Warm bread, honest prices, every single morning.</p>",
      "</body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0].background).toBe("#ffffff");
  });

  it("catches light text declared by inline style and by descendant selector", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .hours span { color: #e7e5e4; }",
      "</style></head><body>",
      '  <p style="color: #f5f5f4">Fresh from the oven every morning.</p>',
      '  <div class="hours"><span>7:00 AM - 5:00 PM</span></div>',
      "</body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations.map((v) => v.element).sort()).toEqual(["p", "span"]);
  });

  it("catches dark text on a dark background too", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: #0c0c0f; }",
      "  p { color: #1c1917; }",
      "</style></head><body><p>Open seven days a week.</p></body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0].ratio).toBeLessThan(2);
  });
});

describe("findContrastViolations — pages that must pass", () => {
  it("passes a genuinely dark page with light text", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: #03050a; color: #f5f5f4; }",
      "  .accent { color: #a8ff2f; }",
      "</style></head><body>",
      "  <p>Fresh from the oven every morning.</p>",
      '  <p class="accent">Now open Sundays.</p>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(true);
    expect(violations).toEqual([]);
  });

  it("passes a normal dark-text-on-light page", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: #fafaf9; color: #1c1917; }",
      "  .muted { color: #57534e; }",
      "</style></head><body>",
      "  <p>Fresh from the oven every morning.</p>",
      '  <p class="muted">Baked at dawn, gone by noon.</p>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("passes muted gray text that is low-contrast but readable", () => {
    // #999999 on white is ~2.85:1 — under WCAG AA, but it is ordinary
    // muted styling, not invisible text. The guard must not fire.
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .muted { color: #999999; }",
      "</style></head><body>",
      '  <p class="muted">Prices include tax.</p>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("passes a var()-themed page whose tokens pair correctly", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --bg: #fafaf9; --text: #1c1917; }",
      "  body { background: var(--bg); color: var(--text); }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("catches a var()-themed page whose tokens pair badly", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --bg: #fafaf9; --text: #f5f5f4; }",
      "  body { background: var(--bg); color: var(--text); }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0].element).toBe("p");
  });

  it("passes light text on a dark section inside a light page", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: #ffffff; color: #1c1917; }",
      "  .band { background: #1c1917; }",
      "  .band p { color: #f5f5f4; }",
      "</style></head><body>",
      '  <section class="band"><p>Order ahead for the weekend.</p></section>',
      "  <p>Fresh from the oven every morning.</p>",
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("ignores deliberately hidden text", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .gone { display: none; color: #f5f5f4; }",
      "  .faded { opacity: 0; color: #f5f5f4; }",
      "</style></head><body>",
      '  <p class="gone">Secret menu, coming soon.</p>',
      '  <p class="faded">Also not shown yet.</p>',
      "  <p>Fresh from the oven every morning.</p>",
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });
});

describe("findContrastViolations — pages it cannot reason about", () => {
  it("does not fire when a local stylesheet may carry the colors", () => {
    const page = [
      "<!DOCTYPE html><html><head>",
      '  <link rel="stylesheet" href="styles.css">',
      "</head><body>",
      '  <p style="color: #f5f5f4">Fresh from the oven every morning.</p>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("still reasons when the only stylesheet link is Google Fonts", () => {
    const page = [
      "<!DOCTYPE html><html><head>",
      '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">',
      "  <style>p { color: #f5f5f4; }</style>",
      "</head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(true);
    expect(violations).toHaveLength(1);
  });

  it("does not fire when the background is a gradient", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .hero { background: linear-gradient(180deg, #03050a, #101623); }",
      "  .hero p { color: #f5f5f4; }",
      "</style></head><body>",
      '  <section class="hero"><p>Fresh from the oven every morning.</p></section>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("does not fire when the text color uses an unresolved var()", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: var(--ink); }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("does not fire when colors flip under prefers-color-scheme", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #f5f5f4; }",
      "  @media (prefers-color-scheme: dark) { body { background: #03050a; } }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("does not fire on gradient-clipped headline text", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  h1 { color: transparent; background: linear-gradient(90deg, #a8ff2f, #2fbf5a);",
      "       -webkit-background-clip: text; background-clip: text; }",
      "</style></head><body><h1>Sunny Crust Bakery</h1></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107)", () => {
  it("finding 1: does not judge a page using the Tailwind browser CDN", () => {
    // Colors live in utility classes the Tailwind Play runtime turns
    // into CSS in the browser; this checker never sees that CSS, so
    // the white text must not be judged against the default canvas.
    const page = [
      "<!DOCTYPE html><html><head>",
      '  <script src="https://cdn.tailwindcss.com"></script>',
      "  <style>p { color: #f5f5f4; }</style>",
      "</head>",
      '  <body class="bg-black"><p>Fresh from the oven every morning.</p></body></html>',
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 1: does not judge a page using the Tailwind v4 browser build", () => {
    const page = [
      "<!DOCTYPE html><html><head>",
      '  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
      "</head>",
      '  <body class="bg-black">',
      '  <p style="color: #f5f5f4">Fresh from the oven every morning.</p>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 1: does not judge a page with a text/tailwindcss style block", () => {
    const page = [
      "<!DOCTYPE html><html><head>",
      '  <style type="text/tailwindcss">.hero { @apply bg-black text-white; }</style>',
      "</head>",
      '  <body class="bg-black">',
      '  <p style="color: #f5f5f4">Fresh from the oven every morning.</p>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107), continued", () => {
  it("finding 2: reads a dark rgb() background written with spaces", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: rgb(3, 5, 10); color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(true);
    expect(violations).toEqual([]);
  });

  it("finding 2: reads the color inside a fuller background shorthand", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: rgb(3, 5, 10) center / cover no-repeat; color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("finding 2: an unreadable color function makes the background unknown, not transparent", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  body { background: rgba(3, 5, 10, bogus); color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107), continued", () => {
  it("finding 3: a later background shorthand beats an earlier background-color in the same block", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .hero { background-color: #ffffff; background: #03050a; }",
      "  .hero p { color: #f5f5f4; }",
      "</style></head><body>",
      '  <section class="hero"><p>Fresh from the oven every morning.</p></section>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("finding 3: a later background-color beats an earlier background shorthand in the same block", () => {
    // The page really is light-on-light — the win must go to the
    // LATER declaration, not to whichever property the checker
    // happens to prefer.
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  .hero { background: #03050a; background-color: #ffffff; }",
      "  .hero p { color: #f5f5f4; }",
      "</style></head><body>",
      '  <section class="hero"><p>Fresh from the oven every morning.</p></section>',
      "</body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0].background).toBe("#ffffff");
  });

  it("finding 3: declaration order inside a style attribute is honored too", () => {
    const page = [
      "<!DOCTYPE html><html><head></head><body>",
      '  <p style="background-color: #ffffff; background: #03050a; color: #f5f5f4">Fresh from the oven every morning.</p>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107), continued", () => {
  it("finding 4: does not judge when a dropped attribute-selector rule may carry the background", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #f5f5f4; }",
      '  body[data-theme="dark"] { background: #03050a; }',
      "</style></head>",
      '  <body data-theme="dark"><p>Fresh from the oven every morning.</p></body></html>',
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 4: does not judge when one selector of a list is dropped and the rule declares colors", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #f5f5f4; }",
      '  .hero, body[data-theme="dark"] { background: #03050a; }',
      "</style></head>",
      '  <body data-theme="dark"><p>Fresh from the oven every morning.</p></body></html>',
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 4: does not judge when an @media block changes only colors", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #f5f5f4; }",
      "  @media (max-width: 600px) { p { color: #1c1917; } }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 4: does not judge when a nested rule may carry the background", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  p { color: #f5f5f4; }",
      "  section { .inner { background: #03050a; } }",
      "</style></head><body>",
      '  <section><div class="inner"><p>Fresh from the oven every morning.</p></div></section>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(false);
    expect(violations).toEqual([]);
  });

  it("finding 4: a dropped selector whose rule declares no colors does not block judging", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  a:hover { text-decoration: underline; }",
      "  p { color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(true);
    expect(violations).toHaveLength(1);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107), continued", () => {
  it("finding 5: an ancestor's background resolves var() in the ancestor's own scope", () => {
    // .panel redefines --bg for ITSELF; body's background must
    // still read the :root value. Resolving body's var(--bg) with
    // the child's scope would paint the page white and falsely
    // fail the panel's light text.
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --bg: #03050a; }",
      "  body { background: var(--bg); }",
      "  .panel { --bg: #ffffff; color: #f5f5f4; }",
      "</style></head><body>",
      '  <div class="panel"><p>Fresh from the oven every morning.</p></div>',
      "</body></html>",
    ].join("\n");
    const { violations, reasoned } = findContrastViolations(page);
    expect(reasoned).toBe(true);
    expect(violations).toEqual([]);
  });

  it("finding 5: an inherited color resolves var() in the declaring ancestor's scope", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --ink: #1c1917; }",
      "  body { color: var(--ink); background: #ffffff; }",
      "  .panel { --ink: #f5f5f4; }",
      "</style></head><body>",
      '  <div class="panel"><p>Fresh from the oven every morning.</p></div>',
      "</body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });
});

describe("findContrastViolations — Greptile round 2 (PR #1107), continued", () => {
  it("finding 6: --bg and --BG are different properties (dark one wins its own name)", () => {
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --bg: #03050a; --BG: #ffffff; }",
      "  body { background: var(--bg); color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    expect(findContrastViolations(page).violations).toEqual([]);
  });

  it("finding 6: --bg and --BG are different properties (light one keeps its own value)", () => {
    // var(--bg) really is white here, so the light text really is
    // invisible — merging --BG into --bg would paint it dark and
    // the catch would be missed.
    const page = [
      "<!DOCTYPE html><html><head><style>",
      "  :root { --bg: #ffffff; --BG: #03050a; }",
      "  body { background: var(--bg); color: #f5f5f4; }",
      "</style></head><body><p>Fresh from the oven every morning.</p></body></html>",
    ].join("\n");
    const { violations } = findContrastViolations(page);
    expect(violations).toHaveLength(1);
    expect(violations[0].background).toBe("#ffffff");
  });
});

describe("color math", () => {
  it("parses hex, rgb, hsl and named colors", () => {
    expect(parseCssColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("#03050a")).toEqual({ r: 3, g: 5, b: 10, a: 1 });
    expect(parseCssColor("rgb(245, 245, 244)")).toEqual({ r: 245, g: 245, b: 244, a: 1 });
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")?.a).toBe(0.5);
    expect(parseCssColor("hsl(0 0% 100%)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("currentColor")).toBeNull();
    expect(parseCssColor("var(--ink)")).toBeNull();
  });

  it("computes WCAG ratios", () => {
    const white = parseCssColor("#ffffff")!;
    const black = parseCssColor("#000000")!;
    expect(contrastRatio(white, black)).toBeCloseTo(21, 0);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });
});

describe("checkTextContrast — read-back evidence rules", () => {
  const files = new Map<string, string>([["index.html", RUN2_PAGE]]);
  const readFile = async (p: string) => {
    const content = files.get(p);
    if (content === undefined) throw new Error(`404 not found: ${p}`);
    return { content };
  };

  it("checks only HTML candidates and attaches the path", async () => {
    const result = await checkTextContrast({
      candidatePaths: ["index.html", "src/app.ts", "styles.css"],
      readFile,
    });
    expect(result.applies).toBe(true);
    expect(result.checkedFiles).toEqual(["index.html"]);
    expect(result.violations.length).toBe(2);
    expect(result.violations.every((v) => v.path === "index.html")).toBe(true);
  });

  it("does not apply when nothing can be read back", async () => {
    const result = await checkTextContrast({
      candidatePaths: ["index.html"],
      readFile: async () => {
        throw new Error("gone");
      },
    });
    expect(result.applies).toBe(false);
    expect(result.violations).toEqual([]);
  });

  it("does not apply when the run mutated no HTML", async () => {
    const result = await checkTextContrast({ candidatePaths: ["src/app.ts"], readFile });
    expect(result.applies).toBe(false);
  });
});
