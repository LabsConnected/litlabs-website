import { describe, it, expect } from "vitest";

/**
 * Media provider catalog — unwired providers must never be offered as
 * selectable options. Picking one throws "<id> is not yet wired" at
 * request time, which is a dead end.
 */

import { MEDIA_PROVIDERS, WIRED_PROVIDERS, getProvider } from "./media";

describe("media provider wiring", () => {
  it("excludes unwired providers from the selectable list", () => {
    const wiredIds = new Set(WIRED_PROVIDERS.map((p) => p.id));
    expect(wiredIds.has("luma")).toBe(false);
    expect(wiredIds.has("veo")).toBe(false);
    expect(wiredIds.has("runway")).toBe(false);
    // Everything else stays selectable.
    expect(wiredIds.has("pollinations")).toBe(true);
    expect(wiredIds.has("gemini")).toBe(true);
    expect(wiredIds.has("fal")).toBe(true);
    expect(wiredIds.has("huggingface")).toBe(true);
  });

  it("unwired providers keep their cost/label metadata for when they get wired", () => {
    const luma = getProvider("luma")!;
    expect(luma.cost("video")).toBe(80);
    expect(luma.wired).toBe(false);
  });

  it("does not label any rendered provider as 'Coming Soon'", () => {
    for (const p of WIRED_PROVIDERS) {
      expect(p.label.toLowerCase()).not.toContain("coming soon");
    }
  });

  it("video still has at least one wired provider", () => {
    const videoProviders = WIRED_PROVIDERS.filter((p) =>
      p.supportedFormats.includes("video"),
    );
    expect(videoProviders.length).toBeGreaterThan(0);
    // All unwired ids are absent from the full catalog's selectable set too.
    for (const p of MEDIA_PROVIDERS) {
      if (p.wired === false) {
        expect(WIRED_PROVIDERS).not.toContain(p);
      }
    }
  });
});
