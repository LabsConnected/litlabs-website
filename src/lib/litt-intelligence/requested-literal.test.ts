import { describe, it, expect, vi } from "vitest";
import {
  extractExpectedLiteral,
  contentContainsLiteral,
  checkRequestedLiteral,
} from "./requested-literal";

/**
 * ACC-01 F9 — the requested-literal check. The staging failure: "Change
 * the tagline … to Fresh from the oven every morning" landed as "Fresh
 * from1 the oven every morning." and was reported as success.
 */
describe("extractExpectedLiteral", () => {
  it("extracts the trailing span after ' to ' for a change instruction (the F9 phrasing)", () => {
    expect(
      extractExpectedLiteral(
        "Change the tagline under the bakery name to Fresh from the oven every morning",
      ),
    ).toBe("Fresh from the oven every morning");
  });

  it("trims the trailing sentence period from the trailing span", () => {
    expect(extractExpectedLiteral("Update the footer text to Copyright 2026.")).toBe(
      "Copyright 2026",
    );
  });

  it("prefers the quoted span after ' to ' when both sides are quoted", () => {
    expect(extractExpectedLiteral('Change "Hello there" to "Hello world"')).toBe(
      "Hello world",
    );
  });

  it("uses a lone quoted span in an edit instruction", () => {
    expect(extractExpectedLiteral("Set the page title to 'My Bakery'")).toBe("My Bakery");
    expect(extractExpectedLiteral('Rename the heading to "Fresh Bakes Daily"')).toBe(
      "Fresh Bakes Daily",
    );
  });

  it("returns null for a paraphrased content addition (no literal specified)", () => {
    expect(
      extractExpectedLiteral("mention fresh pastries in the welcome paragraph"),
    ).toBeNull();
  });

  it("returns null when the 'to' tail opens with an instruction verb (paraphrase, not content)", () => {
    // Real shape from the golden follow-up suite: the model is asked
    // for content in its own words; gating on this tail would fail an
    // honest edit.
    expect(
      extractExpectedLiteral("update the footer to include the verification marker"),
    ).toBeNull();
    expect(extractExpectedLiteral("change the banner to say something welcoming")).toBeNull();
  });

  it("returns null when the 'to' tail names a file destination, not content", () => {
    // Staging acceptance 45904303510: "…include exactly: <marker>. Keep the
    // rest of the site unchanged and save the edit to index.html" — the last
    // " to " precedes the filename, so the extractor gated on "index.html"
    // and failed an edit that had landed the requested marker.
    expect(
      extractExpectedLiteral(
        "Change the hero text to include exactly: Golden Acceptance follow-up verified. Keep the rest of the site unchanged and save the edit to index.html",
      ),
    ).toBeNull();
    expect(extractExpectedLiteral("Update the page and write the result to out.json")).toBeNull();
    expect(extractExpectedLiteral("Apply the change to src/app.tsx")).toBeNull();
  });

  it("still extracts real content tails that happen to contain a dot", () => {
    // "v2.0" has no path separator and its dot-suffix is numeric-ish but the
    // tail contains a space, so it is content, not a path.
    expect(extractExpectedLiteral("Update the version label to v2.0 final")).toBe("v2.0 final");
  });

  it("returns null for non-edit instructions, even with quoted spans", () => {
    expect(
      extractExpectedLiteral('Build a one-page site for a bakery called "Sunny Crust"'),
    ).toBeNull();
    expect(extractExpectedLiteral("Make the header bigger")).toBeNull();
    expect(extractExpectedLiteral("Build a landing page for a coffee shop")).toBeNull();
  });

  it("returns null when the tail is a question, not a literal", () => {
    expect(
      extractExpectedLiteral("How do I change the title to something better?"),
    ).toBeNull();
  });

  it("returns null for spans shorter than 3 chars", () => {
    expect(extractExpectedLiteral("Change the label to OK")).toBeNull();
    expect(extractExpectedLiteral('Set the badge to "New"')).toBe("New");
  });

  // Greptile PR #1106, finding 2: the extractor could demand the WRONG
  // text — the source being replaced, or a style value that valid code
  // expresses differently. A skipped check is always better than a
  // wrong one.
  it("never demands the SOURCE text when the replacement is unquoted (Greptile example A)", () => {
    // The only quoted span sits BEFORE " to " — it is the text being
    // replaced. Demanding it would order a repair that restores the
    // old text after a correct replacement.
    expect(extractExpectedLiteral('Change "Hello there" to Welcome back')).toBeNull();
  });

  it("does not enforce an unquoted style value (Greptile example B)", () => {
    // "dark blue" is a style descriptor; valid CSS may express it as a
    // hex color, so the words need never appear in any file.
    expect(extractExpectedLiteral("Change the background to dark blue")).toBeNull();
    expect(extractExpectedLiteral("Change the text color to red")).toBeNull();
  });

  it("still extracts a quoted replacement after ' to '", () => {
    expect(extractExpectedLiteral('Change the tagline to "Fresh daily"')).toBe("Fresh daily");
  });

  it("extracts the replacement after ' with ' when both sides are quoted", () => {
    expect(extractExpectedLiteral('Replace "old slogan" with "new slogan"')).toBe("new slogan");
  });

  it("extracts a quoted span presented by a read/say pattern with no separator", () => {
    expect(extractExpectedLiteral('Correct the sign so it reads "Open daily"')).toBe("Open daily");
  });

  // Greptile PR #1106, round 2: the separator search found the
  // " to " INSIDE the quoted replacement ("Welcome to our bakery"),
  // concluded no quote followed the separator, and returned null —
  // quoted replacements containing separator words skipped
  // verification entirely.
  it("extracts a quoted replacement that itself contains ' to ' (Greptile round 2)", () => {
    expect(extractExpectedLiteral('Change the heading to "Welcome to our bakery"')).toBe(
      "Welcome to our bakery",
    );
    expect(extractExpectedLiteral("Change the heading to 'Welcome to our bakery'")).toBe(
      "Welcome to our bakery",
    );
  });

  it("extracts a quoted replacement containing both ' to ' and ' with '", () => {
    expect(
      extractExpectedLiteral('Change the heading to "Welcome to our bakery with fresh bread daily"'),
    ).toBe("Welcome to our bakery with fresh bread daily");
  });

  it("keeps round-1 source rules when the quoted SOURCE contains ' to '", () => {
    // The quoted span is the text being replaced; with an unquoted
    // replacement the check stays off (round-1 rule), and with a
    // quoted replacement the span AFTER the real separator wins.
    expect(extractExpectedLiteral('Change "back to basics" to plain text')).toBeNull();
    expect(extractExpectedLiteral('Change "back to basics" to "Fresh start"')).toBe("Fresh start");
  });
});

describe("contentContainsLiteral", () => {
  it("matches across whitespace differences (re-wrapped lines)", () => {
    expect(
      contentContainsLiteral(
        "<p>Fresh from\n   the oven    every morning.</p>",
        "Fresh from the oven every morning",
      ),
    ).toBe(true);
  });

  it("does NOT match the F9 corruption (stray character, dropped space)", () => {
    expect(
      contentContainsLiteral(
        "<p>Fresh from1 the oven every morning.</p>",
        "Fresh from the oven every morning",
      ),
    ).toBe(false);
  });

  // Greptile PR #1106, finding 3: files store text HTML-escaped, so a
  // literal containing & < > or quotes can be present and correct yet
  // never match the raw comparison — an unpassable check.
  it("matches a literal whose & is stored HTML-escaped as &amp;", () => {
    expect(
      contentContainsLiteral(
        "<p>Coffee &amp; pastries served daily</p>",
        "Coffee & pastries served daily",
      ),
    ).toBe(true);
  });

  it("matches a literal with tag-like text stored escaped", () => {
    expect(contentContainsLiteral("Use &lt;b&gt; for bold text", "Use <b> for bold text")).toBe(
      true,
    );
    expect(
      contentContainsLiteral("Say &quot;hello&quot; to everyone", 'Say "hello" to everyone'),
    ).toBe(true);
  });

  it("escaping does not invent a match for text that is not there", () => {
    expect(
      contentContainsLiteral("<p>Coffee &amp; pastries</p>", "Coffee & pastries served daily"),
    ).toBe(false);
  });
});

describe("checkRequestedLiteral", () => {
  const instruction =
    "Change the tagline under the bakery name to Fresh from the oven every morning";

  it("applies and finds the literal when a mutated file contains it", async () => {
    const readFile = vi.fn(async () => ({
      content: "<p>Fresh from the oven every morning.</p>",
    }));
    const result = await checkRequestedLiteral({
      instruction,
      candidatePaths: ["index.html"],
      readFile,
    });
    expect(result.applies).toBe(true);
    expect(result.found).toBe(true);
    expect(result.literal).toBe("Fresh from the oven every morning");
    expect(result.checkedFiles).toEqual(["index.html"]);
  });

  it("applies and reports a miss when the mutated file holds the corrupted variant", async () => {
    const readFile = vi.fn(async () => ({
      content: "<p>Fresh from1 the oven every morning.</p>",
    }));
    const result = await checkRequestedLiteral({
      instruction,
      candidatePaths: ["index.html"],
      readFile,
    });
    expect(result.applies).toBe(true);
    expect(result.found).toBe(false);
  });

  it("does not apply when no literal was specified", async () => {
    const readFile = vi.fn(async () => ({ content: "anything" }));
    const result = await checkRequestedLiteral({
      instruction: "mention fresh pastries in the welcome paragraph",
      candidatePaths: ["index.html"],
      readFile,
    });
    expect(result.applies).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("does not apply when no mutated file can be read back", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("404 not found");
    });
    const result = await checkRequestedLiteral({
      instruction,
      candidatePaths: ["index.html"],
      readFile,
    });
    expect(result.applies).toBe(false);
    expect(result.found).toBe(false);
  });

  it("ignores non-text candidate paths", async () => {
    const readFile = vi.fn(async () => ({ content: "Fresh from the oven every morning" }));
    const result = await checkRequestedLiteral({
      instruction,
      candidatePaths: ["assets/logo.png"],
      readFile,
    });
    expect(result.applies).toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });

  // Greptile PR #1106, finding 5: the candidate cap (8) silently
  // truncated the evidence — a literal landing in the 9th changed
  // file read as a confirmed miss and failed an honest run.
  const ninePages = Array.from({ length: 9 }, (_, i) => `page${i + 1}.html`);
  const literalInNinth = async (path: string) => ({
    content:
      path === "page9.html"
        ? "<p>Fresh from the oven every morning.</p>"
        : "<p>unrelated content</p>",
  });

  it("does not apply when the candidate cap truncated the evidence and the literal was not found", async () => {
    const result = await checkRequestedLiteral({
      instruction,
      candidatePaths: ninePages,
      readFile: literalInNinth,
    });
    // The literal IS in a changed file — just beyond the cap. The
    // verdict must be "unknown" (applies: false), never a miss.
    expect(result.found).toBe(false);
    expect(result.applies).toBe(false);
  });

  it("checks the file the instruction named first, ahead of the cap", async () => {
    const result = await checkRequestedLiteral({
      instruction:
        "In page9.html, change the tagline to Fresh from the oven every morning",
      candidatePaths: ninePages,
      readFile: literalInNinth,
    });
    expect(result.applies).toBe(true);
    expect(result.found).toBe(true);
    expect(result.checkedFiles).toContain("page9.html");
  });
});
