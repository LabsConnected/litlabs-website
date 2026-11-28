/**
 * Intent classification — how LiTT treats user input.
 *
 * Four intents:
 *   chat     — casual conversation, questions, greetings, speech acts
 *              (say/reply/repeat/echo), and informational requests
 *              (explain/what does/...). Does NOT start a mission or
 *              progress bar.
 *   command  — slash commands (start with /).
 *   read     — bounded read-only project inspection queries answerable
 *              with canonical read-only tools (project.status, .branch,
 *              .inspect_package, .log, .diff). Does NOT start a full
 *              mission. May use one synthesis model call to format
 *              results.
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
 * READ vs CHAT:
 *   "what framework is this" → READ (answerable by project.inspect_package)
 *   "what is TypeScript" → CHAT (general knowledge, not project state)
 *   "what files changed" → READ (answerable by project.status)
 *   "what does npm run build do" → CHAT (info prefix, explanation)
 *
 * READ vs MISSION:
 *   "what files changed" → READ (bounded, one tool call)
 *   "scan this repo and tell me what needs attention" → MISSION (complex
 *   analysis, multi-step, needs agent loop)
 *
 * This is extracted from the controller so it can be unit-tested.
 */

export type Intent = "chat" | "command" | "read" | "mission";

/**
 * Words that imply action — used only AFTER speech/info acts are ruled
 * out. Matched as whole WORDS (see `hasMissionSignal`), never as a bare
 * substring — "change" must not match inside "changed"/"changes", or a
 * read-only "what changed" question gets hijacked into a mission.
 */
const MISSION_TRIGGERS = [
  "fix", "build", "test", "run", "deploy", "ship",
  "implement", "create", "add", "remove", "delete", "edit", "change",
  "refactor", "debug", "inspect", "analyze", "verify", "check", "install",
  "update", "upgrade", "migrate", "optimize", "find", "search", "replace",
  "write", "generate", "scaffold", "init", "setup", "configure",
  "scan", "audit", "diagnose",
];

/**
 * Multi-token mission idioms a single trigger WORD can't safely express.
 * "make these changes" mutates the project even though neither "make"
 * (far too generic on its own — "make it clearer", "make sense of this"
 * are ordinary chat) nor "changes" (plural, also the noun in read-only
 * "summarize the changes") is a safe standalone trigger word. Checked
 * at the same point as MISSION_TRIGGERS (see `hasMissionSignal`).
 */
const MISSION_PHRASES: RegExp[] = [
  /\bmake\s+(?:\w+\s+){0,2}changes?\b/,
  // Filesystem browsing — "list files in C:\", "show me files in
  // C:\Temp", "what files are on my C drive", "directories under /tmp".
  // None of "list"/"show"/"what" is safe as a bare MISSION_TRIGGERS word
  // (far too common in ordinary chat), but "files/folders/directories"
  // PLUS a location preposition is an unambiguous filesystem request —
  // this is bounded read-only inspection via real tools (list_dir/glob),
  // never a project-state READ query, so it must reach the agent loop.
  /\b(files|folders|directories)\b[\s\S]*\b(in|on|under|inside)\b/,
  // Bare drive/path mentions without the word "files" — "what's on my
  // C drive", "what's in C:\", "look at what's on the C drive".
  /\b(on|in)\s+(my\s+|the\s+)?[a-z]\s*:\\|\b[a-z]\s+drive\b/i,
];

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `phrase` (a word or short literal phrase) appears in `text` as a whole token/phrase — never as a bare substring of a longer word. */
function hasWord(text: string, phrase: string): boolean {
  return new RegExp(`\\b${escapeRegExp(phrase).replace(/\s+/g, "\\s+")}\\b`, "i").test(text);
}

/**
 * True if `text` carries a mission SIGNAL: a trigger word matched as a
 * whole word (not a substring — "changed" does not match "change"), or
 * one of the multi-token MISSION_PHRASES idioms.
 */
function hasMissionSignal(text: string): boolean {
  return MISSION_TRIGGERS.some((t) => hasWord(text, t))
    || MISSION_PHRASES.some((r) => r.test(text));
}

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
 * on/in-a-location filesystem phrasing for the INFO_PREFIXES carve-out —
 * narrower than MISSION_PHRASES' bare "c drive" noun match, which would
 * hijack definitional questions ("explain what the c drive is").
 */
const INFO_FS_LOCATION = new RegExp(
  "\\b(?:on|in|inside|under)\\s+(?:my\\s+|the\\s+|a\\s+)?[a-z]\\s*:\\\\" +
  "|\\b(?:on|in|inside|under)\\s+(?:my\\s+|the\\s+|a\\s+)?[a-z]\\s+drive\\b",
  "i",
);

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

  // Strip a leading politeness/modal wrapper ("can you ...", "please ...")
  // so the FIRST real verb determines the act, not the wrapper. Computed
  // up front so the short-message gate below can also consult READ
  // intent, not just mission signals.
  const core = stripLeadingWrapper(lower);

  // Short messages (under ~15 chars) are usually conversation, unless
  // they carry a strong action verb OR are themselves a bounded read
  // query ("what changed?" is 13 chars but must still route to READ,
  // not be swallowed here as chat).
  if (lower.length < 15 && !hasMissionSignal(lower) && !isReadIntent(lower, core)) {
    return "chat";
  }

  // Greetings / casual — but ONLY when the rest of the message carries
  // no action or read signal. A conversational preamble must not hijack
  // a real request: "nice can you search my c drive" starts with "nice"
  // but asks for a filesystem search (P0 — observed live: it classified
  // CHAT, went to a tool-less model, and the model claimed it couldn't
  // access the filesystem). "ok run the tests" is a mission wearing a
  // polite opener, not a greeting.
  const casual = [
    "hi", "hello", "hey", "whats up", "what's up", "sup", "yo",
    "thanks", "thank you", "ok", "okay", "cool", "nice", "bye", "goodbye",
    "how are you", "who are you", "what are you", "what can you do",
    "help me", "what do you do",
  ];
  if (
    casual.some((c) => lower === c || lower.startsWith(c + " ")) &&
    !hasMissionSignal(lower) &&
    !isReadIntent(lower, core)
  ) {
    return "chat";
  }

  // Response-only speech acts: "say ...", "reply with ...", "repeat ...".
  // The user wants the model to produce text, not execute tools — even if
  // the content to repeat contains mission words like "test" or "build".
  if (startsWithAct(core, SPEECH_ACT_PREFIXES)) {
    return "chat";
  }

  // Informational requests: "explain ...", "what does ... do", etc.
  // These ask for an explanation, not execution.
  if (startsWithAct(core, INFO_PREFIXES)) {
    // "explain what this project does" asks about THIS project's
    // identity — tool-answerable via real inspection, not general
    // knowledge. Without this, the model fabricates an ungrounded
    // answer from no evidence.
    if (isProjectExplain(core)) {
      return "read";
    }
    // Filesystem-location questions under an info wrapper are still tool
    // requests: "what is on my c drive" / "what is in C:\Temp" name a real
    // location — the model cannot answer them from memory (observed live:
    // routed CHAT → generic refusal). Only the on/in-location forms fire
    // here: "explain what the c drive is" is a definition question and
    // must stay CHAT.
    if (INFO_FS_LOCATION.test(lower)) {
      return "mission";
    }
    // Narrow carve-out: "summarize the changes" / "summarize what
    // changed" ask about THIS project's git state (tool-answerable),
    // not general knowledge — the same CHAT-vs-READ distinction already
    // applied to "what ..." queries below, reusing the same isReadIntent
    // machinery rather than a one-off string check. Every OTHER info
    // prefix (explain/define/describe/tell me about/...) stays CHAT
    // regardless of payload — "summarize the test results" is still
    // chat because it does not match any read pattern.
    if (!(core.startsWith("summarize ") && isReadIntent(lower, core))) {
      return "chat";
    }
  }

  // Project-self-reference explain with a non-info-prefix phrasing —
  // "walk me through this codebase", "give me an overview of my repo".
  // Same groundedness requirement: only inspection tools answer it.
  if (isProjectExplain(core)) {
    return "read";
  }

  // ─── READ intent — bounded read-only project inspection ───
  // Queries about the current project's state that can be answered with
  // canonical read-only tools (project.inspect_package, .status, .branch,
  // .log, .diff). These do NOT need a full mission lifecycle — just
  // bounded tool calls + optional synthesis.
  //
  // Key distinction from CHAT: "what framework is this" asks about THIS
  // project's framework (tool-answerable), while "what is TypeScript"
  // asks for general knowledge (model-only).
  //
  // Key distinction from MISSION: "what files changed" is a bounded
  // one-tool query, while "scan this repo and tell me what needs
  // attention" requires complex analysis and the full agent loop.
  if (isReadIntent(lower, core)) {
    return "read";
  }

  // Questions (not asking for action) are chat. Info-prefix questions are
  // already handled above; this catches remaining non-action questions
  // like "is the sky blue?". Search/find/locate verbs are excluded the
  // same way as build/test — "can you find package.json?" ends with "?"
  // but is a filesystem request, not conversation.
  if (
    lower.endsWith("?") &&
    !lower.includes("fix") && !lower.includes("run") &&
    !lower.includes("build") && !lower.includes("test") &&
    !lower.includes("find") && !lower.includes("search") &&
    !lower.includes("locate")
  ) {
    return "chat";
  }

  // Mission triggers — words that imply action. Only reached AFTER speech
  // acts and info requests are ruled out, so a mission word appearing
  // inside quoted repeat-content can no longer hijack a conversational
  // request. Matched as whole words/phrases (see hasMissionSignal), so
  // "changed"/"changes" never accidentally hijack a read-only request
  // via the "change" trigger.
  if (hasMissionSignal(lower)) {
    return "mission";
  }

  // Default: conversation. Length alone does NOT imply execution — a long
  // message without an action verb is still chat.
  return "chat";
}

// ─── READ intent detection ─────────────────────────────────────────

/**
 * Project-state nouns that signal a read-only inspection query.
 * When the query asks about these, it can be answered with canonical
 * read-only tools rather than going through the full model path.
 */
const READ_NOUNS = [
  "framework", "stack", "technology", "technologies",
  "package manager", "package-manager",
  "scripts", "npm scripts", "available scripts",
  "dependencies", "deps", "dev dependencies", "devdependencies",
  "packages",
  "files changed", "what changed", "changes", "diff",
  "recent commits", "commits", "git log", "log",
  "current branch", "branch",
  "project name", "project type", "project info",
  "node version", "node version",
  "typescript version",
  "build tool", "bundler",
];

/**
 * Leading patterns that indicate a read-only inspection query.
 * These are checked AFTER speech acts and info prefixes are ruled out,
 * so "explain what framework means" stays CHAT (info prefix) and
 * "say the word framework" stays CHAT (speech act).
 */
/**
 * A files/folders mention followed by an explicit NON-workspace location
 * ("files in C:\", "files on my D drive", "files under /tmp", "files in
 * src/auth"). Those stay MISSION — the location may sit outside the
 * project sandbox and needs the agent loop's authorization path. A
 * location that names the workspace itself ("in this directory", "in the
 * project", "in my workspace", "inside here") is NOT excluded: it means
 * the workspace root — a bounded project.list_files read.
 */
const NON_WORKSPACE_FILE_LOCATION = new RegExp(
  "\\b(?:files?|folders?|directories|directory)\\b[^.?!]*" +
  "\\b(?:in|inside|on|under|from)\\s+" +
  "(?!(?:this|the|my|that|current)\\s+(?:directory|folder|dir|project|repo|repository|workspace|codebase|cwd)\\b|here\\b)",
  "i",
);

const READ_PATTERNS: Array<{ test: (lower: string, core: string) => boolean }> = [
  // Git status is a bounded read-only inspection, even when phrased
  // imperatively with "check". Do not promote it to a mission merely
  // because "check" is also a generic mission trigger. "branch"/"state"
  // are the same evidence family — "show my current git branch and all
  // modified files" is a bounded read, not a model-driven mission.
  { test: (_l, c) => /^check\s+(the\s+|my\s+)?(current\s+)?git\s+(status|branch|state)\b/.test(c) },
  { test: (_l, c) => /^show\s+(me\s+)?(the\s+|my\s+)?(current\s+)?git\s+(status|branch|state)\b/.test(c) },
  // Git/working-tree queries that name a read noun without the exact
  // "git status" phrase — "what branch am i on", "show my branch",
  // "list modified files". A read verb + a git noun keeps it bounded;
  // mutation verbs (switch/checkout/merge) are absent by construction.
  { test: (_l, c) =>
      /^(?:show|what|get|check|tell me|list)\b[\s\S]*\b(?:branch|git status|modified|uncommitted)\b/.test(c)
      || /^current branch\b/.test(c) },
  // "what framework is this" / "what package manager does this use"
  { test: (_l, c) => /^what\s+(framework|stack|package manager|package-manager|scripts|dependencies|deps|packages|project name|project type|build tool|bundler|node version|typescript version)\b/.test(c) },
  // "what files changed" / "what changed"
  { test: (_l, c) => /^what\s+(files changed|changed|changes|diff)\b/.test(c) },
  // "show recent commits" / "show commits" / "show the diff" / "show
  // changes" / "show me what changed" / "show me the changes"
  { test: (_l, c) => /^show\s+(me\s+)?(what\s+changed|recent commits|commits|the diff|diff|changes|log|git log)\b/.test(c) },
  // "summarize the changes" / "summarize what changed" — an INFO prefix
  // ("summarize") whose subject is THIS project's git state, not general
  // knowledge. See the "summarize " carve-out in classifyIntent.
  { test: (_l, c) => /^summarize\s+(the\s+)?(changes|what changed|diff)\b/.test(c) },
  // "tell me the framework" / "tell me the branch" (NOT "tell me about X" — that's INFO)
  { test: (_l, c) => /^tell me\s+(the\s+)?(framework|stack|branch|current branch|package manager|scripts|dependencies|deps|project name|project type|diff|changes|commits|recent commits)\b/.test(c) },
  // "which package manager" / "which branch"
  { test: (_l, c) => /^which\s+(package manager|package-manager|branch|current branch|framework|stack)\b/.test(c) },
  // Compound: "tell me the framework and branch" / "what framework and branch"
  { test: (_l, c) => /\b(framework|stack)\b.*\b(branch|current branch)\b/.test(c) && /^(what|tell me|which|show)\b/.test(c) },
  // Compound: "show me the last 3 git commits and summarize what
  // changed" — a leading read verb ("show") plus BOTH a commit-history
  // signal and a changed/changes signal, anywhere in the sentence. Not
  // anchored immediately after the verb (unlike the patterns above)
  // because "show me the last 3 git commits ..." has words in between —
  // but still requires the leading verb so this stays a narrow git-log
  // template, not a generic "changed" matcher.
  { test: (_l, c) => /^show\b/.test(c) && /\bcommits?\b/.test(c) && /\b(changed|changes)\b/.test(c) },
  // ─── Workspace file listing — bounded, deterministic, no model ──────
  // "list 10 files" / "show my project files" / "what files are here" —
  // bounded read-only workspace queries answerable by project.list_files.
  // Without these, the request classified as CHAT and went to the model
  // with NO tools: a slow/weak local model produced no file listing
  // (the observed >120s stall) or fabricated one. Explicit locations
  // outside workspace nouns ("files in C:\") stay MISSION via
  // NON_WORKSPACE_FILE_LOCATION — they may escape the project sandbox.
  { test: (_l, c) =>
      /^(?:list|show)\s+(?:me\s+)?(?:the\s+|my\s+|all\s+|some\s+|first\s+|up\s+to\s+|around\s+|about\s+|\d+\s+|project\s+|workspace\s+|repo\s+|repository\s+)*files?\b/.test(c)
      && !NON_WORKSPACE_FILE_LOCATION.test(c) },
  { test: (_l, c) =>
      /^what\s+files?\b/.test(c)
      && !NON_WORKSPACE_FILE_LOCATION.test(c)
      && !/\b(?:changed|changes|modified|deleted|created|added|committed|contain(?:s|ing)?|matching|named|called)\b/.test(c) },
  // "what's inside this directory" / "what is in the project/workspace"
  { test: (_l, c) =>
      /^what'?s?\s+(?:inside|in)\s+(?:this|the|my|current)\s+(?:directory|folder|dir|project|repo|repository|workspace|codebase|cwd)\b/.test(c)
      || /^what\s+is\s+(?:inside|in)\s+(?:this|the|my|current)\s+(?:directory|folder|dir|project|repo|repository|workspace|codebase|cwd)\b/.test(c) },
  // "go through my files" — bounded workspace browse.
  { test: (_l, c) => /^go\s+through\s+(?:my\s+|the\s+)?files?\b/.test(c) },
  // "read package.json" / "cat config.ts" — bounded single-file read
  // via project.read_file. The token must look like a filename (has an
  // extension) so "read the logs"/"show me the diff" don't match.
  { test: (_l, c) =>
      /^(?:read|cat|print|show)\s+(?:me\s+)?(?:the\s+|my\s+|this\s+|file\s+)?["']?[\w./~-]+\.[a-z0-9]{1,10}["']?\b/i.test(c) },
];

/**
 * Determine if a query is a bounded read-only project inspection.
 * Returns true only when the query asks about project state answerable
 * with canonical read-only tools. Does NOT catch complex analysis
 * queries like "scan this repo" or "inspect this repo" — those are
 * MISSION (they need the full agent loop for multi-step analysis).
 */
function isReadIntent(lower: string, core: string): boolean {
  // Mission-complex words override READ — "inspect this repo" is MISSION
  // even though it might mention project-state nouns.
  if (/\b(inspect|scan|audit|analyze|diagnose|repair|fix|implement|refactor)\b/.test(lower)) {
    return false;
  }
  // Check explicit read patterns
  for (const { test } of READ_PATTERNS) {
    if (test(lower, core)) return true;
  }
  // "what <read-noun>" pattern — generic catch for project-state questions
  // that start with "what" and contain a read noun.
  if (core.startsWith("what ") && READ_NOUNS.some((n) => core.includes(n))) {
    // But NOT "what is/are/does/do" — those are INFO (chat).
    if (!/^what\s+(is|are|does|do|happened)\b/.test(core)) {
      return true;
    }
  }
  return false;
}

/**
 * Project-self-reference explanation: the query asks for an explanation
 * of THIS project's identity/structure ("explain what this project
 * does", "describe my repo", "walk me through this codebase", "what
 * does our app do"). Deliberately narrow — requires BOTH an info verb
 * AND an unambiguous self-reference (this/my/our + project noun) so
 * "explain the repository pattern" or "what does the app store
 * globally" stay CHAT/MISSION as before.
 *
 * Also requires NO mission signal: "scan this repo and tell me what
 * needs attention" or "inspect this project ... run typecheck" contain
 * a self-reference and an info verb in a subordinate clause, but their
 * primary demand is action — read-only inspection tools cannot answer
 * them. Those must reach the agent loop, not the READ lane.
 */
export function isProjectExplain(core: string): boolean {
  return /\b(?:this|my|our)\s+(?:project|repo|repository|codebase|code base|workspace|package|app|application|monorepo)\b/.test(core)
    && /\b(?:explain|describe|summarize|tell me about|tell me what|what does|what is|what do|walk me through|walk through|go through|overview)\b/.test(core)
    && !hasMissionSignal(core);
}
