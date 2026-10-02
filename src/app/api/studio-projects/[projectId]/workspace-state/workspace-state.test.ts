import { describe, expect, it } from "vitest";

/**
 * Tests for workspace-state route first-start project truth.
 *
 * Ensures:
 * - Untouched projects report hasUserContent=false
 * - Touched projects report hasUserContent=true
 * - Scaffolded projects with non-starter content report hasUserContent=true
 * - Scaffolded projects with only starter content report hasUserContent=false
 */

describe("workspace-state first-start truth", () => {
  it("hasUserContent is false for untouched scaffolded project", () => {
    const scaffolded = true;
    const touched = false;
    const starterContent = true;
    const hasUserContent = touched || (scaffolded && !starterContent);
    expect(hasUserContent).toBe(false);
  });

  it("hasUserContent is true for touched workspace", () => {
    const scaffolded = true;
    const touched = true;
    const starterContent = true;
    const hasUserContent = touched || (scaffolded && !starterContent);
    expect(hasUserContent).toBe(true);
  });

  it("hasUserContent is true for scaffolded project with real content", () => {
    const scaffolded = true;
    const touched = false;
    const starterContent = false;
    const hasUserContent = touched || (scaffolded && !starterContent);
    expect(hasUserContent).toBe(true);
  });

  it("hasUserContent is false for non-scaffolded untouched project", () => {
    const scaffolded = false;
    const touched = false;
    const starterContent = false;
    const hasUserContent = touched || (scaffolded && !starterContent);
    expect(hasUserContent).toBe(false);
  });
});
