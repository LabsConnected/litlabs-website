/**
 * OpenRouterModelProvider — a ModelProvider implementation that calls
 * OpenRouter's chat completions API.
 *
 * This is the bridge between the agent loop and the LLM. The agent loop
 * calls model.stream() with the conversation, and this provider streams
 * the response back via the emit callback.
 *
 * Environment:
 *   OPENROUTER_API_KEY — required for API calls
 *
 * If no API key is set, the provider throws on construction.
 * Callers should check hasApiKey() before constructing.
 */

import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ModelProfile,
} from "@litt/agent-core";

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";
const MODEL_BY_PROFILE: Record<ModelProfile, string> = {
  fast: "~google/gemini-flash-latest",
  smart: "anthropic/claude-sonnet-4.6",
  long: "anthropic/claude-sonnet-4.6",
  auto: "anthropic/claude-sonnet-4.6",
};

export interface OpenRouterModelOptions {
  apiKey?: string;
  model?: string;
  profile?: ModelProfile;
}

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export class OpenRouterModelProvider implements ModelProvider {
  private readonly _apiKey: string;
  private readonly _model: string;
  private readonly _profile: ModelProfile;

  constructor(options: OpenRouterModelOptions = {}) {
    this._apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    if (!this._apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouterModelProvider");
    }
    this._profile = options.profile ?? "smart";
    this._model = options.model ?? MODEL_BY_PROFILE[this._profile] ?? DEFAULT_MODEL;
  }

  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    // Emit meta
    emit({
      type: "meta",
      provider: "openrouter",
      model: this._model,
      profile: this._profile,
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this._apiKey}`,
        "HTTP-Referer": "https://litlabs.net",
        "X-Title": "LiTT CLI",
      },
      body: JSON.stringify({
        model: this._model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("OpenRouter returned no response body");
    }

    let content = "";
    let totalTokens = 0;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            emit({ type: "delta", text: delta.content });
          }
          if (parsed.usage?.total_tokens) {
            totalTokens = parsed.usage.total_tokens;
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    return {
      content,
      model: this._model,
      provider: "openrouter",
      usage: { total_tokens: totalTokens || Math.ceil(content.length / 4) },
      timing: { ttftMs: 0, generationMs: 0, totalMs: 0 },
      profile: this._profile,
    };
  }

  async health(): Promise<number> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${this._apiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok ? 1 : 0;
    } catch {
      return 0;
    }
  }
}
