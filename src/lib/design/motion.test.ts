/**
 * Unit tests for src/lib/design/motion.ts — the shared motion language (PR-A).
 */
import { describe, it, expect } from "vitest";
import {
  durations,
  easings,
  fadeUp,
  scaleIn,
  viewportReveal,
  resolveMotionTransition,
} from "./motion";

describe("durations", () => {
  it("exposes the canonical 120 / 200 / 300 ms scale", () => {
    expect(durations.instant).toBe(120);
    expect(durations.standard).toBe(200);
    expect(durations.reveal).toBe(300);
  });
});

describe("easings", () => {
  it("is the standard ease-out cubic family", () => {
    // easeOutCubic: cubic-bezier(0.33, 1, 0.68, 1) — fast attack, gentle settle
    expect(easings.easeOutCubic).toEqual([0.33, 1, 0.68, 1]);
    expect(easings.easeOutQuart).toEqual([0.25, 1, 0.5, 1]);
    // Must match the marketing landing CSS `--ease-premium`
    expect(easings.easeOutQuint).toEqual([0.22, 1, 0.36, 1]);
    expect(easings.linear).toEqual([0, 0, 1, 1]);
  });
});

describe("fadeUp variant", () => {
  it("starts transparent + offset and ends opaque + settled", () => {
    const hidden = fadeUp.hidden as Record<string, unknown>;
    const visible = fadeUp.visible as Record<string, unknown>;
    expect(hidden.opacity).toBe(0);
    expect(hidden.y).toBe(12);
    expect(visible.opacity).toBe(1);
    expect(visible.y).toBe(0);
  });

  it("animates over the reveal duration with the standard easing", () => {
    const transition = (fadeUp.visible as Record<string, unknown>).transition as Record<string, unknown>;
    expect(transition.duration).toBeCloseTo(durations.reveal / 1000);
    expect(transition.ease).toEqual(easings.easeOutCubic);
  });
});

describe("scaleIn variant", () => {
  it("starts transparent + shrunken and ends opaque + full size", () => {
    const hidden = scaleIn.hidden as Record<string, unknown>;
    const visible = scaleIn.visible as Record<string, unknown>;
    expect(hidden.opacity).toBe(0);
    expect(hidden.scale).toBe(0.98);
    expect(visible.opacity).toBe(1);
    expect(visible.scale).toBe(1);
  });

  it("animates over the standard duration with the standard easing", () => {
    const transition = (scaleIn.visible as Record<string, unknown>).transition as Record<string, unknown>;
    expect(transition.duration).toBeCloseTo(durations.standard / 1000);
    expect(transition.ease).toEqual(easings.easeOutCubic);
  });
});

describe("viewportReveal preset", () => {
  it("is a once-only scroll reveal bound to the variant state keys", () => {
    expect(viewportReveal.initial).toBe("hidden");
    expect(viewportReveal.whileInView).toBe("visible");
    expect(viewportReveal.viewport.once).toBe(true);
  });
});

describe("resolveMotionTransition", () => {
  const base = { duration: 0.3, delay: 0.1, ease: easings.easeOutCubic };

  it("passes the transition through when reduced motion is not requested", () => {
    expect(resolveMotionTransition(base, false)).toBe(base);
  });

  it("collapses to an instant transition when reduced motion is requested", () => {
    const resolved = resolveMotionTransition(base, true);
    expect(resolved.duration).toBe(0);
    expect(resolved.delay).toBe(0);
    // The input transition is not mutated
    expect(base.duration).toBe(0.3);
  });
});
