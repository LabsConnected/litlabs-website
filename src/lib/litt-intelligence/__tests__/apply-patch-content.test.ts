import { describe, expect, it } from "vitest";
import {
  applyPatchToContent,
  applyPatchesToContent,
} from "../apply-patch-content";

const FOOTER_HTML = `<footer>
      <p>&copy; 2024 Ember Roast. All rights reserved.</p>
    </footer>`;

describe("applyPatchToContent", () => {
  it("applies an exact search/replace", () => {
    const out = applyPatchToContent("index.html", "<h1>Hi</h1>", {
      type: "search_replace",
      search: "<h1>Hi</h1>",
      replace: "<h1>Bye</h1>",
    });
    expect(out).toBe("<h1>Bye</h1>");
  });

  it("applies a whitespace-tolerant match when only indentation differs", () => {
    const search = "<footer>\n  <p>&copy; 2024 Ember Roast. All rights reserved.</p>\n</footer>";
    const out = applyPatchToContent("index.html", FOOTER_HTML, {
      type: "search_replace",
      search,
      replace: "<footer><p>Golden Acceptance follow-up verified</p></footer>",
    });
    expect(out).toBe("<footer><p>Golden Acceptance follow-up verified</p></footer>");
  });

  it("throws the miss error when a whitespace-tolerant match is ambiguous", () => {
    const content = "<div>\n  <p>x</p>\n</div>\n<div>\n    <p>x</p>\n</div>";
    const patch = {
      type: "search_replace" as const,
      search: "<div>\n  <p>x</p>\n</div>",
      replace: "<div>y</div>",
    };
    // Exact match succeeds on the first div — use a search absent exactly
    // but whitespace-matching both divs.
    const ambiguous = {
      type: "search_replace" as const,
      search: "<div>\n      <p>x</p>\n</div>",
      replace: "<div>y</div>",
    };
    expect(content.includes(patch.search)).toBe(true); // sanity
    expect(() => applyPatchToContent("index.html", content, ambiguous)).toThrow(
      "Patch search string not found",
    );
  });

  it("quotes the closest file region on an entity mismatch so the model can self-correct", () => {
    // Reproduces the production golden failure: the model searched
    // `"c 2024 Ember Roast…"` while the file holds `&copy; 2024…`.
    const err = (() => {
      try {
        applyPatchToContent("index.html", FOOTER_HTML, {
          type: "search_replace",
          search: "<p>c 2024 Ember Roast. All rights reserved.</p>",
          replace: "<p>Golden Acceptance follow-up verified</p>",
        });
        return "";
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(err).toContain("Patch search string not found in index.html");
    expect(err).toContain("&copy; 2024 Ember Roast");
    expect(err).toContain("exact bytes");
  });

  it("keeps the bare miss error when no recognizable anchor exists", () => {
    expect(() =>
      applyPatchToContent("index.html", "<html><body>unrelated</body></html>", {
        type: "search_replace",
        search: "<section id='nowhere'>zzz</section>",
        replace: "x",
      }),
    ).toThrow('Patch search string not found in index.html: "<section id=\'nowhere\'>');
  });

  it("does not treat a no-op patch as an error", () => {
    const out = applyPatchToContent("index.html", "abc", {
      type: "search_replace",
      search: "b",
      replace: "b",
    });
    expect(out).toBe("abc");
  });
});

describe("applyPatchesToContent", () => {
  it("applies patches sequentially, each against the prior result", () => {
    const { updated } = applyPatchesToContent("index.html", "<h1>A</h1><h2>B</h2>", [
      { type: "search_replace", search: "<h1>A</h1>", replace: "<h1>C</h1>" },
      { type: "search_replace", search: "<h2>B</h2>", replace: "<h2>C</h2>" },
    ]);
    expect(updated).toBe("<h1>C</h1><h2>C</h2>");
  });

  it("fails the batch when a later patch misses", () => {
    expect(() =>
      applyPatchesToContent("index.html", "<h1>A</h1>", [
        { type: "search_replace", search: "<h1>A</h1>", replace: "<h1>B</h1>" },
        { type: "search_replace", search: "absent-marker", replace: "x" },
      ]),
    ).toThrow("Patch search string not found");
  });
});
