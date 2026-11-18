import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Hygiene regression tests (2026-11-11 console cleanup) ─────────────
// Same source-assertion style as csp-form-action.test.ts: these header /
// font values are static strings in next.config.ts and src/app/layout.tsx,
// asserted raw rather than importing build-time config modules.

describe("Permissions-Policy header", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  function extractPermissionsPolicy(): string {
    const match = configSource.match(/"geolocation=\(\)[^"]*"/);
    if (!match) throw new Error("Permissions-Policy value not found in next.config.ts");
    return match[0];
  }

  it("no longer carries the obsolete interest-cohort directive", () => {
    expect(extractPermissionsPolicy()).not.toContain("interest-cohort");
    expect(configSource).not.toContain("interest-cohort");
  });

  it("keeps every other directive intact (only interest-cohort was removed)", () => {
    const value = extractPermissionsPolicy();
    for (const directive of [
      "geolocation=()",
      "microphone=(self)",
      "camera=(self)",
      "display-capture=(self)",
      "payment=(self)",
      "usb=()",
      "gamepad=(self)",
    ]) {
      expect(value).toContain(directive);
    }
  });
});

describe("root layout font preloads", () => {
  const layoutSource = readFileSync(
    join(__dirname, "../app/layout.tsx"),
    "utf-8",
  );

  it("Pixelify Sans (retro-only font) is not preloaded globally", () => {
    const retro = layoutSource.match(/Pixelify_Sans\(\{[^}]*\}\)/);
    if (!retro) throw new Error("Pixelify_Sans call not found in layout.tsx");
    expect(retro[0]).toContain("preload: false");
  });

  it("the globally-used fonts keep their preloads (conservative scope)", () => {
    for (const family of ["Space_Grotesk", "Sora", "JetBrains_Mono"]) {
      const call = layoutSource.match(new RegExp(`${family}\\(\{[^}]*\}\\)`));
      if (!call) throw new Error(`${family} call not found in layout.tsx`);
      expect(call[0]).not.toContain("preload: false");
    }
  });
});
