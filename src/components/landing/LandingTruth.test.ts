import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("public landing demo truth", () => {
  const source = readFileSync(join(__dirname, "LandingHeroV3.tsx"), "utf-8");

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
