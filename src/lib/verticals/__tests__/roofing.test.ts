/**
 * Tests for the roofing vertical preset — the first
 * "idea into an operating business" slice.
 *
 * Covers: roofing detection, describe-once intake, profile → template
 * mapping (real facts in, empty slots for the rest, never fabricated),
 * template registration, and the publish honesty gate.
 */
import { describe, expect, it } from "vitest";

import { validateNoFabricatedContent } from "@/lib/publish/fabrication-guard";
import {
  ROOFING_VERTICAL,
  ROOFING_TEMPLATE_ID,
  buildRoofingSite,
  detectRoofingVertical,
  intakeRoofingBusiness,
  applyRoofingProfileToDocument,
} from "@/lib/verticals/roofing";
import { buildIntakeProfile } from "@/lib/business-profile";
import {
  STARTER_BUILDS,
  buildStarterPage,
} from "@/app/(app)/studio/components/canvas/builder/starter-builds";
import { SECTION_BLOCKS } from "@/app/(app)/studio/components/canvas/builder/section-blocks";
import { canvasToHtml } from "@/app/(app)/studio/components/canvas/builder/canvas-to-html";
import type { CanvasNode } from "@/app/(app)/studio/components/canvas/builder/types";

function nodeTexts(doc: { nodes: Record<string, CanvasNode> }): string[] {
  return Object.values(doc.nodes)
    .flatMap((n) => {
      const p = n.props as Record<string, unknown>;
      return ["text", "placeholder", "label", "alt"].flatMap((k) =>
        typeof p[k] === "string" ? [p[k] as string] : [],
      );
    });
}

describe("detectRoofingVertical", () => {
  it("detects a roofing company description", () => {
    const d = detectRoofingVertical(
      "I run a roofing company in Muskegon, MI. We do roof replacement and repairs.",
    );
    expect(d.isRoofing).toBe(true);
    expect(d.matchedKeywords).toContain("roofing");
    expect(d.typeInference.businessType).toBe("local-service");
  });

  it("detects roofer shorthand", () => {
    expect(detectRoofingVertical("Roofer looking for more jobs").isRoofing).toBe(true);
  });

  it("does not misfire on roofing software", () => {
    // "roofing software" infers saas-software, not local-service.
    const d = detectRoofingVertical("A roofing software startup with a dashboard for contractors");
    expect(d.isRoofing).toBe(false);
  });

  it("does not misfire on unrelated businesses", () => {
    expect(detectRoofingVertical("I sell handmade candles online").isRoofing).toBe(false);
    expect(detectRoofingVertical("").isRoofing).toBe(false);
  });
});

describe("intakeRoofingBusiness (describe once)", () => {
  it("points roofing businesses at the roofing template", () => {
    const { profile, detection } = intakeRoofingBusiness(
      '"Apex Roofing Co." in Grand Rapids, MI. We do roof replacement, repairs, and gutters. Call (616) 555-0142.',
    );
    expect(detection.isRoofing).toBe(true);
    expect(profile.recommendedTemplateId).toBe(ROOFING_TEMPLATE_ID);
    expect(profile.businessName).toBe("Apex Roofing Co.");
    expect(profile.phone).toContain("616");
    expect(profile.location).toContain("Grand Rapids");
  });

  it("leaves non-roofing recommendations alone", () => {
    const { profile } = intakeRoofingBusiness("I sell handmade candles online");
    expect(profile.recommendedTemplateId).not.toBe(ROOFING_TEMPLATE_ID);
  });
});

describe("roofing-site template registration", () => {
  it("is registered with honest, existing sections", () => {
    const build = STARTER_BUILDS.find((b) => b.id === ROOFING_TEMPLATE_ID);
    expect(build).toBeDefined();
    expect(build!.category).toBe("Website");
    const blockIds = new Set(SECTION_BLOCKS.map((b) => b.id));
    for (const sectionId of build!.sectionIds) {
      expect(blockIds.has(sectionId)).toBe(true);
    }
    // No fabricated social proof in a roofing template.
    expect(build!.sectionIds).not.toContain("testimonials");
    expect(build!.sectionIds).not.toContain("pricing-tiers");
    expect(build!.sectionIds).not.toContain("logo-cloud");
  });

  it("matches the vertical preset's templateId", () => {
    expect(ROOFING_VERTICAL.templateId).toBe(ROOFING_TEMPLATE_ID);
  });
});

describe("buildRoofingSite (profile → honest site)", () => {
  const fullProfile = buildIntakeProfile(
    '"Apex Roofing Co." in Muskegon, MI. We do roof replacement, repairs, and gutters. Call (231) 555-0100.',
  ).profile;

  it("maps real facts into the template", () => {
    const doc = buildRoofingSite(fullProfile);
    const texts = nodeTexts(doc).join("\n");
    expect(texts).toContain("Apex Roofing Co.");
    expect(texts).toContain("(231) 555-0100");
    expect(texts).toContain("Muskegon");
    // Real services replace the example cards.
    expect(texts).toContain("roof replacement");
    // No unmapped tokens leak through.
    expect(texts).not.toMatch(/\{\{\w+\}\}/);
  });

  it("renders clearly-empty slots when the owner provided nothing", () => {
    const doc = buildRoofingSite({});
    const texts = nodeTexts(doc).join("\n");
    expect(texts).toContain("[Your business name]");
    expect(texts).toContain("[Your phone number]");
    expect(texts).toContain("[Your service area]");
    expect(texts).not.toMatch(/\{\{\w+\}\}/);
    // Example service cards keep their honest framing.
    expect(texts).toMatch(/Example — describe/);
  });

  it("keeps the quote form fields the form backend expects", () => {
    const doc = buildRoofingSite(fullProfile);
    const forms = Object.values(doc.nodes).filter((n) => n.type === "form");
    expect(forms.length).toBeGreaterThan(0);
    const inputNames = Object.values(doc.nodes)
      .filter((n) => n.type === "input" || n.type === "textarea")
      .map((n) => (n.props as { inputName?: string }).inputName);
    expect(inputNames).toContain("name");
    expect(inputNames).toContain("phone");
    expect(inputNames).toContain("email");
    expect(inputNames).toContain("message");
  });

  it("passes the publish fabrication gate, filled or empty", () => {
    for (const profile of [fullProfile, {}]) {
      const html = canvasToHtml(buildRoofingSite(profile));
      const result = validateNoFabricatedContent({ files: [{ path: "index.html", content: html }] });
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});

describe("applyRoofingProfileToDocument", () => {
  it("is a no-op for documents without tokens", () => {
    const doc = buildStarterPage(STARTER_BUILDS.find((b) => b.id === "landing-page")!);
    const out = applyRoofingProfileToDocument(doc, { businessName: "X" });
    expect(nodeTexts(out).join("\n")).toBe(nodeTexts(doc).join("\n"));
  });
});
