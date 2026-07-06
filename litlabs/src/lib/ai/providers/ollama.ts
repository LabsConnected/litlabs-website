/**
 * Ollama provider for LiTT.
 *
 * Local/private AI fallback. Runs against any Ollama server.
 */

import { ChatMessage } from "../litt-router";

export interface OllamaOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export async function chatWithOllama(
  messages: ChatMessage[],
  model = "qwen2.5-coder",
  opts: OllamaOptions = {},
): Promise<unknown> {
  const baseUrl = (opts.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");

  const timeoutMs = opts.timeoutMs || 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Ollama returned empty content.");
    }

    return JSON.parse(content);
  } finally {
    clearTimeout(timeoutId);
  }
}
