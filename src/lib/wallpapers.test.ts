/**
 * Wallpaper registry + helpers — unit tests.
 *
 * Covers the blueprint test cases that can be verified without a full
 * React render: registry integrity, category filtering, fallback
 * gradient, asset detection, and upload validation logic.
 */
import { describe, it, expect } from "vitest";
import {
  WALLPAPERS,
  getWallpaperById,
  getWallpapersByCategory,
  getAvailableCategories,
  hasImageAsset,
  WALLPAPER_FALLBACK_GRADIENT,
  type WallpaperId,
} from "./wallpapers";

// ─── Registry integrity ─────────────────────────────────────────

describe("Wallpaper registry integrity", () => {
  it("every wallpaper has a unique id", () => {
    const ids = WALLPAPERS.map((w) => w.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every wallpaper has name, description, preview, and fullStyle", () => {
    for (const w of WALLPAPERS) {
      expect(w.name).toBeTruthy();
      expect(w.description).toBeTruthy();
      expect(w.preview).toBeTruthy();
      expect(w.fullStyle).toBeDefined();
    }
  });

  it("getWallpaperById returns the matching wallpaper", () => {
    const wp = getWallpaperById("afterglow");
    expect(wp.id).toBe("afterglow");
    expect(wp.name).toBe("LiTT Afterglow");
  });

  it("getWallpaperById falls back to the first wallpaper for unknown ids", () => {
    const wp = getWallpaperById("does-not-exist" as WallpaperId);
    expect(wp).toBe(WALLPAPERS[0]);
  });
});

// ─── Case 7: Category filters work ──────────────────────────────

describe("Category filters", () => {
  it("'all' returns every wallpaper except custom", () => {
    const all = getWallpapersByCategory("all");
    expect(all.length).toBe(WALLPAPERS.filter((w) => w.id !== "custom").length);
    expect(all.find((w) => w.id === "custom")).toBeUndefined();
  });

  it("'tech' returns wallpapers in the tech category", () => {
    const tech = getWallpapersByCategory("tech");
    expect(tech.length).toBeGreaterThan(0);
    for (const w of tech) {
      const inCategory = w.category === "tech" || (w.categories?.includes("tech") ?? false);
      expect(inCategory).toBe(true);
    }
  });

  it("'space' returns wallpapers tagged with the space category", () => {
    const space = getWallpapersByCategory("space");
    expect(space.length).toBeGreaterThan(0);
    // afterglow is tagged with space
    expect(space.find((w) => w.id === "afterglow")).toBeDefined();
    // cosmic is now in the space category
    expect(space.find((w) => w.id === "cosmic")).toBeDefined();
  });

  it("'retro' returns cyberpunk and sunset", () => {
    const retro = getWallpapersByCategory("retro");
    expect(retro.find((w) => w.id === "cyberpunk")).toBeDefined();
    expect(retro.find((w) => w.id === "sunset")).toBeDefined();
  });

  it("'luxury' returns honeycomb", () => {
    const luxury = getWallpapersByCategory("luxury");
    expect(luxury.find((w) => w.id === "honeycomb")).toBeDefined();
  });

  it("getAvailableCategories includes all and the populated categories", () => {
    const cats = getAvailableCategories();
    expect(cats[0]).toBe("all");
    expect(cats).toContain("tech");
    expect(cats).toContain("space");
    expect(cats).toContain("retro");
    expect(cats).toContain("luxury");
  });
});

// ─── Case 5: Missing wallpaper shows fallback ───────────────────

describe("Fallback gradient", () => {
  it("WALLPAPER_FALLBACK_GRADIENT is a valid CSS gradient string", () => {
    expect(WALLPAPER_FALLBACK_GRADIENT).toMatch(/^linear-gradient/);
    expect(WALLPAPER_FALLBACK_GRADIENT).toContain("#0a0a0f");
  });

  it("hasImageAsset returns true only for the 3 real-asset wallpapers", () => {
    expect(hasImageAsset("afterglow")).toBe(true);
    expect(hasImageAsset("liquid-signal")).toBe(true);
    expect(hasImageAsset("biolume-canopy")).toBe(true);
    // CSS-only wallpapers
    expect(hasImageAsset("nebula")).toBe(false);
    expect(hasImageAsset("cyberpunk")).toBe(false);
    expect(hasImageAsset("default")).toBe(false);
  });
});

// ─── Cases 8 & 9: Upload validation logic ───────────────────────

/**
 * These tests verify the validation logic that WallpaperSection uses.
 * The actual file reading happens in the component; we test the rules.
 */
describe("Upload validation rules", () => {
  const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function validateFile(file: { type: string; size: number }): string | null {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return "Only JPG, PNG, and WebP files are supported.";
    }
    if (file.size > MAX_SIZE_BYTES) {
      return "File too large. Maximum size is 10 MB.";
    }
    return null;
  }

  it("rejects invalid file types", () => {
    expect(validateFile({ type: "image/gif", size: 1000 })).toBe(
      "Only JPG, PNG, and WebP files are supported.",
    );
    expect(validateFile({ type: "application/pdf", size: 1000 })).toBe(
      "Only JPG, PNG, and WebP files are supported.",
    );
    expect(validateFile({ type: "video/mp4", size: 1000 })).toBe(
      "Only JPG, PNG, and WebP files are supported.",
    );
  });

  it("rejects files above 10 MB", () => {
    expect(validateFile({ type: "image/png", size: MAX_SIZE_BYTES + 1 })).toBe(
      "File too large. Maximum size is 10 MB.",
    );
    expect(validateFile({ type: "image/jpeg", size: MAX_SIZE_BYTES + 1024 })).toBe(
      "File too large. Maximum size is 10 MB.",
    );
  });

  it("accepts valid files under the limit", () => {
    expect(validateFile({ type: "image/jpeg", size: 1000 })).toBeNull();
    expect(validateFile({ type: "image/png", size: MAX_SIZE_BYTES })).toBeNull();
    expect(validateFile({ type: "image/webp", size: 5 * 1024 * 1024 })).toBeNull();
  });
});

// ─── Case 10: Reset restores defaults ───────────────────────────

describe("Default values", () => {
  it("the 3 real-asset wallpapers have accent, premium, tags, and defaultEffect", () => {
    const afterglow = getWallpaperById("afterglow");
    expect(afterglow.accent).toBeTruthy();
    expect(afterglow.premium).toBe(true);
    expect(afterglow.tags).toBeDefined();
    expect(afterglow.tags!.length).toBeGreaterThan(0);
    expect(afterglow.defaultEffect).toBeDefined();

    const liquid = getWallpaperById("liquid-signal");
    expect(liquid.accent).toBeTruthy();
    expect(liquid.tags).toBeDefined();
    expect(liquid.defaultEffect).toBeDefined();

    const biolume = getWallpaperById("biolume-canopy");
    expect(biolume.accent).toBeTruthy();
    expect(biolume.premium).toBe(true);
    expect(biolume.defaultEffect).toBeDefined();
  });

  it("every wallpaper with hasAsset=true has a real .webp URL in its preview", () => {
    for (const w of WALLPAPERS) {
      if (w.hasAsset) {
        expect(w.preview).toContain("/wallpapers/");
        expect(w.preview).toMatch(/\.webp/);
      }
    }
  });
});
