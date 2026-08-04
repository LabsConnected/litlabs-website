export type StudioModel = {
  id: string;
  name: string;
  provider: string;
  cost: "free" | "paid" | "hybrid";
  speed: "fast" | "medium" | "slow";
  icon: string;
  recommended?: boolean;
  apiModel?: string;
  apiProvider?: string;
  short?: string;
  category?: "auto" | "free" | "fast" | "code" | "creative" | "vision" | "byok" | "litt-alias";
  /** True if this is a stable LiTT alias that routes to an underlying provider. */
  isLittAlias?: boolean;
  /** Description shown in the model picker tooltip. */
  description?: string;
};

/**
 * LiTT model aliases — stable, branded names that route to underlying providers.
 * UI code references these aliases, never raw provider model IDs.
 * The server resolves each alias to the best available provider at call time.
 *
 * When LiteLLM is installed, these aliases map directly to LiteLLM model groups.
 * Until then, they route through the existing provider chain with fallback.
 */
export const LITT_MODEL_ALIASES: StudioModel[] = [
  {
    id: "litt-fast",
    name: "LiTT Fast",
    provider: "LiTT",
    cost: "free",
    speed: "fast",
    icon: "⚡",
    category: "litt-alias",
    isLittAlias: true,
    recommended: true,
    description: "Quick answers and simple tasks. Routes to the fastest available model.",
    apiProvider: "groq",
    apiModel: "llama-3.3-70b-versatile",
  },
  {
    id: "litt-balanced",
    name: "LiTT Balanced",
    provider: "LiTT",
    cost: "hybrid",
    speed: "medium",
    icon: "⚖️",
    category: "litt-alias",
    isLittAlias: true,
    recommended: true,
    description: "General-purpose chat with good quality and speed.",
    apiProvider: "gemini",
    apiModel: "gemini-2.5-flash",
  },
  {
    id: "litt-reasoning",
    name: "LiTT Reasoning",
    provider: "LiTT",
    cost: "paid",
    speed: "slow",
    icon: "🧠",
    category: "litt-alias",
    isLittAlias: true,
    description: "Complex planning, analysis, and multi-step reasoning.",
    apiProvider: "openrouter-deepseek",
    apiModel: "deepseek/deepseek-chat:free",
  },
  {
    id: "litt-code",
    name: "LiTT Code",
    provider: "LiTT",
    cost: "free",
    speed: "fast",
    icon: "⌨️",
    category: "litt-alias",
    isLittAlias: true,
    description: "Code generation, debugging, and technical work.",
    apiProvider: "openrouter-qwen",
    apiModel: "qwen/qwen-2.5-coder-32b-instruct:free",
  },
  {
    id: "litt-research",
    name: "LiTT Research",
    provider: "LiTT",
    cost: "hybrid",
    speed: "medium",
    icon: "🔍",
    category: "litt-alias",
    isLittAlias: true,
    description: "Web research, summarization, and information gathering.",
    apiProvider: "gemini",
    apiModel: "gemini-2.5-flash",
  },
];

/**
 * Media model aliases — stable LiTT names for image, video, audio, music.
 */
export const LITT_MEDIA_ALIASES = [
  { id: "litt-image", label: "LiTT Image", provider: "LiTT", description: "Image generation", aliasFor: "image" },
  { id: "litt-video", label: "LiTT Video", provider: "LiTT", description: "Video generation", aliasFor: "video" },
  { id: "litt-audio", label: "LiTT Audio", provider: "LiTT", description: "Audio generation", aliasFor: "audio" },
  { id: "litt-music", label: "LiTT Music", provider: "LiTT", description: "Music generation", aliasFor: "music" },
] as const;

export const CHAT_MODELS: StudioModel[] = [
  // ── LiTT Aliases — stable branded names (shown first) ────────────
  ...LITT_MODEL_ALIASES,

  // ── Auto Best — routes through the full chain ────────────────────
  { id: "auto", name: "Auto Best", provider: "Auto", cost: "hybrid", speed: "fast", icon: "🧠", recommended: true, category: "auto", apiProvider: "gemini", apiModel: "gemini-2.5-flash" },

  // Free AI — Gemini primary, OpenRouter free fallback
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", cost: "free", speed: "fast", icon: "⚡", category: "free", apiModel: "gemini-2.5-flash" },
  { id: "openrouter-free", name: "OpenRouter Free", provider: "openrouter", cost: "free", speed: "medium", icon: "🎁", category: "free", apiProvider: "openrouter-free", apiModel: "openrouter/free" },
  { id: "deepseek-free", name: "DeepSeek Chat", provider: "openrouter", cost: "free", speed: "medium", icon: "🐍", category: "free", apiProvider: "openrouter-deepseek", apiModel: "deepseek/deepseek-chat:free" },
  { id: "llama-free", name: "Llama 3.3 70B", provider: "openrouter", cost: "free", speed: "medium", icon: "🦙", category: "free", apiProvider: "openrouter-llama", apiModel: "meta-llama/llama-3.3-70b-instruct:free" },

  // Fast — Groq primary, Gemini Flash fallback
  { id: "groq-llama-70b", name: "Groq Llama 70B", provider: "groq", cost: "free", speed: "fast", icon: "🚀", recommended: true, category: "fast", apiProvider: "groq", apiModel: "llama-3.3-70b-versatile" },

  // Coding — Qwen3 Coder primary, Gemini fallback
  { id: "qwen-coder", name: "Qwen3 Coder", provider: "openrouter", cost: "free", speed: "fast", icon: "⌨️", category: "code", apiProvider: "openrouter-qwen", apiModel: "qwen/qwen-2.5-coder-32b-instruct:free" },

  // Creative — Gemini high temp
  { id: "gemini-creative", name: "Gemini Creative", provider: "gemini", cost: "free", speed: "fast", icon: "🎨", category: "creative", apiModel: "gemini-2.5-flash" },

  // Vision — Gemini vision-capable
  { id: "gemini-vision", name: "Gemini Vision", provider: "gemini", cost: "free", speed: "fast", icon: "👁️", category: "vision", apiModel: "gemini-2.5-flash" },

  // BYOK — user-supplied keys
  { id: "gpt-4o", name: "GPT-4o (BYOK)", provider: "openai", cost: "paid", speed: "fast", icon: "🔮", category: "byok", apiModel: "gpt-4o" },
  { id: "claude-sonnet", name: "Claude Sonnet (BYOK)", provider: "anthropic", cost: "paid", speed: "medium", icon: "🎯", category: "byok", apiModel: "claude-3-5-sonnet-20241022" },
];

export const CODE_MODELS: StudioModel[] = [
  { id: "qwen-coder", name: "Qwen3 Coder", short: "Qwen", provider: "openrouter", cost: "free", speed: "fast", icon: "⌨️", apiProvider: "openrouter-qwen" },
  { id: "gemini-flash", name: "Gemini 2.5 Flash", short: "Gemini", provider: "gemini", cost: "free", speed: "fast", icon: "⚡" },
  { id: "groq-llama", name: "Groq Llama 70B", short: "Groq", provider: "groq", cost: "free", speed: "fast", icon: "🚀", apiProvider: "groq" },
  { id: "gpt-4o", name: "GPT-4o", short: "GPT-4o", provider: "openai", cost: "paid", speed: "fast", icon: "🔮" },
  { id: "claude-sonnet", name: "Claude Sonnet", short: "Claude", provider: "anthropic", cost: "paid", speed: "medium", icon: "🎯" },
];

export type MediaModel = {
  id: string;
  label: string;
  provider: string;
  desc: string;
  cost: number;
  /** False when the model is advertised in the UI but the server route does not yet handle it. */
  available: boolean;
};

export const VIDEO_MODELS: MediaModel[] = [
  { id: "veo",         label: "Veo",         provider: "Google",     desc: "High-quality cinematic",     cost: 5, available: true  },
  { id: "happyhorse",  label: "HappyHorse",  provider: "Alibaba",    desc: "Image-to-video, smooth motion", cost: 3, available: true  },
  { id: "wan",         label: "Wan",         provider: "Alibaba",    desc: "Fast general purpose",       cost: 3, available: false },
  { id: "wan-pro",     label: "Wan Pro",     provider: "Alibaba",    desc: "Enhanced quality",           cost: 4, available: false },
  { id: "seedance-pro",label: "Seedance Pro",provider: "ByteDance",  desc: "Motion mastery",             cost: 4, available: false },
  { id: "ltx-2",       label: "LTX-2",       provider: "Lightricks", desc: "Realistic scenes",           cost: 3, available: false },
];

export const MUSIC_MODELS = [
  { id: "lyria-3-clip-preview", label: "Lyria", provider: "Google", desc: "Full music generation", cost: 3 },
];

export const SPACE_MODEL = {
  id: "minimax-skybox",
  label: "MiniMax",
  provider: "MiniMax",
};

export function getChatModel(id: string) {
  return CHAT_MODELS.find((model) => model.id === id) ?? CHAT_MODELS[0];
}

/**
 * Returns true if the model ID is a LiTT alias (stable branded name).
 */
export function isLittAlias(id: string): boolean {
  return LITT_MODEL_ALIASES.some((m) => m.id === id);
}

/**
 * Resolve a LiTT alias to its underlying provider + model.
 * Returns the alias's apiProvider and apiModel, or null if not an alias.
 */
export function resolveLittAlias(
  id: string,
): { apiProvider: string; apiModel: string } | null {
  const alias = LITT_MODEL_ALIASES.find((m) => m.id === id);
  if (!alias?.apiProvider || !alias?.apiModel) return null;
  return { apiProvider: alias.apiProvider, apiModel: alias.apiModel };
}

/**
 * List all LiTT aliases for the model picker UI.
 */
export function getLittAliases(): StudioModel[] {
  return LITT_MODEL_ALIASES;
}
