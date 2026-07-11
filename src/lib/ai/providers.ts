export type AIProvider = "ollama" | "openai" | "openrouter";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatWithOllama(messages: ChatMessage[], model = "llama3.2:3b") {
  const baseUrl = process.env.JARVIS_URL || process.env.NEXT_PUBLIC_JARVIS_URL || "http://localhost:11434";
  if (!baseUrl || baseUrl === "http://localhost:11434") {
    throw new Error("Ollama backend is not configured. Set JARVIS_URL to enable Jarvis.");
  }

  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
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
  return data.message?.content ?? "";
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
  return data.choices?.[0]?.message?.content ?? "";
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
