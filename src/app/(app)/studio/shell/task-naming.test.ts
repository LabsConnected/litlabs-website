import { describe, expect, it } from "vitest";
import { deriveTaskTitle, isPlaceholderTitle, surfaceToWorkspace } from "./task-naming";

describe("deriveTaskTitle", () => {
  it("derives a title from a plain first message", () => {
    expect(deriveTaskTitle("homepage hero refresh")).toBe("Homepage hero refresh");
  });

  it("collapses whitespace and newlines", () => {
    expect(deriveTaskTitle("  fix   the\nbooking  form ")).toBe("Fix the booking form");
  });

  it("truncates long messages at a word boundary", () => {
    const title = deriveTaskTitle(
      "please redesign the entire navigation bar to be sticky and add a mobile menu",
    );
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title).toBe("Please redesign the entire navigation bar to be");
  });

  it("strips trailing punctuation", () => {
    expect(deriveTaskTitle("make the logo bigger!")).toBe("Make the logo bigger");
  });

  it("never returns an Untitled title", () => {
    expect(deriveTaskTitle("")).toBe("New task");
    expect(deriveTaskTitle("   ")).toBe("New task");
    expect(deriveTaskTitle("...")).toBe("New task");
    expect(deriveTaskTitle("a".repeat(200))).not.toMatch(/^Untitled/);
  });
});

describe("isPlaceholderTitle", () => {
  it("flags placeholders eligible for auto-naming", () => {
    expect(isPlaceholderTitle(null)).toBe(true);
    expect(isPlaceholderTitle(undefined)).toBe(true);
    expect(isPlaceholderTitle("")).toBe(true);
    expect(isPlaceholderTitle("New task")).toBe(true);
    expect(isPlaceholderTitle("Untitled")).toBe(true);
    expect(isPlaceholderTitle("Untitled 3")).toBe(true);
  });

  it("keeps real names", () => {
    expect(isPlaceholderTitle("Homepage hero refresh")).toBe(false);
    expect(isPlaceholderTitle("Booking form fix")).toBe(false);
  });
});

describe("surfaceToWorkspace", () => {
  it("maps known surfaces", () => {
    expect(surfaceToWorkspace("preview")).toBe("design");
    expect(surfaceToWorkspace("browser")).toBe("browser");
    expect(surfaceToWorkspace("images")).toBe("images");
    expect(surfaceToWorkspace("media")).toBe("images");
    expect(surfaceToWorkspace("code")).toBe("code");
  });

  it("falls back to design for unknown or missing surfaces", () => {
    expect(surfaceToWorkspace("something-else")).toBe("design");
    expect(surfaceToWorkspace(null)).toBe("design");
    expect(surfaceToWorkspace(undefined)).toBe("design");
  });
});
