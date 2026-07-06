/**
 * LiTT Core Brain Router
 *
 * Model-agnostic AI companion router for LiTTree Lab Studios.
 * Tries OpenRouter → Groq → Ollama → static fallback.
 * Returns structured JSON: { reply, mood, action }.
 */

import { chatWithOpenRouter } from "./providers/openrouter";
import { chatWithGroq } from "./providers/groq";
import { chatWithOllama } from "./providers/ollama";
import { LiTT_SYSTEM_PROMPT } from "./litt-system-prompt";

export type LiTTMood =
  | "happy"
  | "excited"
  | "focused"
  | "thinking"
  | "wink"
  | "cheeky"
  | "love"
  | "surprised"
  | "sleepy";

export type LiTTAction =
  | "chat"
  | "code_help"
  | "music_idea"
  | "design_idea"
  | "site_help";

export interface LiTTResponse {
  reply: string;
  mood: LiTTMood;
  action?: LiTTAction;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LittProviderName = "openrouter" | "groq" | "ollama" | "static";

export interface LittRouterResult extends LiTTResponse {
  provider: LittProviderName;
  model?: string;
  latencyMs: number;
  failover: LittProviderName[];
}

export interface LittRouterOptions {
  /** Force a specific provider (skips the chain). */
  provider?: LittProviderName;
  /** Override the default model for the chosen provider. */
  model?: string;
  /** Provider/model to use for Ollama. */
  ollamaModel?: string;
  /** Optional extra context injected into the system prompt. */
  context?: string;
  /** Maximum time to wait for a provider before failing over. */
  timeoutMs?: number;
}

const DEFAULT_PROVIDER_ORDER: LittProviderName[] = [
  "openrouter",
  "groq",
  "ollama",
  "static",
];

function getProviderOrder(opts: LittRouterOptions): LittProviderName[] {
  if (opts.provider) return [opts.provider, "static"];
  return DEFAULT_PROVIDER_ORDER;
}

function buildMessages(
  userMessage: string,
  history: ChatMessage[] = [],
  context?: string,
): ChatMessage[] {
  const system = context
    ? `${LiTT_SYSTEM_PROMPT}\n\nCurrent context:\n${context}`
    : LiTT_SYSTEM_PROMPT;

  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userMessage },
  ];
}

function normalizeResponse(raw: unknown): LiTTResponse {
  const fallback = staticFallback("Hey there, builder! 👋");
  if (!raw || typeof raw !== "object") return fallback;

  const obj = raw as Record<string, unknown>;
  const reply = typeof obj.reply === "string" && obj.reply.trim()
    ? obj.reply
    : fallback.reply;
  const mood = isValidMood(obj.mood) ? obj.mood : fallback.mood;
  const action = isValidAction(obj.action) ? obj.action : undefined;

  return { reply, mood, action };
}

function isValidMood(mood: unknown): mood is LiTTMood {
  const moods: LiTTMood[] = [
    "happy", "excited", "focused", "thinking", "wink", "cheeky", "love", "surprised", "sleepy",
  ];
  return typeof mood === "string" && moods.includes(mood as LiTTMood);
}

function isValidAction(action: unknown): action is LiTTAction {
  const actions: LiTTAction[] = [
    "chat", "code_help", "music_idea", "design_idea", "site_help",
  ];
  return typeof action === "string" && actions.includes(action as LiTTAction);
}

function pickStaticMood(message: string): LiTTMood {
  const lower = message.toLowerCase();
  if (/\b(love|heart|favorite|best|amazing|awesome)\b/.test(lower)) return "love";
  if (/\b(hello|hi|hey|sup|yo)\b/.test(lower)) return "happy";
  if (/\b(joke|lol|funny|meme|haha)\b/.test(lower)) return "cheeky";
  if (/\b(wink|secret|hint|psst)\b/.test(lower)) return "wink";
  if (/\b(help|fix|bug|error|broken|code|build|deploy)\b/.test(lower)) return "focused";
  if (/\b(idea|create|design|music|song|beat|art)\b/.test(lower)) return "excited";
  if (/\b(why|how|what|explain|confused|question)\b/.test(lower)) return "thinking";
  if (/\b(wow|oh|surprise|unexpected|whoa)\b/.test(lower)) return "surprised";
  return "sleepy";
}

function staticFallback(message: string): LiTTResponse {
  const mood = pickStaticMood(message);
  const action: LiTTAction | undefined = /\b(code|bug|fix|build|deploy)\b/.test(message.toLowerCase())
    ? "code_help"
    : /\b(music|beat|song|sound)\b/.test(message.toLowerCase())
      ? "music_idea"
      : /\b(design|art|color|ui|ux|layout)\b/.test(message.toLowerCase())
        ? "design_idea"
        : /\b(site|page|landing|seo|deploy|domain)\b/.test(message.toLowerCase())
          ? "site_help"
          : "chat";

  const replies: Record<LiTTMood, string> = {
    happy: "Hey there! LiTT is online and ready to build something weird with you. ⚡",
    excited: "Ooh, I love this energy! Let's make something loud. 🎨",
    focused: "Locked in. Tell me the problem and we'll break it down. 🧠",
    thinking: "Hmm, good question. Let me think through that with you... 🤔",
    wink: "I see what you're doing. Nice. 😉",
    cheeky: "Bold idea. I'm into it. Let's cause some chaos. 😏",
    love: "This is exactly why I love building with you. 💙",
    surprised: "Whoa, didn't see that coming. Let's figure it out! 😲",
    sleepy: "LiTT is recharging, but I still heard you. Try again in a sec? 😴",
  };

  return {
    reply: replies[mood],
    mood,
    action,
  };
}

async function callProvider(
  provider: LittProviderName,
  messages: ChatMessage[],
  opts: LittRouterOptions,
): Promise<{ response: LiTTResponse; model?: string }> {
  switch (provider) {
    case "openrouter": {
      const model = opts.model || process.env.OPENROUTER_MODEL || "openrouter/auto";
      const raw = await chatWithOpenRouter(messages, model, { jsonMode: true, timeoutMs: opts.timeoutMs });
      return { response: normalizeResponse(raw), model };
    }
    case "groq": {
      const model = opts.model || process.env.GROQ_MODEL || "llama3-8b-8192";
      const raw = await chatWithGroq(messages, model, { jsonMode: true, timeoutMs: opts.timeoutMs });
      return { response: normalizeResponse(raw), model };
    }
    case "ollama": {
      const model = opts.ollamaModel || opts.model || process.env.OLLAMA_MODEL || "qwen2.5-coder";
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      const raw = await chatWithOllama(messages, model, { baseUrl, timeoutMs: opts.timeoutMs });
      return { response: normalizeResponse(raw), model };
    }
    case "static": {
      const userMsg = messages.find(m => m.role === "user")?.content || "hi";
      return { response: staticFallback(userMsg) };
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Send a message to LiTT and get a structured response.
 *
 * @param userMessage - the current user message
 * @param history - previous messages (optional)
 * @param opts - routing options (optional)
 */
export async function chatWithLiTT(
  userMessage: string,
  history: ChatMessage[] = [],
  opts: LittRouterOptions = {},
): Promise<LittRouterResult> {
  const order = getProviderOrder(opts);
  const messages = buildMessages(userMessage, history, opts.context);
  const t0 = Date.now();
  const failover: LittProviderName[] = [];
  for (const provider of order) {
    try {
      const { response, model } = await callProvider(provider, messages, opts);
      return {
        ...response,
        provider,
        model,
        latencyMs: Date.now() - t0,
        failover,
      };
    } catch {
      failover.push(provider);
    }
  }

  // If every provider failed, return the static fallback with diagnostics.
  return {
    ...staticFallback(userMessage),
    provider: "static",
    latencyMs: Date.now() - t0,
    failover,
  };
}

export function isProviderAvailable(provider: LittProviderName): boolean {
  switch (provider) {
    case "openrouter":
      return !!process.env.OPENROUTER_API_KEY;
    case "groq":
      return !!process.env.GROQ_API_KEY;
    case "ollama":
      return true; // assumed local; runtime health check will catch failures
    case "static":
      return true;
  }
}

export function getAvailableProviders(): LittProviderName[] {
  return DEFAULT_PROVIDER_ORDER.filter(p => p === "static" || isProviderAvailable(p));
}

export function getDefaultProvider(): LittProviderName {
  const env = process.env.LITT_DEFAULT_PROVIDER as LittProviderName | undefined;
  if (env && isProviderAvailable(env)) return env;
  return getAvailableProviders().find(p => p !== "static") || "static";
}
