import { resolveOllamaEndpoint } from "@litt/models";

export type AIProvider = "ollama" | "openai" | "openrouter";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatWithOllama(messages: ChatMessage[], model = "llama3.2:3b") {
  const baseUrl = resolveOllamaEndpoint((key) => process.env[key]);
  if (!baseUrl) throw new Error("Ollama backend is not configured. Set LITT_OLLAMA_URL or OLLAMA_HOST to enable LiTT.");

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
  const data = await res.json();
  const content: unknown = data.message?.content;
  // An empty completion is a provider failure, not a successful reply:
  // throwing lets the callers' catch-fallback try the next provider
  // instead of surfacing "" as the answer.
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("Ollama returned an empty response.");
  }
  return content;
}

export async function chatWithOpenRouter(messages: ChatMessage[], model = "google/gemini-2.5-flash") {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured.");
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter failed: ${res.status}`);
  const data = await res.json();
  const content: unknown = data.choices?.[0]?.message?.content;
  // Same rule as Ollama: an empty completion is a provider failure, so
  // callers fall back or surface an error instead of an empty "reply".
  if (typeof content !== "string" || content.trim() === "") {
    throw new Error("OpenRouter returned an empty response.");
  }
  return content;
}

export async function runAI({
  provider = "ollama",
  model = "llama3.2:3b",
  messages,
}: {
  provider?: AIProvider;
  model?: string;
  messages: ChatMessage[];
}) {
  if (provider === "ollama") {
    return chatWithOllama(messages, model);
  }
  if (provider === "openrouter") {
    return chatWithOpenRouter(messages, model);
  }

  throw new Error(`Provider not implemented: ${provider}`);
}