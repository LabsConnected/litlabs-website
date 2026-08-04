// Media provider catalog — shared by /api/media/generate, /api/flow, and the /flow UI.
// To add a new renderer: append a MediaProvider entry, then add a handler in
// src/app/api/media/generate/route.ts. Costs are in LiTTBits.

export type MediaFormat = "image" | "video";

export type MediaProviderId =
  | "pollinations"
  | "gemini"
  | "fal"
  | "huggingface"
  | "together"
  | "openai"
  | "recraft"
  | "alibaba"
  | "cloudflare"
  | "luma"
  | "veo"
  | "runway";

/** Provider selection — includes auto modes + manual provider IDs. */
export type ProviderSelection = "auto-free" | "auto-quality" | MediaProviderId;

export interface MediaProvider {
  id: MediaProviderId;
  label: string;
  description: string;
  supportedFormats: MediaFormat[];
  /** LiTTBits cost per render. */
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
    id: "cloudflare",
    label: "Cloudflare Workers AI",
    description: "Free everyday drafts via FLUX schnell on Cloudflare Workers AI.",
    supportedFormats: ["image"],
    cost: () => 0,
    requiresKey: true,
    free: true,
    tier: "free",
  },
  {
    id: "alibaba",
    label: "Alibaba Qwen Image",
    description: "Qwen/Wan image generation through Model Studio.",
    supportedFormats: ["image"],
    cost: () => 1,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
  {
    id: "gemini",
    label: "Gemini (Flash Image)",
    description: "Google Gemini 3.1 Flash Image generation via GEMINI_API_KEY.",
    supportedFormats: ["image"],
    cost: () => 1,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
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
    id: "fal",
    label: "FAL.ai (FLUX Pro)",
    description: "FLUX.1 Pro via FAL — highest quality images, fast inference.",
    supportedFormats: ["image"],
    cost: () => 3,
    requiresKey: true,
    free: false,
    tier: "pro",
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
    id: "together",
    label: "Together.ai (FLUX)",
    description: "FLUX.1 Schnell Free model. Fast, high quality. Needs TOGETHER_API_KEY.",
    supportedFormats: ["image"],
    cost: () => 2,
    requiresKey: true,
    free: false,
    tier: "cheap",
  },
  {
    id: "openai",
    label: "OpenAI (DALL-E 3)",
    description: "DALL-E 3 for photorealistic images. Needs OPENAI_API_KEY.",
    supportedFormats: ["image"],
    cost: () => 5,
    requiresKey: true,
    free: false,
    tier: "pro",
  },
  {
    id: "recraft",
    label: "Recraft (SVG/Vector)",
    description: "Vector art and SVG generation. Needs RECRAFT_API_KEY.",
    supportedFormats: ["image"],
    cost: () => 3,
    requiresKey: true,
    free: false,
    tier: "pro",
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

/** Resolve a "default" provider for a given format (prefer configured API keys over free services). */
export const defaultProviderFor = (format: MediaFormat): MediaProviderId => {
  const candidates = MEDIA_PROVIDERS.filter(p =>
    p.supportedFormats.includes(format)
  );
  if (format === "image") {
    // Prefer Cloudflare Workers AI (free) if configured
    if (process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_API_TOKEN) {
      const cf = candidates.find(p => p.id === "cloudflare");
      if (cf) return cf.id;
    }
    // Then Gemini if configured (reliable, low cost)
    if (process.env.GEMINI_API_KEY) {
      const gemini = candidates.find(p => p.id === "gemini");
      if (gemini) return gemini.id;
    }
    // Then Alibaba if configured (free quota)
    if (process.env.ALIBABA_DASHSCOPE_API_KEY && process.env.ALIBABA_MODELSTUDIO_WORKSPACE_ID) {
      const alibaba = candidates.find(p => p.id === "alibaba");
      if (alibaba) return alibaba.id;
    }
    // Then FAL if configured
    if (process.env.FAL_KEY) {
      const fal = candidates.find(p => p.id === "fal");
      if (fal) return fal.id;
    }
    // Last resort: Pollinations (free, no key, but unreliable)
    const free = candidates.find(p => p.id === "pollinations");
    if (free) return free.id;
  }
  // Fall back to free provider
  const free = candidates.find(p => p.free);
  if (free) return free.id;
  return "huggingface";
};
