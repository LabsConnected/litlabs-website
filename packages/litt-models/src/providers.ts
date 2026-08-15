/**
 * Provider definitions + source-truth helpers.
 *
 * A provider is the company/runtime that serves a model. OpenRouter is a
 * meta-provider: if only OPENROUTER_API_KEY is set, models from Anthropic,
 * OpenAI, Google, etc. are served BY OpenRouter, not their native provider.
 * This file encodes that mapping so the registry can report SOURCE TRUTH.
 */

import type { CredentialInfo, CredentialResolver, CredentialSource, ProviderId } from "./types";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  /** Primary env var that holds a direct API key (BYOK or LiTT-managed). */
  envKey?: string;
  /**
   * Alternative env vars that also grant access. OpenRouter covers many
   * families, so most providers list OPENROUTER_API_KEY as an alt.
   */
  altEnvKeys?: string[];
  /** Base URL for health checks / model discovery. */
  modelsUrl?: string;
  /** Base URL for chat completions (OpenAI-compatible providers). */
  chatUrl?: string;
}

/**
 * The known providers. Order matters for stable fallback chains.
 */
export const PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
    modelsUrl: "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
    chatUrl: "https://api.anthropic.com/v1/messages",
  },
  {
    id: "google",
    label: "Google",
    envKey: "GEMINI_API_KEY",
    altEnvKeys: ["GOOGLE_API_KEY", "OPENROUTER_API_KEY"],
    modelsUrl: "https://generativelanguage.googleapis.com/v1beta/models",
  },
  {
    id: "xai",
    label: "xAI",
    envKey: "XAI_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
    chatUrl: "https://api.x.ai/v1/chat/completions",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEPSEEK_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
    chatUrl: "https://api.deepseek.com/chat/completions",
  },
  {
    id: "kimi",
    label: "Kimi",
    envKey: "MOONSHOT_API_KEY",
    altEnvKeys: ["KIMI_API_KEY", "OPENROUTER_API_KEY"],
    chatUrl: "https://api.moonshot.cn/v1/chat/completions",
  },
  {
    id: "mistral",
    label: "Mistral",
    envKey: "MISTRAL_API_KEY",
    altEnvKeys: ["OPENROUTER_API_KEY"],
    chatUrl: "https://api.mistral.ai/v1/chat/completions",
  },
  {
    id: "qwen",
    label: "Qwen",
    envKey: "DASHSCOPE_API_KEY",
    altEnvKeys: ["QWEN_API_KEY", "OPENROUTER_API_KEY"],
    chatUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    chatUrl: "https://openrouter.ai/api/v1/chat/completions",
  },
  {
    id: "ollama",
    label: "Ollama",
    modelsUrl: "http://localhost:11434/api/tags",
    chatUrl: "http://localhost:11434/api/chat",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    modelsUrl: "http://localhost:1234/v1/models",
    chatUrl: "http://localhost:1234/v1/chat/completions",
  },
];

const PROVIDER_BY_ID = new Map<ProviderId, ProviderDefinition>(
  PROVIDERS.map((p) => [p.id, p]),
);

export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return PROVIDER_BY_ID.get(id);
}

/**
 * Build a CredentialResolver from a generic env getter.
 * The consumer passes a function that returns the value of an env var (or
 * undefined). This keeps the package env-agnostic: the web app passes
 * `(k) => process.env[k]`, tests pass a literal map.
 *
 * Source truth: if a direct key is set, servedBy === provider. If only an
 * alt key (OpenRouter) is set, servedBy === "openrouter" (or the alt's
 * provider). Local providers (ollama/lmstudio) are always local-sourced.
 */
export function createEnvCredentialResolver(
  getEnv: (key: string) => string | undefined,
): CredentialResolver {
  return (provider: ProviderId): CredentialInfo => {
    const def = getProvider(provider);
    if (!def) {
      return { hasCredential: false, source: "free", servedBy: provider };
    }

    if (provider === "ollama" || provider === "lmstudio") {
      return { hasCredential: true, source: "local", servedBy: provider };
    }

    // Direct key → provider serves directly
    if (def.envKey && getEnv(def.envKey)) {
      const source: CredentialSource = inferSource(def.envKey);
      return { hasCredential: true, source, servedBy: provider };
    }

    // Alt keys (e.g. OpenRouter covers this family)
    if (def.altEnvKeys) {
      for (const altKey of def.altEnvKeys) {
        if (getEnv(altKey)) {
          return {
            hasCredential: true,
            source: inferSource(altKey),
            servedBy: altKeyToProvider(altKey),
          };
        }
      }
    }

    return { hasCredential: false, source: "free", servedBy: provider };
  };
}

/**
 * Heuristic: env vars named *_MANAGED_KEY or a LiTT-managed convention resolve
 * to "litt-managed"; everything else with a real key is "byok". OpenRouter
 * keys are byok (the user pays OpenRouter) unless a managed convention is used.
 */
function inferSource(envKey: string): CredentialSource {
  const upper = envKey.toUpperCase();
  if (upper.endsWith("_MANAGED_KEY") || upper.startsWith("LITT_")) return "litt-managed";
  if (upper === "OPENROUTER_API_KEY") return "byok";
  return "byok";
}

function altKeyToProvider(altKey: string): ProviderId {
  const upper = altKey.toUpperCase();
  if (upper === "OPENROUTER_API_KEY") return "openrouter";
  if (upper === "GOOGLE_API_KEY" || upper === "GEMINI_API_KEY") return "google";
  // Fall back to openrouter as the generic meta-provider
  return "openrouter";
}
