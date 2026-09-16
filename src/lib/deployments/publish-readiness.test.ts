import { describe, it, expect } from "vitest";

/**
 * Publish-readiness checks — the same failure modes validateArtifact
 * hits after the deploy approval flow, surfaced early in the builder UI.
 * Pure logic: no I/O, safe to unit test exhaustively.
 */

import {
  checkPublishReadiness,
  detectFramework,
  isMediaPath,
  isPublishablePath,
  type WorkspaceInventory,
} from "./publish-readiness";
import { DEPLOYMENT_LIMITS } from "./user-deployment";

const healthy = (overrides: Partial<WorkspaceInventory> = {}): WorkspaceInventory => ({
  files: ["index.html", "style.css", "app.js"],
  hasIndexHtml: true,
  framework: null,
  buildOutputDirs: [],
  mediaFileCount: 0,
  truncated: false,
  ...overrides,
});

describe("checkPublishReadiness", () => {
  it("is quiet for a healthy static workspace", () => {
    expect(checkPublishReadiness(healthy())).toEqual([]);
  });

  it("warns when index.html is missing at the root", () => {
    const warnings = checkPublishReadiness(
      healthy({ hasIndexHtml: false, files: ["about.html"] }),
    );
    expect(warnings.some((w) => w.code === "missing-index")).toBe(true);
  });

  it("warns when the file count exceeds the publish cap", () => {
    const files = Array.from({ length: DEPLOYMENT_LIMITS.maxFiles + 1 }, (_, i) => `p${i}.html`);
    const warnings = checkPublishReadiness(healthy({ files }));
    const w = warnings.find((w) => w.code === "too-many-files");
    expect(w).toBeDefined();
    expect(w!.message).toContain(`${DEPLOYMENT_LIMITS.maxFiles}`);
  });

  it("warns for framework apps and names the framework", () => {
    const warnings = checkPublishReadiness(healthy({ framework: "Next.js" }));
    const w = warnings.find((w) => w.code === "framework-app");
    expect(w).toBeDefined();
    expect(w!.message).toContain("Next.js");
    expect(w!.message).toContain("static");
  });

  it("warns when only build output dirs are present (no framework detected)", () => {
    const warnings = checkPublishReadiness(
      healthy({ buildOutputDirs: [".next"], hasIndexHtml: false }),
    );
    expect(warnings.some((w) => w.code === "build-output-present")).toBe(true);
    // Framework warning takes precedence over the generic build-output one.
    const withFramework = checkPublishReadiness(
      healthy({ framework: "Next.js", buildOutputDirs: [".next"] }),
    );
    expect(withFramework.some((w) => w.code === "build-output-present")).toBe(false);
    expect(withFramework.some((w) => w.code === "framework-app")).toBe(true);
  });

  it("warns for media-heavy workspaces approaching the total-size cap", () => {
    const warnings = checkPublishReadiness(healthy({ mediaFileCount: 25 }));
    const w = warnings.find((w) => w.code === "media-heavy");
    expect(w).toBeDefined();
    expect(w!.message).toContain("10 MB");
  });

  it("stays quiet below the media threshold", () => {
    expect(
      checkPublishReadiness(healthy({ mediaFileCount: 19 })).some(
        (w) => w.code === "media-heavy",
      ),
    ).toBe(false);
  });
});

describe("detectFramework", () => {
  it("detects common frameworks from dependency names", () => {
    expect(detectFramework(["next", "react", "react-dom"])).toBe("Next.js");
    expect(detectFramework(["vite"])).toBe("Vite");
    expect(detectFramework(["nuxt"])).toBe("Nuxt");
    expect(detectFramework(["astro"])).toBe("Astro");
    expect(detectFramework(["react"])).toBe("React");
  });

  it("returns null when nothing matches", () => {
    expect(detectFramework(["lodash", "zod"])).toBe(null);
    expect(detectFramework([])).toBe(null);
    expect(detectFramework(null)).toBe(null);
  });
});

describe("isPublishablePath", () => {
  it("mirrors the deploy pipeline's exclusions", () => {
    expect(isPublishablePath("index.html")).toBe(true);
    expect(isPublishablePath("assets/hero.png")).toBe(true);
    expect(isPublishablePath("node_modules/x/index.js")).toBe(false);
    expect(isPublishablePath(".next/static/main.js")).toBe(false);
    expect(isPublishablePath("dist/bundle.js")).toBe(false);
    expect(isPublishablePath(".env")).toBe(false); // dotfiles never publish
    expect(isPublishablePath("data.bin")).toBe(false); // unknown binary type
  });
});

describe("isMediaPath", () => {
  it("flags image/video/audio extensions", () => {
    expect(isMediaPath("hero.JPG")).toBe(true);
    expect(isMediaPath("clip.mp4")).toBe(true);
    expect(isMediaPath("song.mp3")).toBe(true);
    expect(isMediaPath("app.js")).toBe(false);
    expect(isMediaPath("index.html")).toBe(false);
  });
});
