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
  category?: "auto" | "free" | "fast" | "code" | "creative" | "vision" | "byok";
};

export const CHAT_MODELS: StudioModel[] = [
  // Auto Best — routes through the full chain
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
};

export const VIDEO_MODELS: MediaModel[] = [
  { id: "veo", label: "Veo", provider: "Google", desc: "High-quality cinematic", cost: 5 },
  { id: "happyhorse", label: "HappyHorse", provider: "Alibaba", desc: "Image-to-video, smooth motion", cost: 3 },
  { id: "wan", label: "Wan", provider: "Alibaba", desc: "Fast general purpose", cost: 3 },
  { id: "wan-pro", label: "Wan Pro", provider: "Alibaba", desc: "Enhanced quality", cost: 4 },
  { id: "seedance-pro", label: "Seedance Pro", provider: "ByteDance", desc: "Motion mastery", cost: 4 },
  { id: "ltx-2", label: "LTX-2", provider: "Lightricks", desc: "Realistic scenes", cost: 3 },
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
