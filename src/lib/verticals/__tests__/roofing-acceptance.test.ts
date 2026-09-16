/**
 * Step 3.3 — roofing vertical acceptance: the stranger test, scripted.
 *
 * A stranger describes their roofing business once. The vertical must:
 *   1. detect roofing from the free-text description,
 *   2. build an honest site with their real facts mapped in,
 *   3. pass the publish fabrication gate on the built site,
 *   4. export a quote form wired to the platform form backend,
 *   5. (production, recorded manually) publish → submit a lead →
 *      owner sees it in the inbox.
 *
 * This file covers 1–4. Step 5 is the recorded manual pass against
 * production; its evidence lives in the step-3 report.
 *
 * Run: npx vitest run src/lib/verticals/__tests__/roofing-acceptance.test.ts
 */

import { describe, it, expect } from "vitest";
import { detectRoofingVertical, intakeRoofingBusiness, buildRoofingSite } from "../roofing";
import { canvasToHtml } from "@/app/(app)/studio/components/canvas/builder/canvas-to-html";
import { validateNoFabricatedContent } from "@/lib/publish/fabrication-guard";

// The stranger's one description — plain words, no structure.
const STRANGER_SAYS =
  "Hey, I'm Mike, I run Mike's Roofing here in Muskegon MI. " +
  "We do residential roof repair and full replacements, also gutters. " +
  "Been doing this 15 years. Call us at 231-555-0147 or email mike@mikesroofing.example. " +
  "We're usually the cheapest quote in town, licensed and insured.";

describe("step 3.3 — stranger acceptance (scripted)", () => {
  it("1. detects the roofing vertical from a plain description", () => {
    expect(detectRoofingVertical(STRANGER_SAYS).isRoofing).toBe(true);
    // And does NOT fire for unrelated businesses.
    expect(detectRoofingVertical("I sell handmade candles online").isRoofing).toBe(false);
  });

  it("2. builds an honest site with the stranger's real facts", () => {
    const { profile, build } = intakeRoofingBusiness(STRANGER_SAYS);
    expect(profile.businessName).toContain("Mike");
    expect(profile.phone).toContain("231-555-0147");
    expect(profile.email).toContain("mike@mikesroofing.example");
    expect(profile.location).toContain("Muskegon");

    const doc = buildRoofingSite(profile, build);
    const html = canvasToHtml(doc, { deploymentId: "dep_acceptance" });

    // Real facts are on the page…
    expect(html).toContain("231-555-0147");
    expect(html).toContain("mike@mikesroofing.example");
    expect(html).toContain("Muskegon");
    // …and nothing is fabricated: no fake testimonials, ratings, or prices.
    expect(html).not.toMatch(/testimonial/i);
    expect(html).not.toMatch(/\b4\.\d\s*stars?\b/i);
    expect(html).not.toMatch(/\$\d+\s*(per|for|starting)/i);
    // Empty slots are clearly empty, not silently blank or invented.
    const emptyBuild = buildRoofingSite({ businessName: "Mike's Roofing" }, build);
    const emptyHtml = canvasToHtml(emptyBuild);
    expect(emptyHtml).toContain("[Your phone number]");
  });

  it("3. the built site passes the publish fabrication gate", () => {
    const { profile, build } = intakeRoofingBusiness(STRANGER_SAYS);
    const html = canvasToHtml(buildRoofingSite(profile, build), { deploymentId: "dep_acceptance" });
    const result = validateNoFabricatedContent({ files: [{ path: "index.html", content: html }] });
    expect(result.violations).toEqual([]);
  });

  it("4. the quote form is wired to the platform form backend", () => {
    const { profile, build } = intakeRoofingBusiness(STRANGER_SAYS);
    const html = canvasToHtml(buildRoofingSite(profile, build), { deploymentId: "dep_acceptance" });

    // Posts to the platform backend with the deployment id…
    expect(html).toContain('action="/api/forms/submit"');
    expect(html).toContain('name="deploymentId" value="dep_acceptance"');
    expect(html).toContain('data-litt-form-name="Roofing Quote"');
    // …carries the fields the backend maps to a lead…
    expect(html).toContain('name="name"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
    // …and degrades honestly without JS / without a deployment id.
    const previewHtml = canvasToHtml(buildRoofingSite(profile, build));
    expect(previewHtml).toContain('name="deploymentId" value=""');
    expect(previewHtml).toContain("connects automatically when the site is published");
  });
});
