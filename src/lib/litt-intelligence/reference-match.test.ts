/**
 * Tests for the LiTT Reference-Match Workflow (Part H).
 *
 * Spec mapping:
 * - Test 4: "Match this visual reference" → reference-match route triggers
 *   inspection + visual verification.
 */
import { describe, it, expect } from "vitest";
import {
  isReferenceMatchRequest,
  hasReferenceArtifact,
  extractReferenceUrls,
  REFERENCE_MATCH_WORKFLOW,
  REFERENCE_EXTRACTION_CHECKLIST,
} from "./reference-match";

describe("isReferenceMatchRequest", () => {
  it("Test 4: detects 'make mine look like this'", () => {
    expect(isReferenceMatchRequest("Make mine look like this: https://example.com")).toBe(true);
  });

  it("detects 'match this quality'", () => {
    expect(isReferenceMatchRequest("Match this quality for my site")).toBe(true);
  });

  it("detects 'rebuild what I showed you'", () => {
    expect(isReferenceMatchRequest("Rebuild what I showed you yesterday")).toBe(true);
  });

  it("detects 'recreate this'", () => {
    expect(isReferenceMatchRequest("Recreate this design for my business")).toBe(true);
  });

  it("does not trigger on generic build requests", () => {
    expect(isReferenceMatchRequest("Build me a roofing website")).toBe(false);
    expect(isReferenceMatchRequest("Change the heading")).toBe(false);
  });
});

describe("hasReferenceArtifact", () => {
  it("detects pasted URLs", () => {
    expect(hasReferenceArtifact("Like this: https://example.com/site")).toBe(true);
  });

  it("detects screenshot mentions", () => {
    expect(hasReferenceArtifact("See the attached screenshot")).toBe(true);
  });
});

describe("extractReferenceUrls", () => {
  it("extracts and de-dupes URLs", () => {
    const urls = extractReferenceUrls(
      "Match https://a.com and https://a.com plus https://b.com/x",
    );
    expect(urls).toEqual(["https://a.com", "https://b.com/x"]);
  });

  it("returns empty array when no URLs", () => {
    expect(extractReferenceUrls("Make it look nice")).toEqual([]);
  });
});

describe("REFERENCE_MATCH_WORKFLOW", () => {
  it("covers the full inspect → compare → iterate loop", () => {
    expect(REFERENCE_MATCH_WORKFLOW).toContain("INSPECT THE REFERENCE");
    expect(REFERENCE_MATCH_WORKFLOW).toContain("EXTRACT THE VISUAL LANGUAGE");
    expect(REFERENCE_MATCH_WORKFLOW).toContain("VISUALLY COMPARE");
    expect(REFERENCE_MATCH_WORKFLOW).toContain("ITERATE");
    expect(REFERENCE_MATCH_WORKFLOW).toContain("REPORT what differs");
  });

  it("extraction checklist covers layout, typography, colors, structure", () => {
    const joined = REFERENCE_EXTRACTION_CHECKLIST.join(" ");
    expect(joined).toContain("layout");
    expect(joined).toContain("typography");
    expect(joined).toContain("colors");
    expect(joined).toContain("conversion flow");
  });
});
