export type AIProvider = "ollama" | "openai" | "openrouter";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatWithOllama(messages: ChatMessage[], model = "llama3.2:3b") {
  const baseUrl = process.env.LIT_URL || process.env.NEXT_PUBLIC_LIT_URL || "http://localhost:11434";
  if (!baseUrl || baseUrl === "http://localhost:11434") {
    throw new Error("Ollama backend is not configured. Set LIT_URL to enable LiT.");
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

function demoResponse(messages: ChatMessage[]): string {
  const lastUser = messages
    .slice()
    .reverse()
    .find((m) => m.role === "user")?.content ?? "your request";
  const topic = lastUser.slice(0, 40).replace(/\n/g, " ");
  return `I’m running in **demo mode** right now because no AI API key is configured on the server.

I can’t generate a real answer for “${topic}…” yet, but the chat UI is fully functional.

**To make me work for free:**
1. Get a free Gemini key at [ai.google.dev](https://ai.google.dev) (Google AI Studio — generous free tier)
2. Or get a free OpenRouter key at [openrouter.ai](https://openrouter.ai)
3. Add it to your environment: 
   \`GEMINI_API_KEY=your_key\` or \`OPENROUTER_API_KEY=your_key\`
4. Redeploy, then I’ll answer for real.

Until then, you can still browse the marketplace, dashboard, and agents pages.`;
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
  const hasKey = Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      (process.env.LIT_URL && process.env.LIT_URL !== "http://localhost:11434"),
  );
  if (!hasKey) {
    return demoResponse(messages);
  }

  if (provider === "ollama") {
    return chatWithOllama(messages, model);
  }
  if (provider === "openrouter") {
    return chatWithOpenRouter(messages, model);
  }

  throw new Error(`Provider not implemented: ${provider}`);
}
