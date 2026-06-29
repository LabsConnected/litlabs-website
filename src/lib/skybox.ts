export const STYLE_PRESETS = [
  { id: "dynamic", label: "Dynamic", desc: "Vibrant, action-packed", cost: 10 },
  { id: "cinematic", label: "Cinematic", desc: "Movie-grade dramatic", cost: 12 },
  { id: "anime", label: "Anime", desc: "Studio Ghibli-esque", cost: 12 },
  { id: "photographic", label: "Photographic", desc: "Hyper-realistic photo", cost: 10 },
  { id: "3d-render", label: "3D Render", desc: "Octane / Unreal quality", cost: 14 },
  { id: "digital-art", label: "Digital Art", desc: "Painterly concept art", cost: 10 },
  { id: "comic-book", label: "Comic Book", desc: "Bold ink, flat colors", cost: 10 },
  { id: "fantasy", label: "Fantasy", desc: "Epic mythological scenes", cost: 12 },
  { id: "scifi", label: "Sci-Fi", desc: "Cyberpunk space opera", cost: 12 },
  { id: "voxel", label: "Voxel", desc: "Minecraft-style worlds", cost: 10 },
  { id: "low-poly", label: "Low Poly", desc: "Geometric stylized", cost: 10 },
  { id: "watercolor", label: "Watercolor", desc: "Soft painted washes", cost: 10 },
  { id: "origami", label: "Origami", desc: "Paper-folded aesthetics", cost: 10 },
  { id: "retro-future", label: "Retro-Future", desc: "80s synthwave neon", cost: 12 },
  { id: "claymation", label: "Claymation", desc: "Stop-motion plasticine", cost: 10 },
  { id: "steampunk", label: "Steampunk", desc: "Brass, gears, vapor", cost: 12 },
] as const;

export type StyleId = (typeof STYLE_PRESETS)[number]["id"];

export function getStylePreset(id: string) {
  return STYLE_PRESETS.find((style) => style.id === id);
}
