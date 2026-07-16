export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

function resolveModelAndProvider(
  modelArg?: string
): { provider: "openrouter" | "ollama"; model: string } {
  const explicit = modelArg ?? process.env.LITT_CODE_MODEL;

  if (explicit?.startsWith("ollama:")) {
    return { provider: "ollama", model: explicit.slice("ollama:".length) };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: "openrouter",
      model: explicit?.replace(/^ollama:/, "") ?? "google/gemini-2.5-flash",
    };
  }

  // No API key configured — fail fast instead of hanging on Ollama
  throw new Error(
    "No LLM backend configured.\n" +
      "  Option 1 (cloud): set OPENROUTER_API_KEY\n" +
      "  Option 2 (local): set LITT_CODE_MODEL=ollama:llama3.2:3b and run `ollama serve`\n" +
      "  Option 3 (CLI flag):  litt-code --ollama \"<prompt>\""
  );
}

async function chatWithOllama(
  messages: ChatMessage[],
  model = "llama3.2:3b"
): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

async function chatWithOpenRouter(
  messages: ChatMessage[],
  model = "google/gemini-2.5-flash"
): Promise<string> {
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
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

export async function askLiTTCode(prompt: string, model?: string): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are LiTT-Code, the engineering AI for LiTTree Lab Studios. You help users build software. " +
        "When asked for commands, prefer safe, explainable commands. " +
        "Warn about destructive operations. Keep responses concise and actionable.",
    },
    { role: "user", content: prompt },
  ];

  const { provider, model: resolvedModel } = resolveModelAndProvider(model);

  if (provider === "ollama") {
    return chatWithOllama(messages, resolvedModel);
  }

  return chatWithOpenRouter(messages, resolvedModel);
}

export async function handleLiTTCodeCommand(input: string): Promise<string> {
  const args = input.trim().split(/\s+/).slice(1);
  const command = args[0]?.toLowerCase();
  const rest = args.slice(1).join(" ");

  const systemContext = `You are LiTT-Code inside LiTTree OS Terminal.
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
  // Pass through the explicit model so /ollama etc. resolve correctly
  return askLiTTCode(prompt, process.env.LITT_CODE_MODEL);
}
