/**
 * OpenRouter provider for LiTT.
 *
 * Primary AI gateway: one key, many models, structured JSON output.
 */

import { ChatMessage } from "../litt-router";
import { SITE_URL } from "@/lib/siteConfig";

export interface OpenRouterOptions {
  /** Request a JSON-object response. */
  jsonMode?: boolean;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Optional JSON schema for structured outputs. */
  jsonSchema?: Record<string, unknown>;
}

export async function chatWithOpenRouter(
  messages: ChatMessage[],
  model = "openrouter/auto",
  opts: OpenRouterOptions = {},
): Promise<unknown> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const body: Record<string, unknown> = {
    model,
    messages,
  };

  if (opts.jsonMode) {
    if (opts.jsonSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: opts.jsonSchema,
      };
    } else {
      body.response_format = { type: "json_object" };
    }
  }

  const timeoutMs = opts.timeoutMs || 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || SITE_URL || "https://litlabs.net",
        "X-Title": "LiTTree Lab Studios",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("OpenRouter returned empty content.");
    }

    if (opts.jsonMode) {
      return JSON.parse(content);
    }
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}
