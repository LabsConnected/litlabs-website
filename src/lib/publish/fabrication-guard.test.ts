/**
 * fabrication-guard tests — the pre-publish honesty check must catch
 * unedited template content without false-flagging real user content.
 */
import { describe, expect, it } from "vitest";

import {
  validateNoFabricatedContent,
  type FabricationCheckFile,
} from "./fabrication-guard";

function file(path: string, content: string): FabricationCheckFile {
  return { path, content };
}

describe("validateNoFabricatedContent", () => {
  it("passes a clean site with real-looking content", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<html><body><h1>Muskegon Dog Grooming</h1><p>Call (231) 555-0134 for appointments.</p><p>Basic bath $45, full groom $85.</p></body></html>`,
        ),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("passes when there are no files", () => {
    expect(validateNoFabricatedContent({ files: [] }).ok).toBe(true);
  });

  it("skips binary files", () => {
    const result = validateNoFabricatedContent({
      files: [file("hero.png", "Sarah Chen binary garbage\x00\x01")],
    });
    expect(result.ok).toBe(true);
  });

  it("detects invented testimonial names (case-insensitive)", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<div class="testimonial"><p>Great product!</p><span>sarah chen</span><span>CTO, TechFlow</span></div>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.section === "Testimonials");
    expect(v).toBeDefined();
    expect(v!.file).toBe("index.html");
    expect(v!.message).toContain("Testimonials");
    expect(v!.message).not.toMatch(/error|exception|stack|undefined/i);
  });

  it("flags each distinct fabricated name", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<p>"Loved it" — Sarah Chen</p><p>"Amazing" — Marcus Reid</p><p>"Wow" — Aisha Patel</p>`,
        ),
      ],
    });
    // One violation per section per file — names share the Testimonials section.
    expect(result.violations.filter((v) => v.section === "Testimonials")).toHaveLength(1);
  });

  it("detects LiTT-marketing hero copy", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<h1>Build Something Amazing</h1><p>Your vision, powered by LiTTree.</p>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.section === "Hero section")).toBe(true);
  });

  it("detects LiTT-marketing CTA copy", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<h2>Ready to Build Something Great?</h2><p>Join thousands of builders using LiTTree to ship faster.</p>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.section === "Call to action")).toBe(true);
  });

  it("detects the fake logo cloud by heading + company names", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<p>Trusted by teams at</p><div><span>Acme</span><span>Globex</span><span>Initech</span></div>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.section === "Logo cloud");
    expect(v).toBeDefined();
    expect(v!.message).toContain("logo cloud");
  });

  it("detects the fake logo cloud by names alone (4+ co-occurring)", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<div><span>Acme</span><span>Globex</span><span>Initech</span><span>Umbrella</span><span>Hooli</span></div>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.section === "Logo cloud")).toBe(true);
  });

  it("does NOT flag a single plausible company name", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<p>Our partners include Acme Plumbing of Muskegon.</p>`,
        ),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("detects the invented pricing table (plan names + prices)", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<h3>Starter</h3><p>$0</p><h3>Pro</h3><p>$29</p><h3>Enterprise</h3><p>$99</p>`,
        ),
      ],
    });
    expect(result.ok).toBe(false);
    const v = result.violations.find((x) => x.section === "Pricing");
    expect(v).toBeDefined();
    expect(v!.message).toContain("$0/$29/$99");
  });

  it("detects the invented pricing table by plan descriptions", () => {
    const result = validateNoFabricatedContent({
      files: [
        file("index.html", `<p>Perfect for trying out</p><p>For growing projects</p>`),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.section === "Pricing")).toBe(true);
  });

  it("does NOT flag a real business's own prices", () => {
    const result = validateNoFabricatedContent({
      files: [
        file(
          "index.html",
          `<h2>Pricing</h2><p>Basic bath $45</p><p>Full groom $85</p><p>De-shedding $65</p>`,
        ),
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("aggregates violations across files and sections", () => {
    const result = validateNoFabricatedContent({
      files: [
        file("index.html", `<h1>Build Something Amazing</h1>`),
        file("pricing.html", `<h3>Starter</h3><p>$0</p><h3>Pro</h3><p>$29</p><h3>Enterprise</h3><p>$99</p>`),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.file).sort()).toEqual(["index.html", "pricing.html"]);
  });

  it("includes a short matched excerpt with each violation", () => {
    const result = validateNoFabricatedContent({
      files: [file("index.html", `<p>"Loved it" — Sarah Chen, CTO</p>`)],
    });
    expect(result.violations[0].matched).toContain("Sarah Chen");
    expect(result.violations[0].matched.length).toBeLessThanOrEqual(140);
  });

  it("tolerates null/empty content without crashing", () => {
    const result = validateNoFabricatedContent({
      files: [
        { path: "index.html", content: "" },
        { path: "style.css", content: "body { color: red; }" },
      ],
    });
    expect(result.ok).toBe(true);
  });
});
