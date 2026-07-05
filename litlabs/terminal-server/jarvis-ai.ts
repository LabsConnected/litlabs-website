export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function chatWithOllama(messages: ChatMessage[], model = "llama3.2:3b") {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

async function chatWithOpenRouter(messages: ChatMessage[], model = "google/gemini-2.5-flash") {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://litlabs.net",
    },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`OpenRouter failed: ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function askLiT(prompt: string) {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are LiT, the AI builder agent for LiTTree LabStudios. You help users build software. " +
        "When asked for commands, prefer safe, explainable commands. " +
        "Warn about destructive operations. Keep responses concise and actionable.",
    },
    { role: "user", content: prompt },
  ];

  try {
    return await chatWithOllama(messages);
  } catch {
    return await chatWithOpenRouter(messages);
  }
}

export async function handleLiTCommand(input: string): Promise<string> {
  const args = input.trim().split(/\s+/).slice(1);
  const command = args[0]?.toLowerCase();
  const rest = args.slice(1).join(" ");

  const systemContext = `You are the LiT agent inside LiTTree OS Terminal.
The user typed: ${input}

Available commands:
- scan: scan the current workspace and explain what it contains
- fix: look at the project and suggest fixes
- build: run the build and explain any errors
- deploy: give deployment instructions
- commit <message>: generate a git commit command
- create-agent <name>: explain how to create an agent
- add-feature <name>: explain how to add a feature
- explain <command>: explain a shell command

Be concise. If the command is unclear, list the available commands.
`;

  const prompt = `${systemContext}\n\nCommand: ${command || "help"}\nArguments: ${rest || "none"}`;
  return await askLiT(prompt);
}
