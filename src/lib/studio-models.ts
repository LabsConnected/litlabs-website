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
};

export const CHAT_MODELS: StudioModel[] = [
  { id: "adaptive", name: "Adaptive", provider: "Auto", cost: "hybrid", speed: "fast", icon: "🧠", recommended: true, apiProvider: "gemini", apiModel: "gemini-2.5-flash" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "gemini", cost: "free", speed: "fast", icon: "⚡", apiModel: "gemini-2.5-flash" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", cost: "paid", speed: "fast", icon: "🔮", apiModel: "gpt-4o" },
  { id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", provider: "anthropic", cost: "paid", speed: "medium", icon: "🎯", apiModel: "claude-3-5-sonnet-20241022" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", cost: "free", speed: "fast", icon: "⚡", apiModel: "gpt-4o-mini" },
  { id: "ollama-local", name: "Local Ollama", provider: "ollama", cost: "free", speed: "medium", icon: "🖥️", apiModel: "llama3" },
];

export const CODE_MODELS: StudioModel[] = [
  { id: "gemini-flash", name: "Gemini 2.5 Flash", short: "Gemini", provider: "gemini", cost: "free", speed: "fast", icon: "⚡" },
  { id: "gpt-4o", name: "GPT-4o", short: "GPT-4o", provider: "openai", cost: "paid", speed: "fast", icon: "🔮" },
  { id: "claude-sonnet", name: "Claude Sonnet", short: "Claude", provider: "anthropic", cost: "paid", speed: "medium", icon: "🎯" },
  { id: "qwen-coder", name: "Qwen3 Coder", short: "Qwen", provider: "openrouter", cost: "free", speed: "fast", icon: "⌨️" },
  { id: "llama-nemotron", name: "Llama Nemotron 70B", short: "Llama", provider: "openrouter", cost: "free", speed: "medium", icon: "🦙" },
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
