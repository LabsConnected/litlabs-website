/**
 * Fun Layer v1 — Theme Preview Definitions
 *
 * Six selectable theme previews for the Daily Challenge card.
 * These are PREVIEW-ONLY — no unlock claims, no persistence of ownership.
 * A local draft preference may be stored but must be labeled as a preview
 * preference, not an earned item.
 */

export type ThemeId =
  | "neon-ember"
  | "cyber-forest"
  | "midnight-lab"
  | "toxic-arcade"
  | "solar-flare"
  | "ghost-circuit";

export interface ThemePreview {
  id: ThemeId;
  name: string;
  description: string;
  /** Background color (darkest layer) */
  background: string;
  /** Panel surface color */
  panel: string;
  /** Primary accent (glow, buttons) */
  primaryAccent: string;
  /** Secondary accent (highlights, secondary glow) */
  secondaryAccent: string;
  /** Heading text color */
  heading: string;
  /** Body text color */
  bodyText: string;
  /** Status / functional accent (used sparingly) */
  status: string;
  /** Glow intensity 0–1 for preview rendering */
  glowIntensity: number;
}

export const THEME_PREVIEWS: ThemePreview[] = [
  {
    id: "neon-ember",
    name: "Neon Ember",
    description: "Black, orange, magenta — the LiTTree signature direction.",
    background: "#03050b",
    panel: "#0a0d18",
    primaryAccent: "#ff6b1a",
    secondaryAccent: "#ff00a0",
    heading: "#fff0e0",
    bodyText: "#eef4ff",
    status: "#00f0ff",
    glowIntensity: 0.7,
  },
  {
    id: "cyber-forest",
    name: "Cyber Forest",
    description: "Cyan, violet, deep green — digital undergrowth.",
    background: "#040c0a",
    panel: "#0a1814",
    primaryAccent: "#00f0ff",
    secondaryAccent: "#8b5cf6",
    heading: "#d0f0e0",
    bodyText: "#c8e6d5",
    status: "#34d399",
    glowIntensity: 0.5,
  },
  {
    id: "midnight-lab",
    name: "Midnight Lab",
    description: "Black, silver, electric blue — clean laboratory noir.",
    background: "#050608",
    panel: "#0c0e14",
    primaryAccent: "#3b82f6",
    secondaryAccent: "#94a3b8",
    heading: "#e2e8f0",
    bodyText: "#cbd5e1",
    status: "#60a5fa",
    glowIntensity: 0.4,
  },
  {
    id: "toxic-arcade",
    name: "Toxic Arcade",
    description: "Lime, purple, charcoal — retro poison cabinet.",
    background: "#0a0a0a",
    panel: "#141414",
    primaryAccent: "#a3e635",
    secondaryAccent: "#a855f7",
    heading: "#f0f0e0",
    bodyText: "#d4d4c0",
    status: "#a3e635",
    glowIntensity: 0.6,
  },
  {
    id: "solar-flare",
    name: "Solar Flare",
    description: "Orange, gold, dark red — coronal mass ejection.",
    background: "#0d0604",
    panel: "#1a0e08",
    primaryAccent: "#f97316",
    secondaryAccent: "#fbbf24",
    heading: "#fef3c7",
    bodyText: "#fde68a",
    status: "#f59e0b",
    glowIntensity: 0.65,
  },
  {
    id: "ghost-circuit",
    name: "Ghost Circuit",
    description: "White, cyan, near-black — spectral hardware.",
    background: "#020204",
    panel: "#08080c",
    primaryAccent: "#22d3ee",
    secondaryAccent: "#f8fafc",
    heading: "#f8fafc",
    bodyText: "#e2e8f0",
    status: "#22d3ee",
    glowIntensity: 0.55,
  },
];

export const THEME_MAP: Record<ThemeId, ThemePreview> = Object.fromEntries(
  THEME_PREVIEWS.map((t) => [t.id, t]),
) as Record<ThemeId, ThemePreview>;

export function getThemePreview(id: ThemeId): ThemePreview {
  return THEME_MAP[id] ?? THEME_PREVIEWS[0];
}

export const DEFAULT_THEME: ThemeId = "neon-ember";
