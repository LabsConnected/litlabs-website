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
});
