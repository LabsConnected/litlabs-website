/**
 * Studio Design Tokens — the ONE namespaced token set for Studio chrome.
 *
 * Consolidates the multiple overlapping token families that existed before:
 * - --text-color, --text-muted (generic)
 * - --text-primary, --text-secondary, --text-muted (Studio)
 * - --text-main, --text-soft, --text-dim (glass/legacy)
 * - --studio-bg, --studio-surface, --studio-elevated, --studio-card, --studio-border
 * - --studio-glow-* (being deprecated for ordinary controls)
 *
 * New surfaces MUST use these tokens. Old variables are migrated
 * incrementally and deprecated deliberately.
 *
 * Phase 10.2 — Design tokens and primitives
 */

// ─── Color Tokens ────────────────────────────────────────────────

export const studioColors = {
  // Surfaces (graphite depth scale)
  canvas: "#08060f",        // deepest — the page background
  shell: "#0d0916",         // shell chrome — slightly elevated
  surface: "#120e1c",       // inspector/drawer — one elevation above shell
  card: "rgba(20, 15, 31, 0.72)", // bounded information groups
  elevated: "rgba(29, 20, 44, 0.85)", // floating menus
  overlay: "rgba(8, 6, 15, 0.80)",   // modal backdrop

  // Text
  textPrimary: "#f5f1fa",
  textSecondary: "#a29aaf",
  textMuted: "#8a8299",
  textDisabled: "#5a5468",

  // Borders
  border: "rgba(155, 77, 255, 0.12)",
  borderStrong: "rgba(155, 77, 255, 0.22)",
  borderNeutral: "rgba(255, 255, 255, 0.06)",
  borderFocused: "rgba(155, 77, 255, 0.45)",

  // Semantic — Violet (LiTT identity, focus, selected)
  violet: "#9b4dff",
  violetSoft: "rgba(155, 77, 255, 0.15)",
  violetBorder: "rgba(155, 77, 255, 0.45)",

  // Semantic — Blue/Cyan (informational, connecting)
  blue: "#5b9bf5",
  blueSoft: "rgba(91, 155, 245, 0.12)",
  cyan: "#4dd4e0",

  // Semantic — Green (verified success and readiness only)
  green: "#4ade80",
  greenSoft: "rgba(74, 222, 128, 0.10)",

  // Semantic — Amber (attention, stale, awaiting approval)
  amber: "#fbb244",
  amberSoft: "rgba(251, 178, 68, 0.10)",

  // Semantic — Red (failed, destructive, blocked)
  red: "#f87171",
  redSoft: "rgba(248, 113, 113, 0.10)",

  // Semantic — Gray (idle, unavailable, not configured)
  gray: "#6b7280",
  graySoft: "rgba(107, 114, 128, 0.10)",
} as const;

// ─── Typography Tokens ───────────────────────────────────────────

export const studioTypography = {
  // Font families
  sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  mono: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',

  // Sizes
  xs: "10px",
  sm: "11px",
  base: "12px",
  md: "13px",
  lg: "14px",
  xl: "16px",
  "2xl": "18px",
  "3xl": "22px",

  // Weights
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,

  // Line heights
  lineHeightTight: 1.25,
  lineHeightNormal: 1.4,
  lineHeightRelaxed: 1.6,

  // Tracking
  trackingWide: "0.05em",
  trackingWider: "0.08em",
} as const;

// ─── Spacing Tokens (4px base) ───────────────────────────────────

export const studioSpacing = {
  0: "0px",
  1: "2px",
  2: "4px",
  3: "6px",
  4: "8px",
  5: "10px",
  6: "12px",
  8: "16px",
  10: "20px",
  12: "24px",
  16: "32px",
  20: "40px",
} as const;

// ─── Radius Tokens ───────────────────────────────────────────────

export const studioRadius = {
  none: "0px",
  sm: "4px",    // tiny controls and tags
  md: "6px",    // buttons and inputs
  lg: "8px",    // panels and menus
  xl: "12px",   // composer and major floating surfaces
  full: "9999px", // status pills, avatars
} as const;

// ─── Elevation Tokens ────────────────────────────────────────────

export const studioElevation = {
  // Shadows reserved for floating UI and overlays only
  floating: "0 4px 12px rgba(0, 0, 0, 0.3)",
  overlay: "0 8px 24px rgba(0, 0, 0, 0.4)",
  modal: "0 16px 48px rgba(0, 0, 0, 0.5)",
} as const;

// ─── Motion Tokens ───────────────────────────────────────────────

export const studioMotion = {
  fast: "120ms",     // press and hover
  normal: "180ms",   // tab/panel transitions
  slow: "250ms",     // drawers and mobile sheets
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
  easeOut: "cubic-bezier(0.0, 0, 0.2, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

// ─── Focus Tokens ────────────────────────────────────────────────

export const studioFocus = {
  ring: `0 0 0 2px ${studioColors.canvas}, 0 0 0 4px ${studioColors.violetBorder}`,
  ringVisible: `outline: 2px solid ${studioColors.violetBorder}; outline-offset: 2px;`,
} as const;

// ─── Layout Tokens ───────────────────────────────────────────────

export const studioLayout = {
  headerHeight: "48px",
  railWidth: "56px",
  railWidthCompact: "52px",
  inspectorWidth: "340px",
  inspectorWidthCompact: "300px",
  inspectorWidthWide: "380px",
  composerMaxWidth: "960px",
  touchTarget: "44px",
} as const;

// ─── CSS Custom Properties Mapping ───────────────────────────────

/**
 * Maps the token values to CSS custom properties for use in components.
 * These are the canonical Studio tokens. Old variables should migrate
 * to these incrementally.
 */
export const studioCSSProperties: Record<string, string> = {
  // Colors
  "--studio-canvas": studioColors.canvas,
  "--studio-shell": studioColors.shell,
  "--studio-surface": studioColors.surface,
  "--studio-card": studioColors.card,
  "--studio-elevated": studioColors.elevated,
  "--studio-overlay": studioColors.overlay,
  "--studio-text-primary": studioColors.textPrimary,
  "--studio-text-secondary": studioColors.textSecondary,
  "--studio-text-muted": studioColors.textMuted,
  "--studio-text-disabled": studioColors.textDisabled,
  "--studio-border": studioColors.border,
  "--studio-border-strong": studioColors.borderStrong,
  "--studio-border-neutral": studioColors.borderNeutral,
  "--studio-border-focused": studioColors.borderFocused,

  // Semantic colors
  "--studio-violet": studioColors.violet,
  "--studio-violet-soft": studioColors.violetSoft,
  "--studio-blue": studioColors.blue,
  "--studio-blue-soft": studioColors.blueSoft,
  "--studio-green": studioColors.green,
  "--studio-green-soft": studioColors.greenSoft,
  "--studio-amber": studioColors.amber,
  "--studio-amber-soft": studioColors.amberSoft,
  "--studio-red": studioColors.red,
  "--studio-red-soft": studioColors.redSoft,
  "--studio-gray": studioColors.gray,
  "--studio-gray-soft": studioColors.graySoft,

  // Typography
  "--studio-font-sans": studioTypography.sans,
  "--studio-font-mono": studioTypography.mono,
  "--studio-text-xs": studioTypography.xs,
  "--studio-text-sm": studioTypography.sm,
  "--studio-text-base": studioTypography.base,
  "--studio-text-md": studioTypography.md,
  "--studio-text-lg": studioTypography.lg,
  "--studio-text-xl": studioTypography.xl,

  // Spacing
  "--studio-space-1": studioSpacing[1],
  "--studio-space-2": studioSpacing[2],
  "--studio-space-4": studioSpacing[4],
  "--studio-space-6": studioSpacing[6],
  "--studio-space-8": studioSpacing[8],
  "--studio-space-12": studioSpacing[12],
  "--studio-space-16": studioSpacing[16],
  "--studio-space-20": studioSpacing[20],

  // Radius
  "--studio-radius-sm": studioRadius.sm,
  "--studio-radius-md": studioRadius.md,
  "--studio-radius-lg": studioRadius.lg,
  "--studio-radius-xl": studioRadius.xl,
  "--studio-radius-full": studioRadius.full,

  // Motion
  "--studio-motion-fast": studioMotion.fast,
  "--studio-motion-normal": studioMotion.normal,
  "--studio-motion-slow": studioMotion.slow,
  "--studio-motion-ease": studioMotion.ease,

  // Layout
  "--studio-header-h": studioLayout.headerHeight,
  "--studio-rail-w": studioLayout.railWidth,
  "--studio-inspector-w": studioLayout.inspectorWidth,
  "--studio-composer-max-w": studioLayout.composerMaxWidth,
};

// ─── Status Color Helper ─────────────────────────────────────────

export type StatusTone =
  | "idle"
  | "info"
  | "success"
  | "warning"
  | "error"
  | "violet";

export function statusColor(tone: StatusTone): string {
  switch (tone) {
    case "success": return studioColors.green;
    case "warning": return studioColors.amber;
    case "error": return studioColors.red;
    case "info": return studioColors.blue;
    case "violet": return studioColors.violet;
    case "idle":
    default: return studioColors.gray;
  }
}

export function statusBg(tone: StatusTone): string {
  switch (tone) {
    case "success": return studioColors.greenSoft;
    case "warning": return studioColors.amberSoft;
    case "error": return studioColors.redSoft;
    case "info": return studioColors.blueSoft;
    case "violet": return studioColors.violetSoft;
    case "idle":
    default: return studioColors.graySoft;
  }
}
