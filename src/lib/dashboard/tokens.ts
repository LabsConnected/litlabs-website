/**
 * Dashboard design tokens — now powered by CSS variables for theme support.
 *
 * These mirror the --dash-* CSS variables defined in globals.css.
 * Use `D.accent`, `D.textPrimary`, etc. exactly as before —
 * the values now respond to [data-dashboard-theme="light"].
 */

export const D = {
  surface: "var(--dash-surface)",
  surfaceHover: "var(--dash-surface-hover)",
  surfaceSolid: "var(--dash-surface-solid)",
  bg: "var(--dash-bg)",
  border: "var(--dash-border)",
  borderStrong: "var(--dash-border-strong)",
  accent: "var(--dash-accent)",
  accentGreen: "var(--dash-accent-green)",
  accentAmber: "var(--dash-accent-amber)",
  accentRed: "var(--dash-accent-red)",
  accentCyan: "var(--dash-accent-cyan)",
  textPrimary: "var(--dash-text-primary)",
  textMuted: "var(--dash-text-muted)",
  textDim: "var(--dash-text-dim)",
  backdrop: "var(--dash-backdrop)",
  shadow: "var(--dash-shadow)",
  cardBg: "var(--dash-card-bg)",
  cardHoverBorder: "var(--dash-card-hover-border)",
  skeleton: "var(--dash-skeleton)",
  skeletonDim: "var(--dash-skeleton-dim)",
  overlay: "var(--dash-overlay)",
  glow: "var(--dash-glow)",
  glowGreen: "var(--dash-glow-green)",
  heroGradient: "var(--dash-hero-gradient)",
  textOnAccent: "var(--dash-text-on-accent)",
  dangerText: "var(--dash-danger-text)",
} as const;

export type DashboardTokens = typeof D;
