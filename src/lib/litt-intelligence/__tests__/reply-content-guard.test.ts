import { describe, it, expect } from "vitest";
import {
  stripWrittenFileDumps,
  userAskedToSeeFileContents,
} from "../quality-loop-flow";

/**
 * Reply-content guard: a build run's closing message must summarize,
 * never paste the files it just wrote. Larry hit this on production
 * mobile (2026-11-25): the entire index.html landed in chat. The
 * model re-emits content it authored in its own files.write call —
 * files.write itself returns only a short receipt — so the guard
 * compares the final reply against THIS run's written contents.
 */

const PAGE = [
  "<!DOCTYPE html>",
  "<html>",
  "<head><title>Sunny Crust Bakery</title>",
  "<style>",
  "  body { background: #03050a; }",
  "  h1 { color: #f5f5f4; }",
  "  .tagline { color: #e7e5e4; }",
  "  p { color: #e7e5e4; }",
  "</style>",
  "</head>",
  "<body>",
  "  <h1>Sunny Crust Bakery</h1>",
  '  <p class="tagline">Fresh from the oven every morning.</p>',
  "  <p>Blueberry muffins — $4</p>",
  "</body>",
  "</html>",
].join("\n");

const WRITTEN = [{ path: "index.html", content: PAGE }];
const REFERENCE = "index.html — written in this run; open it in Code to view.";

describe("stripWrittenFileDumps — verbatim dumps of files written this run", () => {
  it("replaces a fenced verbatim dump with a one-line reference, keeping the prose", () => {
    const reply = [
      "Your bakery site is built.",
      "",
      "```html",
      PAGE,
      "```",
      "",
      "Let me know if you want changes.",
    ].join("\n");
    const out = stripWrittenFileDumps(reply, WRITTEN);
    expect(out).toContain(REFERENCE);
    expect(out).toContain("Your bakery site is built.");
    expect(out).toContain("Let me know if you want changes.");
    expect(out).not.toContain("Fresh from the oven every morning.");
    expect(out).not.toContain("Blueberry muffins");
  });

  it("drops the 'here's the content' lead-in line that introduces a dump", () => {
    const reply = [
      "Built it. Here's the content of the index.html file:",
      "",
      "```html",
      PAGE,
      "```",
    ].join("\n");
    const out = stripWrittenFileDumps(reply, WRITTEN);
    expect(out).toContain(REFERENCE);
    expect(out).not.toContain("Here's the content");
    expect(out).toContain("Built it.");
  });

  it("replaces an unfenced verbatim dump (long line run) the same way", () => {
    const reply = ["Done — here is the file:", PAGE, "", "Enjoy."].join("\n");
    const out = stripWrittenFileDumps(reply, WRITTEN);
    expect(out).toContain(REFERENCE);
    expect(out).toContain("Enjoy.");
    expect(out).not.toContain("Fresh from the oven every morning.");
    expect(out).not.toContain("<!DOCTYPE html>");
  });

  it("collapses a single fenced block longer than 40 lines even without a verbatim match", () => {
    const longBlock = Array.from({ length: 55 }, (_, i) => `  <div class="row-${i}">generated row ${i}</div>`).join("\n");
    const reply = ["Here is the markup I generated:", "", "```html", longBlock, "```"].join("\n");
    const out = stripWrittenFileDumps(reply, WRITTEN);
    expect(out).not.toContain("generated row 30");
    expect(out).toContain("open it in Code to view.");
  });
});

describe("stripWrittenFileDumps — preservation", () => {
  it("leaves a short code snippet untouched, even when its lines appear in a written file", () => {
    const reply = [
      "Done — the hero now uses the dark background:",
      "",
      "```css",
      "  body { background: #03050a; }",
      "  h1 { color: #f5f5f4; }",
      "```",
      "",
      "Everything else is unchanged.",
    ].join("\n");
    expect(stripWrittenFileDumps(reply, WRITTEN)).toBe(reply);
  });

  it("leaves the reply untouched when the user explicitly asked to see the contents", () => {
    const reply = ["Here you go:", "", "```html", PAGE, "```"].join("\n");
    expect(
      stripWrittenFileDumps(reply, WRITTEN, { userAskedForContents: true }),
    ).toBe(reply);
  });

  it("never alters a reply when this run wrote no files (non-build turn)", () => {
    const longBlock = Array.from({ length: 55 }, (_, i) => `line ${i} of an example`).join("\n");
    const reply = ["Example output:", "", "```", longBlock, "```"].join("\n");
    expect(stripWrittenFileDumps(reply, [])).toBe(reply);
  });

  it("leaves a silent-outcome style factual summary untouched", () => {
    const silent =
      "I completed 2 step(s), including 1 change(s) to the workspace, but produced no closing summary. Review the work log for what changed.";
    expect(stripWrittenFileDumps(silent, WRITTEN)).toBe(silent);
  });

  it("returns empty and short replies unchanged", () => {
    expect(stripWrittenFileDumps("", WRITTEN)).toBe("");
    expect(stripWrittenFileDumps("Done.", WRITTEN)).toBe("Done.");
  });
});

describe("userAskedToSeeFileContents — conservative explicit-ask detection", () => {
  it("detects explicit asks to display file content in chat", () => {
    expect(userAskedToSeeFileContents("Build the page, then show me the full content of the file in chat.")).toBe(true);
    expect(userAskedToSeeFileContents("Print the contents of index.html here.")).toBe(true);
    expect(userAskedToSeeFileContents("Paste the code for the file into the chat.")).toBe(true);
    expect(userAskedToSeeFileContents("What's in the file right now?")).toBe(true);
  });

  it("does not misfire on ordinary build or chat requests", () => {
    expect(userAskedToSeeFileContents("Build a one-page website for a bakery called Sunny Crust Bakery")).toBe(false);
    expect(userAskedToSeeFileContents("Show me the preview when it's done")).toBe(false);
    expect(userAskedToSeeFileContents("Make the headline text bigger and show the hours")).toBe(false);
    expect(userAskedToSeeFileContents("What's up")).toBe(false);
    expect(userAskedToSeeFileContents("")).toBe(false);
  });
});
