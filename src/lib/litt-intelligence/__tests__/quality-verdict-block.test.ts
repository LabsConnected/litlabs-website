/**
 * Regression tests for the quality verdict text block.
 *
 * The agent loop appends the verdict as a compact collapsed markdown
 * checklist (```quality-checklist fenced block) instead of a plain-text
 * line. The approval-resume path must keep stripping the whole trailing
 * block — the "Quality check — " marker line is the contract between the
 * formatter and the stripper.
 */
import { describe, expect, it } from "vitest";
import {
  formatQualityVerdictBlock,
  stripQualityVerdictSuffix,
  type QualityFinale,
} from "../quality-loop-flow";

function makeFinale(): QualityFinale {
  return {
    verdict: {
      ok: false,
      missing: ["deploy"],
      reason: 'Cannot declare success: 1 required stage(s) lack evidence: "deploy" (failed).',
    },
    stages: [
      { stage: "understand", status: "passed", evidenceCount: 2 },
      { stage: "build", status: "passed", evidenceCount: 1 },
      { stage: "deploy", status: "failed", evidenceCount: 1 },
      { stage: "verify", status: "pending", evidenceCount: 0 },
    ],
    designPasses: 0,
    unfiledObservations: 0,
  };
}

describe("formatQualityVerdictBlock", () => {
  it("starts with the strippable 'Quality check — ' marker line", () => {
    const block = formatQualityVerdictBlock(makeFinale());
    expect(block.startsWith("\n\nQuality check — ")).toBe(true);
  });

  it("keeps the verdict reason text (lowercased first letter, as before)", () => {
    const block = formatQualityVerdictBlock(makeFinale());
    expect(block).toContain(
      'cannot declare success: 1 required stage(s) lack evidence: "deploy" (failed).',
    );
  });

  it("renders one ✓/✗/○ line per stage inside a quality-checklist fence", () => {
    const block = formatQualityVerdictBlock(makeFinale());
    expect(block).toContain("```quality-checklist");
    expect(block).toContain("✓ understand — passed");
    expect(block).toContain("✓ build — passed");
    expect(block).toContain("✗ deploy — failed");
    expect(block).toContain("○ verify — pending");
    expect(block.trimEnd().endsWith("```")).toBe(true);
  });
});

describe("stripQualityVerdictSuffix", () => {
  it("removes the new-format verdict block (marker + checklist) entirely", () => {
    const finalText = "The site is live and working." + formatQualityVerdictBlock(makeFinale());
    expect(stripQualityVerdictSuffix(finalText)).toBe("The site is live and working.");
  });

  it("still removes the legacy plain-text verdict suffix", () => {
    const finalText =
      "The site is live.\n\nQuality check — cannot declare success: deploy failed.";
    expect(stripQualityVerdictSuffix(finalText)).toBe("The site is live.");
  });

  it("leaves ordinary model output untouched", () => {
    const finalText = "Here is a summary:\n\n- Quality check — just a phrase in prose";
    expect(stripQualityVerdictSuffix(finalText)).toBe(finalText);
  });

  it("round-trips: format then strip restores the original text", () => {
    const original = "Done. Preview at https://example.com.";
    const withVerdict = original + formatQualityVerdictBlock(makeFinale());
    expect(stripQualityVerdictSuffix(withVerdict)).toBe(original);
  });
});
