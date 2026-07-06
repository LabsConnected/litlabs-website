/**
 * Groq provider for LiTT.
 *
 * Fast, snappy mascot replies via the OpenAI-compatible Groq API.
 */

import { ChatMessage } from "../litt-router";

export interface GroqOptions {
  jsonMode?: boolean;
  timeoutMs?: number;
}

export async function chatWithGroq(
  messages: ChatMessage[],
  model = "llama3-8b-8192",
  opts: GroqOptions = {},
): Promise<unknown> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not configured.");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (opts.jsonMode) {
    body.response_format = { type: "json_object" };
  }

  const timeoutMs = opts.timeoutMs || 15_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Groq ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Groq returned empty content.");
    }

    if (opts.jsonMode) {
      return JSON.parse(content);
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}
