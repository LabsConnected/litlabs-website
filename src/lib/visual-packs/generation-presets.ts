export interface GenerationPreset {
  id: string;
  label: string;
  name: string;
  description: string;
  prompt: string;
  promptSuffix?: string;
  negativePrompt?: string;
  aspectRatio?: string;
  style?: string;
}

export const GENERATION_PRESETS: GenerationPreset[] = [
  { id: "cinematic", label: "Cinematic", name: "Cinematic", description: "Dramatic film-style shot", prompt: "cinematic shot, dramatic lighting, film grain, 35mm", aspectRatio: "16:9" },
  { id: "portrait", label: "Portrait", name: "Portrait", description: "Studio portrait", prompt: "studio portrait, soft lighting, shallow depth of field", aspectRatio: "1:1" },
  { id: "landscape", label: "Landscape", name: "Landscape", description: "Sweeping landscape", prompt: "sweeping landscape, golden hour, ultra wide angle", aspectRatio: "16:9" },
  { id: "anime", label: "Anime", name: "Anime", description: "Anime style art", prompt: "anime style, vibrant colors, cel shaded", aspectRatio: "1:1" },
  { id: "3d-render", label: "3D Render", name: "3D Render", description: "Photorealistic 3D", prompt: "3D render, octane, volumetric lighting, photorealistic", aspectRatio: "1:1" },
  { id: "watercolor", label: "Watercolor", name: "Watercolor", description: "Watercolor painting", prompt: "watercolor painting, soft washes, paper texture", aspectRatio: "1:1" },
  { id: "neon", label: "Neon Punk", name: "Neon Punk", description: "Cyberpunk neon", prompt: "neon punk, cyberpunk, glowing lights, rain, reflections", aspectRatio: "16:9" },
  { id: "minimal", label: "Minimal", name: "Minimal", description: "Clean minimalist", prompt: "minimalist, clean lines, negative space, flat colors", aspectRatio: "1:1" },
];
