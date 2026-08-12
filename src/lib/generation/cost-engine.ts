import "server-only";
import type { CostInput, CostResult, LittProduct, ProductTier } from "./types";

/**
 * Server-side cost engine.
 *
 * Converts real provider costs (in cents USD) into retail LiTTBits.
 *
 * Formula:
 *   retailBits = ceil((providerCostCents + infraAllowanceCents) * (1 + marginPercent/100) / CENTS_PER_BIT)
 *
 * CENTS_PER_BIT is the canonical exchange rate: 1 LiTTBit ≈ $0.01
 * (100 LiTTBits = $1.00). This keeps the math simple and transparent.
 *
 * Until shadow billing is verified against real provider invoices,
 * we use a conservative margin and a small infra allowance.
 */

const CENTS_PER_BIT = 1; // 1 LiTTBit = $0.01 = 1 cent
const DEFAULT_MARGIN_PERCENT = 50; // 50% margin on top of provider + infra cost
const DEFAULT_INFRA_ALLOWANCE_CENTS = 1; // $0.01 per generation for R2/compute

/**
 * Provider cost catalog — actual provider pricing per generation.
 *
 * These are the REAL costs LiTTree pays to the provider.
 * Updated from provider pricing pages.
 *
 * Sources:
 * - Gemini 3.1 Flash Lite Image: ~$0.025/image (Google AI pricing)
 * - Gemini 3.1 Flash Image: ~$0.039/image
 * - Gemini 3 Pro Image: ~$0.075/image
 * - Veo 3.1 Fast 720p: $0.10/sec → 4s = $0.40, 8s = $0.80
 * - Veo 3.1 Fast 1080p: $0.12/sec → 4s = $0.48, 8s = $0.96
 * - Lyria 3 Clip: $0.04/request
 * - Lyria 3 Pro full song: $0.08/request
 * - ElevenLabs Music v2: ~$0.15/min → 30s = $0.075, 5min = $0.75
 * - ElevenLabs TTS: ~$0.30/1K chars
 * - Groq Whisper: $0.04/hour → negligible per request
 */
const PROVIDER_COST_CENTS: Record<string, number> = {
  // Images
  "gemini:gemini-3.1-flash-lite-image": 3,
  "gemini:gemini-3.1-flash-image": 4,
  "gemini:gemini-3-pro-image": 8,
  "gemini:gemini-2.5-flash-image": 4,
  "alibaba:qwen-image-2.0": 1,
  "cloudflare:flux-1-schnell": 0,
  "fal:flux-pro": 5,
  "together:flux-1-schnell-free": 0,
  "openai:dall-e-3": 4,
  "recraft:recraft-v3": 4,
  "pollinations:flux": 0,

  // Video (per generation, base 4s@720p)
  "veo:veo-3.1-fast-generate-preview": 40,
  "veo:veo-3.1-fast-1080p": 48,
  "alibaba:happyhorse-1.1-i2v": 20,

  // Music
  "google:lyria-3-clip-preview": 4,
  "google:lyria-3-pro-preview": 8,
  "elevenlabs:music_v2": 8, // base 30s; scaled by duration
  "mureka:mureka-default": 5,

  // Speech
  "groq:whisper-large-v3-turbo": 1,
  "elevenlabs:tts": 3,
};

/**
 * Get the provider cost in cents for a generation.
 * Falls back to a safe default if unknown.
 */
export function getProviderCostCents(input: CostInput): number {
  const key = `${input.provider}:${input.model}`;

  // Video: scale by duration and resolution
  if (input.modality === "video") {
    const baseCost = PROVIDER_COST_CENTS[key] ?? 40;
    const duration = input.durationSeconds ?? 4;
    const is1080p = input.resolution === "1080p";
    // Veo 3.1 Fast: $0.10/sec@720p, $0.12/sec@1080p
    if (input.provider === "veo") {
      const perSec = is1080p ? 12 : 10;
      return perSec * duration;
    }
    // Other video providers: base cost * (duration/4) rounded
    return Math.ceil((baseCost * duration) / 4);
  }

  // Music: scale by duration for ElevenLabs
  if (input.modality === "music") {
    if (input.provider === "elevenlabs") {
      const duration = input.durationSeconds ?? 30;
      // $0.15/min = 0.15 cents/sec
      return Math.ceil(duration * 0.15);
    }
    return PROVIDER_COST_CENTS[key] ?? 5;
  }

  return PROVIDER_COST_CENTS[key] ?? 3;
}

/**
 * Calculate retail LiTTBits from provider cost.
 *
 * Formula:
 *   totalCostCents = providerCost + infraAllowance
 *   retailCents = totalCostCents * (1 + margin/100)
 *   retailBits = ceil(retailCents / CENTS_PER_BIT)
 *
 * Minimum 1 LiTTBit for any paid generation.
 * Free providers (cost=0) return 0 LiTTBits.
 */
export function calculateRetailBits(
  input: CostInput,
  options?: { marginPercent?: number; infraAllowanceCents?: number },
): CostResult {
  const providerCostCents = getProviderCostCents(input);
  const infraAllowanceCents = options?.infraAllowanceCents ?? DEFAULT_INFRA_ALLOWANCE_CENTS;
  const marginPercent = options?.marginPercent ?? DEFAULT_MARGIN_PERCENT;

  if (providerCostCents === 0) {
    return {
      providerCostCents: 0,
      infrastructureAllowanceCents: 0,
      marginPercent: 0,
      retailLiTTBits: 0,
    };
  }

  const totalCostCents = providerCostCents + infraAllowanceCents;
  const retailCents = Math.ceil(totalCostCents * (1 + marginPercent / 100));
  const retailLiTTBits = Math.max(1, Math.ceil(retailCents / CENTS_PER_BIT));

  return {
    providerCostCents,
    infrastructureAllowanceCents: infraAllowanceCents,
    marginPercent,
    retailLiTTBits,
  };
}

/**
 * LiTT product catalog — user-facing aliases.
 *
 * Users choose a product; LiTT selects the provider.
 * Provider names are hidden behind these aliases.
 */
export const LITT_PRODUCTS: LittProduct[] = [
  // Images
  {
    id: "litt-image-fast",
    label: "LiTT Image Fast",
    modality: "image",
    tier: "fast",
    provider: "gemini",
    model: "gemini-3.1-flash-lite-image",
    description: "Fast, affordable image generation for drafts and concepts.",
  },
  {
    id: "litt-image",
    label: "LiTT Image",
    modality: "image",
    tier: "balanced",
    provider: "gemini",
    model: "gemini-3.1-flash-image",
    description: "Balanced quality and speed for most use cases.",
  },
  {
    id: "litt-image-pro",
    label: "LiTT Image Pro",
    modality: "image",
    tier: "pro",
    provider: "gemini",
    model: "gemini-3-pro-image",
    description: "Professional quality for production-ready images.",
  },
  {
    id: "litt-vector",
    label: "LiTT Vector",
    modality: "image",
    tier: "pro",
    provider: "recraft",
    model: "recraft-v3",
    description: "Vector art and SVG assets for logos and branding.",
  },

  // Video
  {
    id: "litt-video",
    label: "LiTT Video",
    modality: "video",
    tier: "balanced",
    provider: "veo",
    model: "veo-3.1-fast-generate-preview",
    description: "Cinematic video generation with Veo 3.1 Fast.",
  },
  {
    id: "litt-video-pro",
    label: "LiTT Video Pro",
    modality: "video",
    tier: "pro",
    provider: "veo",
    model: "veo-3.1-fast-generate-preview",
    description: "Higher resolution video with extended duration.",
  },

  // Music
  {
    id: "litt-music-preview",
    label: "LiTT Music Preview",
    modality: "music",
    tier: "fast",
    provider: "google",
    model: "lyria-3-clip-preview",
    description: "Quick 30-second music clips for inspiration.",
  },
  {
    id: "litt-music",
    label: "LiTT Music",
    modality: "music",
    tier: "balanced",
    provider: "google",
    model: "lyria-3-pro-preview",
    description: "Full songs with vocals, lyrics, and song structure.",
  },
  {
    id: "litt-music-studio",
    label: "LiTT Music Studio",
    modality: "music",
    tier: "pro",
    provider: "elevenlabs",
    model: "music_v2",
    description: "Premium creator workflow with section-by-section composition.",
  },

  // Speech
  {
    id: "litt-stt",
    label: "LiTT Transcribe",
    modality: "speech",
    tier: "fast",
    provider: "groq",
    model: "whisper-large-v3-turbo",
    description: "Fast speech-to-text with Groq Whisper.",
  },
  {
    id: "litt-tts",
    label: "LiTT Voice",
    modality: "speech",
    tier: "balanced",
    provider: "elevenlabs",
    model: "tts",
    description: "Premium text-to-speech with ElevenLabs voices.",
  },
];

/**
 * Resolve a LiTT product by ID.
 */
export function getLittProduct(productId: string): LittProduct | undefined {
  return LITT_PRODUCTS.find((p) => p.id === productId);
}

/**
 * Get all products for a modality.
 */
export function getProductsForModality(modality: LittProduct["modality"]): LittProduct[] {
  return LITT_PRODUCTS.filter((p) => p.modality === modality);
}

/**
 * Get the default product for a modality + tier.
 */
export function getDefaultProduct(
  modality: LittProduct["modality"],
  tier: ProductTier = "balanced",
): LittProduct | undefined {
  return LITT_PRODUCTS.find((p) => p.modality === modality && p.tier === tier);
}
