import { describe, it, expect } from "vitest";
import { detectIntent, buildNavigationMessage } from "@/lib/intent-router";

describe("detectIntent", () => {
  it("returns an empty result for blank input", () => {
    const result = detectIntent("   ");
    expect(result).toEqual({
      route: null,
      confidence: 0,
      isAmbiguous: false,
      suggestions: [],
    });
  });

  it("returns an empty result when nothing matches", () => {
    const result = detectIntent("zzzz qqqq no keywords here");
    expect(result.route).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.isAmbiguous).toBe(false);
    expect(result.suggestions).toEqual([]);
  });

  it("routes an unambiguous image request to the Image Studio", () => {
    const result = detectIntent("please generate a wallpaper illustration for me");
    expect(result.route).not.toBeNull();
    expect(result.route?.path).toBe("/studio?tool=image");
    expect(result.route?.label).toBe("Studio — Image");
    expect(result.isAmbiguous).toBe(false);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it("is case-insensitive", () => {
    const lower = detectIntent("open the gallery");
    const upper = detectIntent("OPEN THE GALLERY");
    expect(upper.route?.path).toBe(lower.route?.path);
    expect(upper.route?.path).toBe("/gallery");
  });

  it("assigns confidence of 1 when only a single rule matches", () => {
    const result = detectIntent("show my marketplace store credits");
    expect(result.confidence).toBe(1);
    expect(result.route?.path).toBe("/marketplace");
  });

  it("caps confidence at 1", () => {
    const result = detectIntent("game play arcade gaming");
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("returns up to three suggestions ranked by score", () => {
    const result = detectIntent(
      "I want to build a website, generate an image, and play a game",
    );
    expect(result.suggestions.length).toBeGreaterThan(1);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
    result.suggestions.forEach((s) => {
      expect(typeof s.path).toBe("string");
      expect(typeof s.label).toBe("string");
      expect(typeof s.reason).toBe("string");
    });
  });

  it("marks a tie between two rules as ambiguous with no chosen route", () => {
    const result = detectIntent("image video");
    expect(result.isAmbiguous).toBe(true);
    expect(result.route).toBeNull();
    expect(result.confidence).toBeLessThan(0.6);
  });
});

describe("buildNavigationMessage", () => {
  it("returns an empty string when there is no route and it is not ambiguous", () => {
    const intent = detectIntent("");
    expect(buildNavigationMessage(intent)).toBe("");
  });

  it("builds a confirmation message when a route is chosen", () => {
    const intent = detectIntent("open my wallet balance");
    const msg = buildNavigationMessage(intent);
    expect(msg).toContain(intent.route!.reason);
    expect(msg).toContain(intent.route!.label);
    expect(msg).toContain("Opening");
  });

  it("builds a disambiguation prompt when ambiguous", () => {
    const intent = detectIntent("image video");
    const msg = buildNavigationMessage(intent);
    expect(msg).toContain("Which one fits best?");
    expect(msg).toContain("1.");
  });

  it("returns an empty string when ambiguous but has no suggestions", () => {
    const msg = buildNavigationMessage({
      route: null,
      confidence: 0.3,
      isAmbiguous: true,
      suggestions: [],
    });
    expect(msg).toBe("");
  });
});
