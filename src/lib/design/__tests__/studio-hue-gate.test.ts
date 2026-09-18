/**
 * J2b — signed-in Studio hue gate. BLOCKING CI job (see j2b-studio-hue-gate
 * in .github/workflows/build.yml).
 *
 * The quality judge's blind spot: it covered user ACT/AUTO builds but never
 * litlabs.net's own signed-in Studio surfaces — which is how a cyan-blue
 * Generate button (ImageTool) and an orange-500 Generate button
 * (NeuralImagingStudio) shipped in violation of the lime-accent decision.
 * PR-G (#394) recolored both; this gate makes the regression impossible.
 *
 * Credential-free by design: static + structural assertions against the real
 * component sources (the ImageTool component is too heavy to render in
 * jsdom — see ImageTool.mobile-rebuild.test.tsx), plus token-pipeline pins.
 * No Clerk test user, no browser in CI. A live signed-in browser pass is a
 * manual verification step, not a CI gate.
 *
 * Scope: primary-accent hues on signed-in Studio surfaces. Deliberately
 * retained colors are NOT failures and are allowlisted inline with their
 * justification: red/amber/green validation semantics, log/syntax coloring,
 * agent phase/status dots, recording/live state indicators, cost semantics.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand } from "@/lib/design/litt-tokens";
import {
  ACCENT_MAP,
  accentOverrides,
  defaultTheme,
} from "@/context/ThemeContext";

const src = (rel: string): string =>
  readFileSync(join(__dirname, rel), "utf8");

// Legacy accent hues that must never render as primary accents on signed-in
// Studio surfaces. Lime/green is the accent family; red/amber are validation
// semantics; neutrals (slate/zinc/white) are surfaces.
const LEGACY_HUES = [
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  "orange",
  "teal",
] as const;

const LEGACY_CLASS_RE = new RegExp(
  `(?:bg|text|border|ring|from|via|to|shadow|decoration|outline|accent|fill|stroke|caret|divide|placeholder)-` +
    `(?:${LEGACY_HUES.join("|")})-\\d{2,3}(?:/\\d+)?`,
  "g",
);

/** Distinct legacy-hue class hits in a source string, minus documented exceptions. */
function legacyHits(source: string, allowlist: string[] = []): string[] {
  const hits = source.match(LEGACY_CLASS_RE) ?? [];
  return [...new Set(hits)].filter((h) => !allowlist.includes(h));
}

const IMAGE_TOOL = "../../../app/(app)/studio/tools/ImageTool.tsx";
const NEURAL_STUDIO = "../../../components/NeuralImagingStudio.tsx";
const COMPOSER = "../../../app/(app)/studio/components/CommandComposer.tsx";
const SETTINGS = "../../../app/(app)/settings/page.tsx";

describe("J2b studio hue gate (blocking)", () => {
  describe("J1 token pipeline → theme wiring", () => {
    it("default theme selects the J1 lime accent", () => {
      expect(defaultTheme.accent).toBe("lime");
    });

    it("lime accent override resolves to the J1 lime candidate", () => {
      expect(accentOverrides["lime"].accentColor).toBe(brand.primary.DEFAULT);
      expect(ACCENT_MAP["lime"].hex).toBe(brand.primary.DEFAULT);
    });
  });

  describe("ImageTool Generate buttons (the cyan-blue blind spot)", () => {
    it("both Generate buttons exist and use accent-token classes", () => {
      const source = src(IMAGE_TOOL);
      // Match <button> opening tags carrying the testid as a real JSX
      // attribute — not the querySelector string reference inside another
      // button's onClick handler (negative lookbehind for quote/paren/bracket).
      const buttons = [
        ...source.matchAll(
          /<button(?:(?!<button)[\s\S])*?(?<![+'"([]) data-testid="generate-image-button"[^>]*>/g,
        ),
      ];
      // Prompt-section button + always-visible docked button.
      expect(buttons.length).toBe(2);

      for (const b of buttons) {
        const cm = b[0].match(/className="([^"]*)"/);
        expect(cm, "Generate button must carry a static className").toBeTruthy();
        const c = cm![1];
        expect(c).toContain("bg-accent");
        expect(c).toContain("text-on-accent");
        expect(c).toContain("hover:bg-accent-strong");
        expect(legacyHits(c), "legacy accent hue on ImageTool Generate button").toEqual([]);
      }
    });

    it("no legacy accent classes anywhere in ImageTool", () => {
      expect(legacyHits(src(IMAGE_TOOL))).toEqual([]);
    });
  });

  describe("NeuralImagingStudio Generate button (the orange-500 blind spot)", () => {
    it("enabled branch uses accent tokens, disabled branch stays neutral", () => {
      const source = src(NEURAL_STUDIO);
      const anchor = source.indexOf("{/* Generate Button */}");
      expect(anchor).toBeGreaterThan(-1);
      const region = source.slice(anchor, anchor + 1200);
      const cm = region.match(/className=\{`([\s\S]*?)`\}/);
      expect(cm, "Generate button className template must exist").toBeTruthy();
      const branches = cm![1].match(/"([^"]*)"/g)?.map((s) => s.slice(1, -1)) ?? [];
      expect(branches.length).toBe(2);

      const [enabled, disabled] = branches;
      expect(enabled).toContain("bg-accent");
      expect(enabled).toContain("text-on-accent");
      expect(legacyHits(enabled), "legacy accent hue on enabled Generate button").toEqual([]);
      // Disabled state must be neutral slate — never a legacy accent hue.
      expect(legacyHits(disabled), "legacy accent hue on disabled Generate button").toEqual([]);
      expect(disabled).not.toContain("bg-accent");
    });

    it("no unintended legacy accent classes in NeuralImagingStudio", () => {
      // text-orange-400: provider cost semantic (FREE renders text-green-400,
      // paid cost renders text-orange-400) — deliberately retained, not a
      // primary accent.
      expect(legacyHits(src(NEURAL_STUDIO), ["text-orange-400"])).toEqual([]);
    });
  });

  describe("Studio chat composer (signed-in chat surface)", () => {
    it("send button fills from the J1-aliased accent variables", () => {
      const source = src(COMPOSER);
      const anchor = source.indexOf('data-testid="studio-send-button"');
      expect(anchor).toBeGreaterThan(-1);
      const region = source.slice(anchor, anchor + 1500);
      // --litt-primary aliases var(--color-accent) per the J1 parity test.
      expect(region).toContain("var(--litt-primary)");
      expect(region).toContain("var(--color-accent-strong)");
    });

    it("no unintended legacy accent classes in the composer", () => {
      // bg-purple-500/40 + bg-purple-400: the Live Voice *recording* indicator
      // ping dot on the share button — a deliberate status state (same family
      // as the retained recording/warn states), not a primary accent.
      const allowlist = ["bg-purple-500/40", "bg-purple-400"];
      expect(legacyHits(src(COMPOSER), allowlist)).toEqual([]);
    });
  });

  describe("settings accent picker (signed-in surface)", () => {
    it("offers LiTT Lime as the default accent option", () => {
      const source = src(SETTINGS);
      expect(source).toContain('{ id: "lime", label: "LiTT Lime (default)" }');
      // The picker highlights theme.accent === opt.id, and the default theme
      // selects lime — so the picker opens with lime selected.
      expect(source).toContain("theme.accent === opt.id");
      expect(defaultTheme.accent).toBe("lime");
    });
  });
});
