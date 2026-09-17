import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_NAME, normalizeProjectName, validateProjectName } from "./project-name";

describe("project naming", () => {
  it("offers an editable sensible default", () => {
    expect(DEFAULT_PROJECT_NAME).toBe("My new project");
    expect(validateProjectName(DEFAULT_PROJECT_NAME)).toBeNull();
  });

  it("rejects blank names and trims accepted names", () => {
    expect(validateProjectName("   ")).toBe("Enter a project name.");
    expect(normalizeProjectName("  Golden Acceptance — Ember Roast  ")).toBe("Golden Acceptance — Ember Roast");
  });

  it("rejects names that exceed the persisted limit", () => {
    expect(validateProjectName("x".repeat(121))).toContain("120 characters");
  });
});
