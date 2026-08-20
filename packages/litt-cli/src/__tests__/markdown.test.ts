/**
 * Terminal-safe markdown — dogfood P1 regression.
 *
 * Raw `**feat/litt-final-integration**` must never render literally in
 * the transcript. The renderer is pure + per-line so it is testable.
 */

import { describe, it, expect } from "vitest";
import { markdownLine, inlineSegments } from "../lib/markdown.js";

describe("markdownLine", () => {
  it("renders **bold** as a bold segment (no literal asterisks)", () => {
    const { segments, inCode } = markdownLine("**feat/litt-final-integration**", false);
    expect(segments).toEqual([{ text: "feat/litt-final-integration", bold: true }]);
    expect(inCode).toBe(false);
  });

  it("the exact observed dogfood line never contains literal **", () => {
    const { segments } = markdownLine("**29 changes**", false);
    const joined = segments.map((s) => s.text).join("");
    expect(joined).toBe("29 changes");
    expect(joined).not.toContain("**");
  });

  it("renders `inline code` as a dim segment", () => {
    const { segments } = markdownLine("Run `pnpm test` now", false);
    expect(segments).toContainEqual({ text: "pnpm test", dim: true });
    expect(segments.map((s) => s.text).join("")).toBe("Run pnpm test now");
  });

  it("mixes bold and code spans in one line", () => {
    const { segments } = markdownLine("**Status:** `clean`", false);
    expect(segments).toEqual([
      { text: "Status:", bold: true },
      { text: " ", },
      { text: "clean", dim: true },
    ]);
  });

  it("headers render bold without the #", () => {
    const { segments } = markdownLine("## Results", false);
    expect(segments).toEqual([{ text: "Results", bold: true }]);
  });

  it("blockquotes render dim", () => {
    const { segments } = markdownLine("> note here", false);
    expect(segments).toEqual([{ text: "> note here", dim: true }]);
  });

  it("code fences toggle state and hide the fence lines", () => {
    const open = markdownLine("```ts", false);
    expect(open.segments).toEqual([]);
    expect(open.inCode).toBe(true);

    const inside = markdownLine("const x = 1;", true);
    expect(inside.segments).toEqual([{ text: "const x = 1;", dim: true }]);
    expect(inside.inCode).toBe(true);

    const close = markdownLine("```", true);
    expect(close.segments).toEqual([]);
    expect(close.inCode).toBe(false);
  });

  it("plain prose passes through untouched", () => {
    const { segments } = markdownLine("Chrome is using the most memory right now.", false);
    expect(segments).toEqual([{ text: "Chrome is using the most memory right now.", }]);
  });

  it("lists are preserved as plain text", () => {
    const { segments } = markdownLine("- first item", false);
    expect(segments).toEqual([{ text: "- first item", }]);
  });
});

describe("inlineSegments", () => {
  it("empty text yields one empty segment", () => {
    expect(inlineSegments("")).toEqual([{ text: "" }]);
  });

  it("no spans yields a single plain segment", () => {
    expect(inlineSegments("plain")).toEqual([{ text: "plain" }]);
  });

  it("unmatched asterisks stay literal (do not invent markdown)", () => {
    const segments = inlineSegments("2 * 3 = 6");
    expect(segments.map((s) => s.text).join("")).toBe("2 * 3 = 6");
  });
});
