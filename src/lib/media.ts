// Media provider catalog — shared by /api/media/generate, /api/flow, and the /flow UI.
// To add a new renderer: append a MediaProvider entry, then add a handler in
// src/app/api/media/generate/route.ts. Costs are in LiTBit Coins.

export type MediaFormat = "image" | "video";

export type MediaProviderId =
  | "pollinations"
  | "together"
  | "fal"
  | "huggingface"
  | "luma"
  | "veo"
  | "runway";

export interface MediaProvider {
  id: MediaProviderId;
  label: string;
  description: string;
  supportedFormats: MediaFormat[];
  /** Coin cost per render. */
  cost: (format: MediaFormat, style?: string) => number;
  /** Whether the provider requires any external API key to function. */
  requiresKey: boolean;
  /** Free-tier / no-key flag for badge display. */
  free: boolean;
  /** Provider quality tag for UI sorting. */
  tier: "free" | "cheap" | "pro" | "premium";
}

export const MEDIA_PROVIDERS: MediaProvider[] = [
  {
    id: "pollinations",
    label: "Pollinations (Free)",
    description: "No API key. Flux + SDXL image generation. Default for agents.",
    supportedFormats: ["image"],
    cost: () => 0, // free!
    requiresKey: false,
    free: true,
    tier: "free",
  },
  {
    id: "together",
    label: "Together.ai (FLUX)",
    description: "FLUX.1 Schnell — fast, high-quality images. Very cheap.",
    supportedFormats: ["image"],
    cost: () => 2,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
  {
    id: "fal",
    label: "FAL.ai (FLUX)",
    description: "FLUX Pro via FAL — generous free tier, fast inference.",
    supportedFormats: ["image"],
    cost: () => 3,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
  {
    id: "huggingface",
    label: "Hugging Face Video",
    description: "Stable Video Diffusion clips. Needs HUGGING_FACE_API_KEY.",
    supportedFormats: ["video"],
    cost: () => 20,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
  {
    id: "luma",
    label: "Luma Ray 3 (Coming Soon)",
    description: "Best quality/cost for cinematic short clips. ~$0.32/sec.",
    supportedFormats: ["image", "video"],
    cost: (f) => (f === "video" ? 80 : 20),
    requiresKey: true,
    free: false,
    tier: "pro",
  },
  {
    id: "veo",
    label: "Google Veo 3 (Coming Soon)",
    description: "Cinematic + native audio + Ingredients. Via Gemini API.",
    supportedFormats: ["image", "video"],
    cost: (f) => (f === "video" ? 200 : 40),
    requiresKey: true,
    free: false,
    tier: "premium",
  },
  {
    id: "runway",
    label: "Runway Gen-4.5 (Coming Soon)",
    description: "Style transfer, inpainting, object insertion.",
    supportedFormats: ["video"],
    cost: () => 120,
    requiresKey: true,
    free: false,
    tier: "premium",
  },
];

export const getProvider = (id: MediaProviderId) =>
  MEDIA_PROVIDERS.find(p => p.id === id);

/** Resolve a "default" provider for a given format (free over paid when possible). */
export const defaultProviderFor = (format: MediaFormat): MediaProviderId => {
  const candidates = MEDIA_PROVIDERS.filter(p =>
    p.supportedFormats.includes(format)
  );
  // Prefer free first
  const free = candidates.find(p => p.free);
  if (free) return free.id;
  // Then together for image, hf for video
  if (format === "image") return "together";
  return "huggingface";
};
