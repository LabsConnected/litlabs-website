/**
 * Intent classification — how LiTT treats user input.
 *
 * Three intents:
 *   chat     — casual conversation, questions, greetings, speech acts
 *              (say/reply/repeat/echo), and informational requests
 *              (explain/what does/...). Does NOT start a mission or
 *              progress bar.
 *   command  — slash commands (start with /).
 *   mission  — tasks that require tools/execution.
 *              Starts the full agent lifecycle with progress + steps.
 *
 * CRITICAL BOUNDARY (P0):
 *   A mission word ("test", "build", "run", ...) appearing inside
 *   quoted/repeated/explained CONTENT must NOT turn a conversational
 *   request into a mission. "Say exactly: LiTT model test successful"
 *   is a CHAT speech act, not a mission — even though it contains
 *   "test". The classifier distinguishes USER INTENT (the leading
 *   speech act / info verb) from words appearing in the payload.
 *
 * This is extracted from the controller so it can be unit-tested.
 */

export type Intent = "chat" | "command" | "mission";

/** Words that imply action — used only AFTER speech/info acts are ruled out. */
const MISSION_TRIGGERS = [
  "fix", "build", "test", "run", "deploy", "ship",
  "implement", "create", "add", "remove", "delete", "edit", "change",
  "refactor", "debug", "inspect", "analyze", "verify", "check", "install",
  "update", "upgrade", "migrate", "optimize", "find", "search", "replace",
  "write", "generate", "scaffold", "init", "setup", "configure",
  "scan", "audit", "diagnose",
];

/**
 * Response-only speech acts. The user wants the model to PRODUCE TEXT,
 * not execute tools. The content to repeat may contain mission words
 * ("test", "build", "run") but the act itself is conversational.
 * Detected on the leading verb of the request (after politeness wrap
 * is stripped), never via substring search.
 */
const SPEECH_ACT_PREFIXES = [
  "say", "say exactly",
  "reply", "reply with",
  "respond", "respond with",
  "repeat",
  "echo",
  "answer", "answer with",
];

/**
 * Informational starters. The user wants an explanation, not execution.
 * "Explain what npm run build does" and "What does pnpm test do?" are
 * CHAT even though they contain "build"/"test".
 */
const INFO_PREFIXES = [
  "explain",
  "what is", "what are", "what does", "what do", "what happened",
  "how does", "how do", "how to",
  "why is", "why does", "why do",
  "tell me about",
  "define",
  "summarize",
  "describe",
];

/**
 * Leading politeness/modal wrappers. Stripped before detecting the
 * speech act / info verb so "can you explain ..." is treated like
 * "explain ...". Action verbs after a wrapper still count as missions
 * ("can you fix the test?" → mission).
 */
const LEADING_WRAPPERS = [
  "can you", "could you", "would you", "will you",
  "please", "kindly",
  "i want you to", "i need you to",
];

/** Strip a single leading politeness/modal wrapper, if present. */
function stripLeadingWrapper(lower: string): string {
  for (const w of LEADING_WRAPPERS) {
    if (lower.startsWith(w + " ")) {
      return lower.slice(w.length + 1).trim();
    }
  }
  return lower;
}

/**
 * True if `lower` starts with one of the given act prefixes.
 * Matches the bare prefix, a prefix followed by a space, or a prefix
 * followed by ":" (e.g. "say exactly:", "repeat:").
 */
function startsWithAct(lower: string, prefixes: string[]): boolean {
  for (const p of prefixes) {
    if (lower === p) return true;
    if (lower.startsWith(p + " ")) return true;
    if (lower.startsWith(p + ":")) return true;
  }
  return false;
}

export function classifyIntent(input: string): Intent {
  const lower = input.toLowerCase().trim();

  // Slash commands are commands, not chat or mission
  if (lower.startsWith("/")) return "command";

  // Short messages (under ~15 chars) are usually conversation,
  // unless they carry a strong action verb.
  if (lower.length < 15 && !MISSION_TRIGGERS.some((t) => lower.includes(t))) {
    return "chat";
  }

  // Greetings / casual
  const casual = [
    "hi", "hello", "hey", "whats up", "what's up", "sup", "yo",
    "thanks", "thank you", "ok", "okay", "cool", "nice", "bye", "goodbye",
    "how are you", "who are you", "what are you", "what can you do",
    "help me", "what do you do",
  ];
  if (casual.some((c) => lower === c || lower.startsWith(c + " "))) {
    return "chat";
  }

  // Strip a leading politeness/modal wrapper ("can you ...", "please ...")
  // so the FIRST real verb determines the act, not the wrapper.
  const core = stripLeadingWrapper(lower);

  // Response-only speech acts: "say ...", "reply with ...", "repeat ...".
  // The user wants the model to produce text, not execute tools — even if
  // the content to repeat contains mission words like "test" or "build".
  if (startsWithAct(core, SPEECH_ACT_PREFIXES)) {
    return "chat";
  }

  // Informational requests: "explain ...", "what does ... do", etc.
  // These ask for an explanation, not execution.
  if (startsWithAct(core, INFO_PREFIXES)) {
    return "chat";
  }

  // Questions (not asking for action) are chat. Info-prefix questions are
  // already handled above; this catches remaining non-action questions
  // like "is the sky blue?".
  if (
    lower.endsWith("?") &&
    !lower.includes("fix") && !lower.includes("run") &&
    !lower.includes("build") && !lower.includes("test")
  ) {
    return "chat";
  }

  // Mission triggers — words that imply action. Only reached AFTER speech
  // acts and info requests are ruled out, so a mission word appearing
  // inside quoted repeat-content can no longer hijack a conversational
  // request.
  if (MISSION_TRIGGERS.some((t) => lower.includes(t))) {
    return "mission";
  }

  // Default: conversation. Length alone does NOT imply execution — a long
  // message without an action verb is still chat.
  return "chat";
}
