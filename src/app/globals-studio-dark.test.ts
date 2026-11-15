import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * STUDIO DARK RE-SCOPE (owner decision, 2026-11-14) — source contract.
 *
 * The `.studio-shell` scope in globals.css carries the approved LIGHT
 * Studio design. When the effective theme mode is dark, a re-scope
 * block must re-point the Studio tokens at the theme's published root
 * variables (--bg-color / --box-bg / --border-color / --text-color /
 * --accent-color) so the Studio shell follows the applied skin —
 * for Signature, Larry's charcoal — instead of staying white/pale
 * mint (the 2026-11-14 patchwork). The light block must stay
 * byte-identical: it is the default presentation.
 */

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

const darkStart = css.indexOf('html[data-theme-mode="dark"] .studio-shell {');
const systemStart = css.indexOf('html[data-theme-mode="system"] .studio-shell {');
const darkBlock = css.slice(darkStart, systemStart);
const systemBlock = css.slice(systemStart, css.indexOf("\n}\n", systemStart));

describe("globals.css — Studio dark re-scope", () => {
  it("has a dark re-scope for explicit Dark and for System under a dark OS", () => {
    expect(darkStart).toBeGreaterThan(-1);
    expect(systemStart).toBeGreaterThan(darkStart);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("re-points the Studio surface tokens at the theme's root variables", () => {
    for (const block of [darkBlock, systemBlock]) {
      expect(block).toContain("--studio-bg: var(--bg-color)");
      expect(block).toContain("--studio-surface: var(--box-bg)");
      expect(block).toContain("--studio-elevated: var(--box-bg)");
      expect(block).toContain("--studio-card: var(--box-bg)");
      expect(block).toContain("--studio-border: var(--border-color)");
      expect(block).toContain("--text-primary: var(--text-color)");
      expect(block).toContain("--color-accent: var(--accent-color)");
    }
  });

  it("leaves the light .studio-shell block untouched", () => {
    const lightStart = css.indexOf(".studio-shell {");
    const lightBlock = css.slice(lightStart, css.indexOf("}", lightStart));
    expect(lightBlock).toContain("--studio-bg: #e3edd8");
    expect(lightBlock).toContain("--studio-surface: #ffffff");
    expect(lightBlock).toContain("--studio-border: #86ac72");
    expect(lightBlock).toContain("--text-primary: #0e1510");
    // The light block itself never references the theme root variables.
    expect(lightBlock).not.toContain("var(--box-bg)");
  });
});
