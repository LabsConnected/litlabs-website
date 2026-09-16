/**
 * Honesty regression tests for starter templates and section blocks.
 *
 * Starter templates must never ship fabricated social proof (invented
 * testimonials, fake client logos, invented pricing) or LiTT-marketing
 * copy as default content. They ship clearly-empty slots instead.
 *
 * The last test goes end-to-end: every starter page, exported to HTML,
 * must pass the real publish fabrication gate.
 */
import { describe, expect, it } from "vitest";

import { validateNoFabricatedContent } from "@/lib/publish/fabrication-guard";
import { SECTION_BLOCKS } from "./section-blocks";
import { STARTER_BUILDS, buildStarterPage } from "./starter-builds";
import { canvasToHtml } from "./canvas-to-html";
import {
  SECTION_TEMPLATES,
  collectCreatedNodes,
  createEmptyDocument,
  type CanvasNode,
} from "./types";

/** Phrases that must never appear in a fresh template. */
const FABRICATED_MARKERS = [
  // Invented testimonials
  "Sarah Chen",
  "Marcus Reid",
  "Aisha Patel",
  "TechFlow",
  "StartupX",
  "BigCorp",
  // Fake logo cloud
  "Acme",
  "Globex",
  "Initech",
  "Umbrella",
  "Hooli",
  // LiTT-marketing hero/CTA copy
  "powered by LiTTree",
  "Join thousands of builders",
  "Build Something Amazing",
  "Launch Faster with LiTT",
  "Ready to Build Something Great?",
  "Loved by Builders",
  "Trusted by teams at",
  // Invented pricing
  "Perfect for trying out",
  "For growing projects",
  "Unlimited everything",
  "$29",
  "$99",
  // Invented team members
  "Alex Rivera",
  "Sam Park",
  "Jordan Lee",
  "Casey Wu",
  // LiTT-marketing FAQ
  "How does LiTT work?",
];

function allTextOf(buildId: string): string {
  const build = STARTER_BUILDS.find((b) => b.id === buildId);
  if (!build) throw new Error(`unknown starter build ${buildId}`);
  const doc = buildStarterPage(build);
  return JSON.stringify(doc.nodes);
}

describe("starter templates contain no fabricated content", () => {
  for (const build of STARTER_BUILDS) {
    it(`"${build.id}" has no fabricated names, companies, copy, or prices`, () => {
      const text = allTextOf(build.id);
      for (const marker of FABRICATED_MARKERS) {
        expect(text, `starter "${build.id}" contains "${marker}"`).not.toContain(marker);
      }
    });
  }

  it("every section block is free of fabricated markers", () => {
    for (const block of SECTION_BLOCKS) {
      const { node, children } = block.build();
      const text = JSON.stringify([node, ...children]);
      for (const marker of FABRICATED_MARKERS) {
        expect(text, `block "${block.id}" contains "${marker}"`).not.toContain(marker);
      }
    }
  });

  it("testimonials ship as clearly-empty slots, not fake reviews", () => {
    const text = allTextOf("landing-page");
    expect(text).toContain("Add a real review from one of your customers");
    expect(text).toContain("Customer Name");
  });

  it("pricing ships as clearly-empty slots, not invented prices", () => {
    const text = allTextOf("landing-page");
    expect(text).toContain("Your Price");
    expect(text).toContain("Plan One");
  });

  it("logo cloud ships as clearly-empty slots, not fake companies", () => {
    // No starter build includes the logo cloud; exercise the block directly.
    const block = SECTION_BLOCKS.find((b) => b.id === "logo-cloud");
    if (!block) throw new Error("logo-cloud block missing");
    const { node, children } = block.build();
    const text = JSON.stringify([node, ...children]);
    expect(text).toContain("Your clients or partners");
    expect(text).toContain("Your Logo");
    for (const marker of ["Acme", "Globex", "Initech", "Umbrella", "Hooli", "Trusted by teams at"]) {
      expect(text, `logo cloud contains "${marker}"`).not.toContain(marker);
    }
  });

  it("hero and CTA ship as clearly-empty slots, not LiTT marketing", () => {
    const text = allTextOf("landing-page");
    expect(text).toContain("Your Headline Goes Here");
    expect(text).toContain("Your Call to Action");
  });

  it("empty hero image exports as a clean placeholder, not a broken <img>", () => {
    const html = canvasToHtml(buildStarterPage(STARTER_BUILDS.find((b) => b.id === "business-site")!));
    expect(html).not.toContain('<img src=""');
    expect(html).toContain("Add image");
  });

  it("every starter page's exported HTML passes the publish fabrication gate", () => {
    for (const build of STARTER_BUILDS) {
      const html = canvasToHtml(buildStarterPage(build));
      const result = validateNoFabricatedContent({
        files: [{ path: "index.html", content: html }],
      });
      expect(
        result.violations,
        `starter "${build.id}" trips the publish fabrication gate`,
      ).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });
});

describe("legacy copilot section templates contain no fabricated content", () => {
  // SECTION_TEMPLATES (types.ts) is what the LiTT copilot's addSection
  // action inserts into the canvas. They must meet the same honesty bar
  // as the palette blocks — purged at the source, not just at the gate.
  function templateNodes(templateId: string): CanvasNode[] {
    const template = SECTION_TEMPLATES.find((t) => t.id === templateId);
    if (!template) throw new Error(`unknown legacy template ${templateId}`);
    const created: CanvasNode[] = [];
    collectCreatedNodes(created, () => template.build());
    return created;
  }

  function templateHtml(templateId: string): string {
    const created = templateNodes(templateId);
    const base = createEmptyDocument();
    const rootId = base.rootNodeIds[0];
    const section = created.find((n) => n.type === "section");
    if (!section) throw new Error(`legacy template ${templateId} builds no section`);
    section.parentId = rootId;
    const nodes = { ...base.nodes };
    for (const n of created) nodes[n.id] = n;
    nodes[rootId] = { ...base.nodes[rootId], children: [section.id] };
    return canvasToHtml({ ...base, nodes });
  }

  for (const template of SECTION_TEMPLATES) {
    it(`legacy "${template.id}" has no fabricated names, companies, copy, or prices`, () => {
      const text = JSON.stringify(templateNodes(template.id));
      for (const marker of FABRICATED_MARKERS) {
        expect(text, `legacy template "${template.id}" contains "${marker}"`).not.toContain(marker);
      }
    });

    it(`legacy "${template.id}" exports HTML that passes the publish fabrication gate`, () => {
      const html = templateHtml(template.id);
      const result = validateNoFabricatedContent({
        files: [{ path: "index.html", content: html }],
      });
      expect(
        result.violations,
        `legacy template "${template.id}" trips the publish fabrication gate`,
      ).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});
