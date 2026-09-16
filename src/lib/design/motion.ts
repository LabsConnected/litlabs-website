/**
 * Shared motion language for litlabs.net.
 *
 * Before PR-A every animation was hand-rolled per component: 384 `transition-all`
 * usages, ~50 ad-hoc CSS keyframes, durations and easings that varied by author.
 * This module is the one place to look when adding motion:
 *
 * - `durations` — the canonical 120 / 200 / 300 ms scale (documented but never
 *   exported by `litt-tokens.ts`).
 * - `easings` — the ease-out cubic family (fast attack, gentle settle).
 * - `fadeUp` / `scaleIn` — framer-motion variants for entrances.
 * - `viewportReveal` — whileInView preset for scroll reveals.
 * - `useMotionTransition` / `resolveMotionTransition` — transitions that
 *   collapse to instant when the user prefers reduced motion.
 *
 * Accessibility contract: reduced-motion users never get a surprise animation.
 * The global CSS nuclear block (`@media (prefers-reduced-motion: reduce)`) kills
 * CSS transitions/animations; the helpers below do the same for framer-motion.
 */

import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/** Canonical durations, in milliseconds. */
export const durations = {
  /** Micro feedback: hovers, toggles, pressed states. */
  instant: 120,
  /** Standard UI motion: mounts, panels, toasts. */
  standard: 200,
  /** Reveals: entrances, scroll reveals, page-level transitions. */
  reveal: 300,
} as const;

/** Ease-out cubic family — decelerating curves: snappy at the start, gentle at rest. */
export const easings = {
  /** The standard curve: cubic-bezier(0.33, 1, 0.68, 1). */
  easeOutCubic: [0.33, 1, 0.68, 1] as [number, number, number, number],
  /** Slightly punchier than easeOutCubic. */
  easeOutQuart: [0.25, 1, 0.5, 1] as [number, number, number, number],
  /** The "premium" curve already used by the marketing landing CSS (`--ease-premium`). */
  easeOutQuint: [0.22, 1, 0.36, 1] as [number, number, number, number],
  /** No easing — for opacity-only crossfades. */
  linear: [0, 0, 1, 1] as [number, number, number, number],
} as const;

/** The default entrance: rise 12px and fade in over `durations.reveal`. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: durations.reveal / 1000, ease: easings.easeOutCubic },
  },
};

/** Pop-in for overlays, menus, command palettes. */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: durations.standard / 1000, ease: easings.easeOutCubic },
  },
};

/**
 * Scroll-reveal preset for framer-motion: spread onto a `motion.*` element.
 *
 * @example
 *   <motion.div {...viewportReveal} variants={fadeUp}>…</motion.div>
 */
export const viewportReveal = {
  initial: "hidden",
  whileInView: "visible",
  viewport: { once: true, margin: "-64px" },
} as const;

/**
 * Pure helper: given a framer-motion transition, return an instant
 * (duration: 0) transition when reduced motion is requested.
 * Kept pure so it is unit-testable without rendering.
 */
export function resolveMotionTransition(transition: Transition, reduce: boolean): Transition {
  if (!reduce) return transition;
  return { ...transition, duration: 0, delay: 0 };
}

/**
 * Hook form: returns `transition` as-is, or an instant transition when the
 * user prefers reduced motion.
 *
 * @example
 *   const transition = useMotionTransition({ duration: 0.3, ease: easings.easeOutCubic });
 *   <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={transition} />
 */
export function useMotionTransition(transition: Transition): Transition {
  const reduce = useReducedMotion() ?? false;
  return resolveMotionTransition(transition, reduce);
}
