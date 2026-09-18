/**
 * LiTTree LabStudios — canonical design tokens.
 *
 * Batch 0 of the visual upgrade. This file is the SINGLE source of truth for
 * the new design system. It consolidates the six competing legacy systems
 * (cinematic / command-studio / glass-os / ThemeContext / studio-tokens /
 * dashboard tokens) into one exported map. See `legacyReplacements` below for
 * which legacy variable each token supersedes.
 *
 * Not consumed by product code yet — consumption starts in later batches
 * (Batch 8 begins the globals.css consolidation). Do not import this from
 * existing components in this batch.
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │ ✅ DECIDED — PRIMARY ACCENT (2026-09-16)                           │
 * │                                                                    │
 * │ On 2026-09-16 ~14:52 EDT Larry explicitly approved "lime as the   │
 * │ brand accent", superseding earlier uncertainty. `brand.primary`   │
 * │ therefore resolves to the lime candidate (#a8ff2f). If the        │
 * │ decision ever changes, change ONLY the alias target in           │
 * │ `brand.primary` — everything downstream follows.                  │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Rules baked into this map:
 * - Premium near-black cinematic foundation.
 * - Electric cyan + blue primary energy. NO PINK anywhere in this file.
 * - Purple is restrained: `accent.violet` only, for "where useful" moments
 *   (creative/spark surfaces). Never as a primary.
 * - Minimum touch target 44px (`touch.min`).
 * - Motion scale 120/200/300ms; every animated primitive must also honor
 *   `prefers-reduced-motion` (see `motion.reducedMotion`).
 */

export const PRIMARY_ACCENT_DECISION = {
  status: "decided" as const,
  decidedBy: "Larry",
  decidedAt: "2026-09-16",
  briefDirection: "electric cyan/blue",
  shippedDirection: "lime (#a8ff2f)",
  /**
   * Decision record: on 2026-09-16 ~14:52 EDT Larry explicitly approved
   * "lime as the brand accent", superseding earlier uncertainty — so
   * `brand.primary` now resolves to the lime candidate.
   */
  current: "lime" as "cyan-blue" | "lime",
  blocksBatch: 6,
} as const;

const cyanBlue = {
  /** Primary action fill. Dark text on top for contrast. */
  DEFAULT: "#22d3ee",
  /** Hover / strong emphasis. */
  strong: "#06b6d4",
  /** Deep blue for gradients and secondary energy. */
  deep: "#0ea5e9",
  /** Soft tint for selected / active backgrounds. */
  soft: "rgba(34, 211, 238, 0.12)",
  /** Focus rings. */
  ring: "rgba(34, 211, 238, 0.55)",
  /** Glow shadows. */
  glow: "rgba(34, 211, 238, 0.35)",
} as const;

const limeAlternate = {
  DEFAULT: "#a8ff2f",
  strong: "#8fe31f",
  deep: "#65b30e",
  soft: "rgba(168, 255, 47, 0.12)",
  ring: "rgba(168, 255, 47, 0.55)",
  glow: "rgba(168, 255, 47, 0.35)",
} as const;

export const brand = {
  /** Swappable alias — see PRIMARY_ACCENT_DECISION above. */
  primary: PRIMARY_ACCENT_DECISION.current === "lime" ? limeAlternate : cyanBlue,
  /** Both candidates, addressable for migration tooling. */
  candidates: { "cyan-blue": cyanBlue, lime: limeAlternate },
  /**
   * Restrained violet. Use sparingly: creative/spark moments, never as the
   * primary action color, never adjacent to another violet accent.
   */
  violet: {
    DEFAULT: "#a78bfa",
    strong: "#8b5cf6",
    soft: "rgba(167, 139, 250, 0.12)",
  },
} as const;

export const color = {
  /** Near-black cinematic foundation. Page backgrounds live here. */
  bg: {
    base: "#07080c",
    raised: "#0b0d13",
    sunken: "#04050a",
  },
  /** Card / panel surfaces. */
  surface: {
    DEFAULT: "#10131b",
    raised: "#151926",
    overlay: "#1a1f2e",
  },
  /** Borders: one scale, subtle by default. */
  border: {
    subtle: "rgba(255, 255, 255, 0.08)",
    DEFAULT: "rgba(255, 255, 255, 0.12)",
    strong: "rgba(255, 255, 255, 0.2)",
  },
  /** Text: three steps, no more. */
  text: {
    primary: "#f4f6fb",
    secondary: "#a7aec2",
    muted: "#6b7288",
    /** Text placed on top of the primary accent fill. */
    onPrimary: "#04262e",
  },
  /** Semantic colors. Red = destructive/errors only. Amber = warnings. */
  semantic: {
    success: "#34d399",
    warning: "#fbbf24",
    danger: "#f87171",
    info: "#38bdf8",
  },
  /** Overlays, scrims, skeletons. */
  overlay: {
    scrim: "rgba(4, 5, 10, 0.72)",
    skeleton: "rgba(255, 255, 255, 0.06)",
  },
} as const;

export const font = {
  family: {
    /** Display / headings. Loaded via next/font in src/app/layout.tsx. */
    display: "var(--font-next-display), var(--font-ui)",
    /** Body text. */
    sans: "var(--font-next-ui), var(--font-ui)",
    /** Code, terminals, IDs. */
    mono: "var(--font-next-code), ui-monospace, monospace",
    /** Retro Vault / emulator surfaces ONLY (lint-enforced later). */
    retro: "var(--font-next-retro), var(--font-ui)",
  },
  /** Type ramp — use these steps instead of arbitrary text-[NNpx]. */
  size: {
    xs: "0.75rem", // 12
    sm: "0.875rem", // 14
    base: "1rem", // 16
    lg: "1.125rem", // 18
    xl: "1.25rem", // 20
    "2xl": "1.5rem", // 24
    "3xl": "1.875rem", // 30
    "4xl": "2.25rem", // 36
    "5xl": "3rem", // 48
    "6xl": "3.75rem", // 60
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.15,
    normal: 1.5,
    relaxed: 1.65,
  },
} as const;

/** 4px-base spacing scale. */
export const space = {
  px: "1px",
  0: "0",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
} as const;

/**
 * ONE radius scale. Replaces the contradictory legacy pair
 * (--radius-sm 8px vs 12px, --radius-md 14px vs 16px).
 */
export const radius = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
  full: "9999px",
} as const;

/** Cinematic shadows. Glow variants are accent-tinted, used sparingly. */
export const shadow = {
  sm: "0 1px 2px rgba(0, 0, 0, 0.4)",
  md: "0 4px 16px rgba(0, 0, 0, 0.45)",
  lg: "0 12px 40px rgba(0, 0, 0, 0.55)",
  /** Primary-accent glow for the ONE dominant action on a surface. */
  glowPrimary: "0 0 24px rgba(34, 211, 238, 0.35)",
  glowPrimaryStrong: "0 0 40px rgba(34, 211, 238, 0.5)",
} as const;

export const motion = {
  /** Single duration scale. */
  duration: {
    fast: "120ms",
    normal: "200ms",
    slow: "300ms",
  },
  easing: {
    out: "cubic-bezier(0.16, 1, 0.3, 1)",
    inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  },
  /**
   * Every primitive must respect reduced motion. In Tailwind classes use the
   * `motion-reduce:` variant (e.g. `motion-reduce:transition-none`,
   * `motion-reduce:animate-none`). In JS-driven animation, gate on
   * `window.matchMedia("(prefers-reduced-motion: reduce)")`.
   */
  reducedMotion: {
    mediaQuery: "(prefers-reduced-motion: reduce)",
    tailwindVariant: "motion-reduce:",
  },
} as const;

/** Z-index scale — ends the 10009–10023 arms race. */
export const z = {
  base: 0,
  sticky: 10,
  dropdown: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
} as const;

/** Touch + layout constants. */
export const layout = {
  touch: {
    /** Minimum interactive target — WCAG 2.5.8 / Apple HIG. */
    min: "44px",
  },
  container: {
    sm: "640px",
    md: "768px",
    lg: "1024px",
    xl: "1280px",
  },
} as const;

/**
 * Legacy → canonical replacement map. Later batches use this when migrating
 * each legacy system into these tokens (Batch 8 does globals.css).
 */
export const legacyReplacements: Record<string, string> = {
  // radii — the same names were defined twice with different values
  "--radius-sm (8px cinematic / 12px glass)": "radius.sm (8px)",
  "--radius-md (14px cinematic / 16px glass)": "radius.md (12px)",
  "--radius-xl (28px glass)": "radius.xl (24px)",
  // warnings — same name, two values
  "--warning (#e3b341 cinematic / #ffcc33 command-studio)": "color.semantic.warning (#fbbf24)",
  // competing "primaries"
  "--accent-color (#a970ff cinematic)": "brand.violet.strong",
  "--litt-primary (#4dff62 command-studio)": "brand.primary (pending decision)",
  "--spark-primary (#9b4dff command-studio)": "brand.violet.strong",
  "--purple (#8b5cf6 glass)": "brand.violet.strong",
  "--green (#9eff47 glass)": "brand.primary (pending decision)",
  "#a8ff2f (hardcoded ×191, no token)": "brand.candidates.lime",
  // text naming — four schemes
  "--text-color/--text-muted (cinematic)": "color.text.primary / color.text.muted",
  "--text-primary/--text-secondary/--text-muted (command-studio)":
    "color.text.primary / color.text.secondary / color.text.muted",
  "--text-main/--text-soft/--text-dim (glass)": "color.text.primary / color.text.secondary / color.text.muted",
  "--dash-text-* (dashboard)": "color.text.*",
  // motion
  "--transition (180ms) / --glass-transition": "motion.duration.normal + motion.easing.out",
  "--studio-anim-fast/normal/slow": "motion.duration.fast/normal/slow",
  // glass tiers
  "--glass-1/2/3 + studioTokens.surface.*": "color.surface.* + color.border.* (prefer solid, blur ≤2 layers)",
};

export const littTokens = {
  PRIMARY_ACCENT_DECISION,
  brand,
  color,
  font,
  space,
  radius,
  shadow,
  motion,
  z,
  layout,
  legacyReplacements,
} as const;

export type LittTokens = typeof littTokens;
