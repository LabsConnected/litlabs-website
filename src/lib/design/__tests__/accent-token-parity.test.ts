import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brand, color, PRIMARY_ACCENT_DECISION } from "@/lib/design/litt-tokens";

/**
 * Guards the J1 → CSS token pipeline for PR-G.
 *
 * The canonical accent lives in src/lib/design/litt-tokens.ts
 * (PRIMARY_ACCENT_DECISION = lime, decided by Larry 2026-09-16).
 * Its CSS mirror lives in src/app/globals.css (@theme accent tokens).
 * These two must never drift apart: update both together.
 */

const CSS = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

function themeBlock(): string {
  const start = CSS.indexOf("J1 canonical accent tokens");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, start + 2000);
}

describe("accent token parity (J1 → CSS)", () => {
  it("J1 decision is lime, decided", () => {
    expect(PRIMARY_ACCENT_DECISION.status).toBe("decided");
    expect(PRIMARY_ACCENT_DECISION.current).toBe("lime");
    expect(brand.primary.DEFAULT).toBe("#a8ff2f");
  });

  it("CSS @theme accent values exactly match the J1 lime candidate", () => {
    const block = themeBlock();
    const lime = brand.candidates.lime;
    expect(block).toContain(`--color-accent: ${lime.DEFAULT};`);
    expect(block).toContain(`--color-accent-strong: ${lime.strong};`);
    expect(block).toContain(`--color-accent-deep: ${lime.deep};`);
    expect(block).toContain(`--color-on-accent: ${color.text.onPrimary};`);
    expect(block).toContain(`--shadow-accent-glow: 0 0 24px ${lime.glow};`);
    expect(block).toContain(`--shadow-accent-glow-strong: 0 0 40px rgba(168, 255, 47, 0.5);`);
  });

  it("legacy --litt-primary aliases the canonical accent (J1 legacyReplacements)", () => {
    // J1 maps --litt-primary (#4dff62 command-studio) → brand.primary.
    // It must alias the token, not define a competing green.
    expect(CSS).toMatch(/--litt-primary:\s*var\(--color-accent\)/);
    expect(CSS).toMatch(/--litt-primary-strong:\s*var\(--color-accent-strong\)/);
  });

  it("on-accent text keeps WCAG AA contrast against the accent fill", () => {
    const lum = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => {
        const c = parseInt(hex.slice(i + 1, i + 3), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const l1 = lum(brand.primary.DEFAULT);
    const l2 = lum(color.text.onPrimary);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
