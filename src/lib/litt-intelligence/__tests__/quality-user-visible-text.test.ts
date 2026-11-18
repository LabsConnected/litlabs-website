import { describe, expect, it } from "vitest";
import { stripQualityStageMarkers } from "../quality-loop-flow";

/**
 * Chat beauty regression (2026-11-11): QUALITY stage declarations are
 * machine-readable evidence harvested from the model's text — they are
 * not user prose. The agent loop's user-visible final text must carry
 * the answer without the marker lines, while the harvester (which runs
 * BEFORE this, on the raw text) keeps the evidence.
 */
describe("stripQualityStageMarkers — user-visible final text", () => {
  it("removes leading marker lines and keeps the answer", () => {
    const raw =
      "QUALITY: understand — Dog owners in the suburbs; goal is bookings.\n" +
      "QUALITY: plan — One page: hero, services, contact.\n" +
      "\n" +
      "Here are the files in your project: index.html and assets/.";
    expect(stripQualityStageMarkers(raw)).toBe(
      "Here are the files in your project: index.html and assets/.",
    );
  });

  it("removes markers interleaved with prose without eating the prose", () => {
    const raw =
      "First paragraph stays.\n" +
      "QUALITY: design — Warm palette, big type.\n" +
      "Second paragraph stays too.";
    expect(stripQualityStageMarkers(raw)).toBe(
      "First paragraph stays.\nSecond paragraph stays too.",
    );
  });

  it("handles the hyphen and colon separator forms the harvester accepts", () => {
    expect(stripQualityStageMarkers("QUALITY: build - wrote the file\nDone.")).toBe("Done.");
    expect(stripQualityStageMarkers("quality: test: checks ran\nDone.")).toBe("Done.");
  });

  it("preserves lines that are not valid stage declarations", () => {
    // Unknown stage — the harvester ignores it, so it is prose, not evidence.
    const unknown = "QUALITY: teleport — impossible stage\nReal answer.";
    expect(stripQualityStageMarkers(unknown)).toBe(unknown);
    // A marker mentioned mid-sentence is prose, not a declaration line.
    const mention = "The QUALITY: understand — line is an internal marker.\nReal answer.";
    expect(stripQualityStageMarkers(mention)).toBe(mention);
    // Ordinary prose is untouched.
    const prose = "Quality matters here.\n\nYour site is ready.";
    expect(stripQualityStageMarkers(prose)).toBe(prose);
  });

  it("returns an empty string when the reply was only declarations", () => {
    expect(
      stripQualityStageMarkers("QUALITY: understand — noted.\nQUALITY: plan — noted."),
    ).toBe("");
  });
});
