export type StudioTheme = {
  id: string;
  name: string;
  bg: string;
  surface: string;
  accent: string;
  linkColor: string;
  text: string;
  muted: string;
  border: string;
};

export const THEMES: StudioTheme[] = [
  {
    id: "volcanic",
    name: "Volcanic",
    bg: "#0e0a0a",
    surface: "#201615",
    accent: "#f97316",
    linkColor: "#fb923c",
    text: "#f9e7dd",
    muted: "#9f887f",
    border: "#5b3a31",
  },
  {
    id: "neon",
    name: "Neon",
    bg: "#05070d",
    surface: "#101826",
    accent: "#22d3ee",
    linkColor: "#d946ef",
    text: "#e6faff",
    muted: "#7ea8b3",
    border: "#214055",
  },
  {
    id: "midnight",
    name: "Midnight",
    bg: "#0a0f1a",
    surface: "#11192a",
    accent: "#60a5fa",
    linkColor: "#8b5cf6",
    text: "#dbe7ff",
    muted: "#7b8aa3",
    border: "#24324b",
  },
  {
    id: "emerald",
    name: "Emerald",
    bg: "#07120f",
    surface: "#11221c",
    accent: "#34d399",
    linkColor: "#22c55e",
    text: "#ddf5ea",
    muted: "#80a79a",
    border: "#22473a",
  },
  {
    id: "honeycomb",
    name: "Honeycomb",
    bg: "#0d0a05",
    surface: "#1a1510",
    accent: "#f59e0b",
    linkColor: "#fbbf24",
    text: "#f5e6c8",
    muted: "#a8916b",
    border: "#3d3220",
  },
];

export function getThemeById(id: string) {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
