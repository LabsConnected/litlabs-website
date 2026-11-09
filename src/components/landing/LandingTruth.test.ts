import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("public landing demo truth", () => {
  const source = readFileSync(join(__dirname, "LandingHeroV3.tsx"), "utf-8");

  const homePage = readFileSync(join(__dirname, "../../app/HomePageClient.tsx"), "utf-8");
  const simulatedDemo = readFileSync(join(__dirname, "InteractiveProductDemo.tsx"), "utf-8");
  const realProject = readFileSync(join(__dirname, "RealProjectWalkthrough.tsx"), "utf-8");

  it("places the real walkthrough before feature sections without changing the simulated demo label", () => {
    expect(homePage).toContain("<LandingHeroV3 />");
    expect(homePage).toContain("<RealProjectWalkthrough />");
    expect(homePage.indexOf("<LandingHeroV3 />")).toBeLessThan(homePage.indexOf("<RealProjectWalkthrough />"));
    expect(homePage.indexOf("<RealProjectWalkthrough />")).toBeLessThan(homePage.indexOf("<CapabilityGrid />"));
    expect(simulatedDemo).toContain("Interactive product demonstration");
    expect(simulatedDemo).toContain('text-white/20">Demo</span>');
    expect(realProject).toContain("not a continuous live recording");
  });

  it("labels synthetic runtime activity as an example or recorded preview", () => {
    expect(source).toContain("Example activity");
    expect(source).toContain("Recorded preview");
    expect(source).toContain("Example mission");
    expect(source).toContain("Recorded Studio preview");
    expect(source).not.toContain("Missions active");
    expect(source).not.toContain("Current mission");
    expect(source).not.toContain("✓ workspace loaded");
    expect(source).not.toContain("✓ verification passed");
  });
});
