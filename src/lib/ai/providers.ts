export type AIProvider = "ollama" | "openai";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function chatWithOllama(messages: ChatMessage[], model = "llama3.2:3b") {
  const res = await fetch("http://localhost:11434/api/chat", {
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

  throw new Error(`Provider not implemented: ${provider}`);
}
