/**
 * Intent classification — how LiTT treats user input.
 *
 * Three intents:
 *   chat     — casual conversation, questions, greetings.
 *              Does NOT start a mission or progress bar.
 *   command  — slash commands (start with /).
 *   mission  — tasks that require tools/execution.
 *              Starts the full agent lifecycle with progress + steps.
 *
 * This is extracted from the controller so it can be unit-tested.
 */

export type Intent = "chat" | "command" | "mission";

export function classifyIntent(input: string): Intent {
  const lower = input.toLowerCase().trim();

  // Slash commands are commands, not chat or mission
  if (lower.startsWith("/")) return "command";

  // Short messages (under ~15 chars) are usually conversation
  if (lower.length < 15 && !lower.includes("fix") && !lower.includes("run") && !lower.includes("build")) {
    return "chat";
  }

  // Greetings / casual
  const casual = ["hi", "hello", "hey", "whats up", "what's up", "sup", "yo",
    "thanks", "thank you", "ok", "okay", "cool", "nice", "bye", "goodbye",
    "how are you", "who are you", "what are you", "what can you do",
    "help me", "what do you do"];
  if (casual.some(c => lower === c || lower.startsWith(c + " "))) {
    return "chat";
  }

  // Questions (not asking for action) are chat
  if (lower.endsWith("?") && !lower.includes("fix") && !lower.includes("run")
    && !lower.includes("build") && !lower.includes("test")) {
    return "chat";
  }

  // Mission triggers — words that imply action
  const missionTriggers = ["fix", "build", "test", "run", "deploy", "ship",
    "implement", "create", "add", "remove", "delete", "edit", "change",
    "refactor", "debug", "inspect", "analyze", "verify", "check", "install",
    "update", "upgrade", "migrate", "optimize", "find", "search", "replace",
    "write", "generate", "scaffold", "init", "setup", "configure"];
  if (missionTriggers.some(t => lower.includes(t))) {
    return "mission";
  }

  // Default: short questions are conversation, longer requests are missions
  return lower.length > 30 ? "mission" : "chat";
}
