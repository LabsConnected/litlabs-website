export const DEFAULT_MASCOT_DESCRIPTION =
  "A friendly, expressive AI mascot with large round eyes, a small smiling mouth, and a glowing cyan crystal on its chest. The mascot has a rounded, blob-like body with a smooth gradient from teal to deep blue. It floats slightly above the ground with tiny stubby arms and a small antenna on top.";

export interface VisualPack {
  id: string;
  name: string;
  theme: string;
  wallpaper?: string;
  font?: string;
  effects?: string[];
}

export const DEFAULT_VISUAL_PACK: VisualPack = {
  id: "midnight",
  name: "Midnight",
  theme: "dark",
  font: "system-ui",
  effects: ["blur", "particles"],
};
