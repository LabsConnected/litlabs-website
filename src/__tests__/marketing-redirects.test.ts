import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("/capabilities public route", () => {
  const configSource = readFileSync(join(__dirname, "../../next.config.ts"), "utf-8");
  const pageSource = readFileSync(join(__dirname, "../app/(marketing)/capabilities/page.tsx"), "utf-8");

  it("does not redirect the route away from its canonical page", () => {
    expect(configSource).not.toMatch(/source:\s*["']\/capabilities["']/);
  });

  it("has a real page with canonical metadata", () => {
    expect(pageSource).toContain('path: "/capabilities"');
    expect(pageSource).toContain("CapabilityGrid");
  });
});
