/**
 * LiTT-Code CLI — engineering agent shell for LiTTree Lab Studios.
 *
 * Usage:
 *   litt-code              # REPL
 *   litt-code repl         # REPL
 *   litt-code chat "..."   # single prompt
 *   litt-code "..."        # single prompt (default)
 *   litt-code --help
 */

import { askLiTTCode, handleLiTTCodeCommand } from "../terminal-server/litt-code";

const DEFAULT_MODEL = process.env.LITT_CODE_MODEL || "google/gemini-2.5-flash";
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

type Args = {
  mode: "repl" | "chat";
  prompt?: string;
  model?: string;
  ollama?: boolean;
  help: boolean;
};

function printHelp() {
  console.log(`
LiTT-Code CLI
Usage:
  litt-code                  Start interactive REPL
  litt-code repl             Start interactive REPL
  litt-code chat "prompt"    Send a single prompt
  litt-code "prompt"         Send a single prompt
  litt-code /command [args]  Run a built-in command in REPL

Built-in commands:
  /help                     Show this help
  /scan                     Scan current workspace
  /fix                      Inspect project and suggest fixes
  /build                    Run build and explain errors
  /deploy                   Show deployment instructions
  /commit <message>         Generate git commit command
  /agent <name>             Explain how to create an agent
  /feature <name>           Explain how to add a feature
  /explain <command>        Explain a shell command
  /model <name>             Switch model (OpenRouter model id)
  /ollama                   Switch to local Ollama instead of OpenRouter
  /clear                    Clear the screen
  /exit, /quit              Exit REPL

Env:
  OPENROUTER_API_KEY        Required for cloud mode
  OLLAMA_BASE_URL           Optional local fallback/default (default: http://localhost:11434)
  LITT_CODE_MODEL           Default model (default: google/gemini-2.5-flash)
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "repl",
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];

    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    if (token === "repl") {
      args.mode = "repl";
      continue;
    }

    if (token === "chat") {
      args.mode = "chat";
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        args.prompt = next;
        i++;
      }
      continue;
    }

    if (token === "--model" && argv[i + 1]) {
      args.model = argv[i + 1];
      i++;
      continue;
    }

    if (token === "--ollama") {
      args.ollama = true;
      continue;
    }

    if (!args.prompt) {
      args.prompt = token;
    } else {
      args.prompt = `${args.prompt} ${token}`;
    }
  }

  return args;
}

async function callAI(prompt: string, model?: string): Promise<string> {
  const messages = [
    {
      role: "system" as const,
      content:
        "You are LiTT-Code, the engineering AI inside LiTTree Lab Studios. " +
        "Keep answers concise and actionable. Prefer commands over long prose. " +
        "For destructive ops, warn before recommending them.",
    },
    { role: "user" as const, content: prompt },
  ];

  const effectiveModel = model || DEFAULT_MODEL;

  try {
    const baseUrl = (process.env.OLLAMA_BASE_URL || OLLAMA_URL).replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: effectiveModel.replace(/^ollama:/, ""), messages, stream: false }),
    });

    if (!res.ok) {
      throw new Error(`Ollama failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() || "";
  } catch {
    return await askLiTTCode(prompt);
  }
}

async function handleInput(input: string): Promise<boolean> {
  const trimmed = input.trim();

  if (!trimmed) return true;

  if (trimmed === "/clear") {
    console.clear();
    return true;
  }

  if (trimmed === "/exit" || trimmed === "/quit") {
    return false;
  }

  if (trimmed === "/help" || trimmed === "?") {
    printHelp();
    return true;
  }

  if (trimmed.startsWith("/model ")) {
    const newModel = trimmed.slice("/model ".length).trim();
    if (!newModel) {
      console.log("Usage: /model <name>");
      return true;
    }
    process.env.LITT_CODE_MODEL = newModel;
    console.log(`Model updated to: ${newModel}`);
    return true;
  }

  if (trimmed === "/ollama") {
    delete process.env.LITT_CODE_MODEL;
    console.log("Switched to local Ollama.");
    return true;
  }

  if (trimmed.startsWith("/")) {
    const reply = await handleLiTTCodeCommand(trimmed);
    console.log(reply);
    return true;
  }

  console.log("LiTT-Code is thinking...");
  const reply = await callAI(trimmed);
  if (!reply) {
    console.log("(no response)");
  } else {
    console.log(reply);
  }

  return true;
}

async function runRepl() {
  console.log("LiTT-Code CLI");
  console.log("Type /help for commands, /exit to quit.\n");

  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "litt-code> ",
    terminal: true,
  });

  rl.prompt(true);

  rl.on("line", async (line: string) => {
    try {
      const keepGoing = await handleInput(line);
      if (!keepGoing) {
        rl.close();
        process.exit(0);
      }
    } catch (err) {
      console.log(`Error: ${err instanceof Error ? err.message : err}`);
    }

    rl.prompt(true);
  });

  rl.on("close", () => {
    console.log("\nBye.");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    rl.close();
  });
}

async function runChat(prompt: string, model?: string) {
  const reply = await callAI(prompt, model);
  if (!reply) {
    console.log("(no response)");
    process.exitCode = 1;
    return;
  }
  console.log(reply);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.mode === "repl" || !args.prompt) {
    await runRepl();
    return;
  }

  await runChat(args.prompt, args.model);
}

main().catch((err) => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
