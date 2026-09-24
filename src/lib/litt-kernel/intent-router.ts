/**
 * LiTT Intent Router
 *
 * Classifies a user message into an IntentClassification (mode, domains,
 * requirements) BEFORE the LLM is called. This is deterministic where
 * possible — regex + keyword matching. Ambiguous cases fall back to a
 * lightweight LLM call (not implemented in Phase 1; defaults to "think").
 *
 * The intent router enforces Principle 3 (Projects over chats): general
 * knowledge never requires a Project.
 *
 * See docs/litt/02-intent-router/classification.md
 */

import type { IntentClassification, LiTTMode } from "./types";

// ─── Mode detection patterns ────────────────────────────────────
// Ordered by specificity. First match wins.

interface ModePattern {
  mode: LiTTMode;
  patterns: RegExp[];
  requiresProject?: boolean;
  requiresExecution?: boolean;
  requiresCurrentInformation?: boolean;
  domains?: string[];
}

const MODE_PATTERNS: ModePattern[] = [
  // ─── status: system status questions ─────────────────────────
  {
    mode: "status",
    patterns: [
      // Bare "up" is NOT in this word list: modal + "up" also matches
      // phrasal launch verbs ("can you spin up a browser"), which must
      // reach the browser lane. "up" as a status word is covered by the
      // predicate pattern below instead.
      /\b(is|are|does|do|can|could|will|would)\b.*\b(working|connected|online|offline|available|ready|broken|down|status|configured|enabled|disabled)\b/i,
      // "up" only counts as a status word when it is the predicate —
      // "is the server up", "is it back up", "will it be up".
      /\b(is|are|was|were|be|being|still|back|come|comes|coming|stay|stays|staying)\b[^.!?]{0,30}\bup\b/i,
      /\b(voice|microphone|mic|tts|camera|terminal|github|deployment|supabase|stripe|vercel|cloudflare|browser)\b.*\b(working|connected|status|broken|down)\b/i,
      /\b(check|verify|test)\b.*\b(capabilit|connection|status|voice|terminal)\b/i,
    ],
    domains: ["platform"],
  },

  // ─── browser: live browser session control ───────────────────
  // Browser-control intent is execution, not chat: without this lane,
  // "open a live browser session" fell through to think mode →
  // requiresExecution:false → the V1 read-only loop, which has no
  // browser tools — the model then confabulated "browser sessions
  // aren't available." Placed after status (so "is the browser
  // working?" stays a status question) and before ship/build (a
  // passing "browser" mention inside a build request must stay build —
  // these patterns require the browser to be the action's target).
  {
    mode: "browser",
    patterns: [
      // Session lifecycle — browser is the object of a launch verb:
      // "open a live browser", "start a browser session",
      // "launch a browser and go to example.com", "spin up a browser".
      /\b(open|launch|start|spawn|spin\s*up|fire\s*up|boot|bring\s*up)\b[^.!?]{0,40}\bbrowser\b/i,
      // Explicit session/lane mentions: "browser.session.start",
      // "a browser session", "the live browser".
      /\bbrowser[._\s-]*session\b/i,
      /\b(live|remote|headless)\s+browser\b/i,
      // Control handoff: "take over the browser", "take control of the
      // browser", "let me drive the browser", "give control back",
      // "hand the browser over".
      /\b(take\s*over|take\s+control|let\s+me\s+(drive|take|control))\b[^.!?]{0,40}\bbrowser\b/i,
      /\bbrowser\b[^.!?]{0,30}\b(control|drive|take\s*over)\b/i,
      /\b(give|hand|return|pass)\b[^.!?]{0,20}\bcontrol\b/i,
      // Navigation through the browser: "go to X in the browser",
      // "navigate the browser to the preview", "browse this site for
      // me", "use the browser to check the dashboard". The gap classes
      // allow "." because navigation targets are usually URLs —
      // "go to https://example.com in the browser" must still match.
      /\b(go|navigate|visit|browse|surf|head)\b[^!?]{0,50}\bbrowser\b/i,
      /\bbrowser\b[^.!?]{0,30}\b(go\s*to|navigate|visit|open|drive)\b/i,
      /\buse\b[^.!?]{0,20}\bbrowser\b/i,
      /\bbrowse\b[^.!?]{0,40}\b(site|page|url|link|for\s+me)\b/i,
      /\b(open|visit|check|go\s*to|navigate\s*to|look\s*at|show\s+me|take\s+(me\s+)?to)\b[^!?]{0,60}\bin\s+the\s+browser\b/i,
    ],
    requiresProject: false,
    requiresExecution: true,
    domains: ["platform"],
  },

  // ─── ship: deployment, publishing, payments ──────────────────
  {
    mode: "ship",
    patterns: [
      /\b(deploy|deployment|publish|ship|release|go live|push to prod)\b/i,
      /\b(vercel|netlify|cloudflare pages|aws|gcp|azure)\b.*\b(deploy|publish)\b/i,
      /\b(pr|pull request|merge|release)\b/i,
    ],
    requiresProject: true,
    requiresExecution: true,
    domains: ["devops"],
  },

  // ─── build: implementation, file edits, code ─────────────────
  {
    mode: "build",
    patterns: [
      // Inspector-originated edits often name the UI target rather than a
      // source file. They are still real mutations and must enter the V2
      // structured-tool lane.
      /\b(change|edit|update|modify|rename|replace|delete|make|set)\b.*\b(selected|button|element|cta|label|visible text|text)\b/i,
      /\b(selected|button|element|cta)\b.*\b(change|edit|update|modify|rename|replace|delete|make|set)\b/i,
      /\b(implement|build|write|create|edit|update|fix|refactor|add|remove|delete|change)\b.*\b(file|component|function|code|api|route|page|endpoint|class|module|test|config|readme|package)\b/i,
      // Site/app artifacts. Without these, "build me a website" fell through
      // to `think` mode with requiresExecution:false, so the request reached
      // only the read-only loop — it could be discussed but never built.
      // Desire-driven artifact requests ("I want a landing page …", "I need
      // a website for …") express build intent without a leading imperative
      // verb. Without this they fell into `create`'s bare artifact-noun
      // pattern and took the text-only chat lane — the model echoed
      // tool-call markup that can never execute, and the run silently
      // completed with no file. The artifact list deliberately excludes
      // media nouns (image, logo, video, …) so generation requests stay in
      // `create`; it also excludes bare "site"/"store"/"shop" to avoid
      // catching "site visit" / "I want to shop".
      /\b(want|need|would like|looking for|get me|give me)\b.*\b(landing page|landing site|website|web ?site|web ?app|home ?page|web ?page|blog|portfolio|dashboard|app)\b/i,
      // "gimme" is colloquial "give me" — "gimme a portfolio site" is a build.
      // "extension" is a build artifact (browser/IDE extensions are
      // code) — "build a browser extension" must stay build, not
      // browser-session control.
      /\b(build|create|make|generate|scaffold|set up|gimme)\b.*\b(website|web ?site|web ?app|site|landing site|landing page|homepage|web page|webpage|blog|portfolio|store|shop|dashboard|app|extension)\b/i,
      // Question-form desire: "what about a landing page for my barbershop?"
      // has no build verb, so it fell through to create's bare artifact-noun
      // pattern — a chat reply, nothing built.
      /\b(what about|how about|can we|let's)\b.*\b(landing page|website|web ?site|blog|portfolio|dashboard|app)\b/i,
      // Follow-up continuations: "now add a contact section". The leading
      // temporal word hijacked these into research ("now"); match the verb
      // pair first so they enter the execution lane.
      /\b(now|then|also|next)\s+(add|build|create|make|edit|update|fix|remove|delete|change)\b/i,
      // Terse imperatives: "landing page. puppet master theme. go."
      // Site-artifact noun (never media nouns: image/logo/video) + imperative
      // cue. Note: a [^.] gap cannot work here — the example itself has a
      // period right after the artifact noun. "do it"/"build it"/"make it"
      // may appear anywhere within ~60 chars; the weak bare "go" cue only
      // counts sentence-final (mid-sentence "go" over-matches chat like
      // "You should go see it").
      /\b(landing page|website|web ?site|web ?app|home ?page|blog|portfolio|dashboard|app)\b.{0,60}\b(do it|build it|make it)\b/i,
      /\b(landing page|website|web ?site|web ?app|home ?page|blog|portfolio|dashboard|app)\b[\s\S]{0,80}[.!?]\s*go[.!]?\s*$/i,
      // Media added to an existing target: "add images ... to my project".
      // The project/site target keeps this in the execution lane; a bare
      // "make me a logo" (no project target) still falls through to create.
      /\b(add|upload|generate)\b.*\b(images?|photos?|pictures?|media|gallery)\b.*\b(project|site|website|page|section)\b/i,
      /\b(add|implement|support)\b.*\b(dark mode|feature|endpoint|route|page)\b/i,
      /\b(fix|debug|resolve|patch)\b.*\b(bug|error|issue|crash|fail)\b/i,
      /\b(edit|update|change|modify|rename|delete)\b.*\b(file|readme|config|code|component)\b/i,
      // Existing product edits often describe the user-facing target rather
      // than naming a source file. They still require the executable V2 lane;
      // routing them to text-only chat silently drops the requested mutation.
      // redesign/revamp/restyle/overhaul and fix/repair are the same family:
      // "redesign my homepage", "fix the header on my site" are mutations.
      /\b(edit|update|change|modify|rename|replace|delete|redesign|revamp|restyle|overhaul|fix|repair)\b.*\b(site|website|web ?app|homepage|landing page|footer|header|nav|menu|section)\b/i,
      // Placement commands use everyday verbs rather than edit-vocabulary —
      // "put this image on my homepage", "add that picture to the hero",
      // "insert the image into this page". Without this they fell into
      // `create` (or `research` when a leading "Now…" matched the recency
      // word list) and reached the text-only lane, where the model answered
      // "I have no tool access" and no mutation ever ran.
      /\b(put|add|place|insert|use|include|show|display|set)\b.*\b(site|website|web ?app|homepage|home ?page|landing ?page|web ?page|page|hero|section|header|footer|nav|menu)\b/i,
      /\b(run|execute)\b.*\b(tests?|builds?|lint|commands?|scripts?)\b/i,
    ],
    requiresProject: true,
    requiresExecution: true,
    domains: ["engineering"],
  },

  // ─── review: audits, reviews, security ───────────────────────
  {
    mode: "review",
    patterns: [
      /\b(audit|review|check|analyze|inspect|assess)\b.*\b(security|accessibility|performance|seo|code|quality|compliance|vulnerab)\b/i,
      /\b(code review|pr review|security review|a11y audit)\b/i,
      /\b(lighthouse|wcag|owasp|cve)\b/i,
    ],
    requiresProject: true,
    requiresExecution: true,
    domains: ["accessibility", "security"],
  },

  // ─── research: current information, comparison, investigation ─
  {
    mode: "research",
    patterns: [
      /\b(compare|latest|current|recent|today|now|price|cost|news|update|trend|forecast|market)\b/i,
      /\b(what.*cost|how much|price of|stock price|exchange rate)\b/i,
      /\b(research|investigate|find out|look up|search for)\b/i,
      /\b(who is winning|which is better|vs|versus)\b/i,
    ],
    requiresCurrentInformation: true,
    domains: ["commerce", "current_events"],
  },

  // ─── create: design, generate, produce ───────────────────────
  {
    mode: "create",
    patterns: [
      /\b(design|create|generate|make|produce|draft|sketch|mockup|wireframe|prototype)\b/i,
      /\b(landing page|homepage|logo|brand|image|video|audio|music|art|graphic|poster|banner)\b/i,
      /\b(make notes|create a checklist|open in canvas|add to canvas|add to requirements)\b/i,
      /\b(write|draft)\b.*\b(blog|article|essay|email|tweet|post|copy|content|story|script)\b/i,
    ],
    domains: ["design", "creative"],
  },

  // ─── learn: explanations, teaching, concepts ─────────────────
  {
    mode: "learn",
    patterns: [
      /\b(explain|what is|what are|how does|why does|why is|teach|learn|understand|concept|definition|meaning)\b/i,
      /\b(difference between|vs|versus)\b/i,
      /\b(tutorial|guide|lesson|example|analogy)\b/i,
    ],
    domains: ["education"],
  },

  // ─── think: reasoning, analysis, planning (default) ──────────
  {
    mode: "think",
    patterns: [
      /\b(think|analyze|plan|strategy|brainstorm|idea|consider|evaluate|assess|estimate)\b/i,
      /\b(what if|should i|would it|could we|pros and cons|trade-?off)\b/i,
    ],
    domains: ["reasoning"],
  },
];

// ─── Domain inference ───────────────────────────────────────────

const DOMAIN_KEYWORDS: Record<string, RegExp[]> = {
  physics: [/\b(physics|quantum|relativity|black hole|gravity|thermodynamic|particle|wave|energy|force)\b/i],
  engineering: [/\b(code|program|software|api|database|frontend|backend|react|next|typescript|javascript|python|rust|go)\b/i],
  design: [/\b(design|ui|ux|layout|color|typography|wireframe|figma|sketch|brand|logo)\b/i],
  devops: [/\b(deploy|ci|cd|pipeline|docker|kubernetes|vercel|netlify|aws|gcp|azure|infra)\b/i],
  commerce: [/\b(price|cost|market|stock|revenue|profit|business|sales|customer)\b/i],
  accessibility: [/\b(accessib|a11y|wcag|screen reader|aria|semantic|keyboard|contrast)\b/i],
  security: [/\b(security|vulnerab|cve|owasp|xss|csrf|injection|auth|crypto)\b/i],
  creative: [/\b(write|story|poem|script|video|audio|music|art|brand|content)\b/i],
  education: [/\b(learn|teach|explain|tutorial|lesson|course|quiz|analogy)\b/i],
  current_events: [/\b(news|today|this week|latest|recent|happening|breaking)\b/i],
  notes: [/\b(note|notes|checklist|requirement|requirements|summary|minutes|agenda)\b/i],
  planning: [/\b(plan|roadmap|timeline|milestone|schedule|priority|backlog|sprint)\b/i],
  platform: [/\b(voice|microphone|tts|camera|terminal|github|supabase|stripe|vercel|cloudflare|browser)\b/i],
  reasoning: [/\b(reason|logic|argument|premise|conclusion|deduc|induc|infer)\b/i],
};

function inferDomains(message: string): string[] {
  const domains: string[] = [];
  for (const [domain, patterns] of Object.entries(DOMAIN_KEYWORDS)) {
    if (patterns.some((p) => p.test(message))) {
      domains.push(domain);
    }
  }
  return domains;
}

// ─── Private data detection ─────────────────────────────────────

const PRIVATE_DATA_PATTERNS = [
  /\b(my|mine|our|we|i am|i have|i need|i want)\b.*\b(project|file|code|app|site|page|repository|repo|account|wallet|payment|invoice|subscription)\b/i,
  /\b(show me|what.*do i have|list my|my projects|my files|my account)\b/i,
];

// ─── Anaphoric follow-up detection ─────────────────────────────
// "build it", "do that thing again but lime" — the user refers to prior
// context instead of naming a target. Flag these so callers with a project
// in context can ask a targeted clarification instead of dumping a generic
// chat reply. Only messages with NO artifact noun qualify (a named target
// is unambiguous even alongside "that").
const SITE_ARTIFACT_NOUN =
  /\b(landing page|website|web ?site|web ?app|home ?page|blog|portfolio|dashboard|app|button|element|cta|header|footer|nav|menu|section|file|component|function|code|api|route|endpoint|image|logo|video)\b/i;
const ANAPHORIC_WORD = /\b(it|that|those|these|again)\b/i;

// ─── Main classifier ────────────────────────────────────────────

/**
 * Classifies a user message into an IntentClassification.
 *
 * This is deterministic (no LLM call) in Phase 1. The blueprint allows
 * a lightweight LLM fallback for ambiguous cases, but that comes later.
 *
 * @param opts.hasProject - whether the request already has project context
 *   (passed through from the Kernel). Used to annotate anaphoric follow-ups.
 */
export function classifyIntent(
  message: string,
  opts?: { hasProject?: boolean },
): IntentClassification {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      mode: "think",
      domains: [],
      requiresProject: false,
      requiresCurrentInformation: false,
      requiresPrivateData: false,
      requiresExecution: false,
      confidence: 0.3,
      reasoning: "Empty message — defaulting to think mode.",
      anaphoricFollowUp: false,
    };
  }

  // Find first matching mode pattern
  let matchedMode: LiTTMode = "think";
  let matchedPattern: ModePattern | null = null;
  for (const pattern of MODE_PATTERNS) {
    if (pattern.patterns.some((p) => p.test(trimmed))) {
      matchedMode = pattern.mode;
      matchedPattern = pattern;
      break;
    }
  }

  // Infer domains from message + mode defaults
  const inferredDomains = inferDomains(trimmed);
  const modeDomains = matchedPattern?.domains ?? [];
  const domains = Array.from(new Set([...inferredDomains, ...modeDomains]));

  // Detect private data
  const requiresPrivateData = PRIVATE_DATA_PATTERNS.some((p) => p.test(trimmed));

  // If private data is required and mode is think/learn, upgrade to research
  // (the user wants info about their own stuff)
  const requiresProject = matchedPattern?.requiresProject ?? false;
  const requiresExecution = matchedPattern?.requiresExecution ?? false;
  const requiresCurrentInformation = matchedPattern?.requiresCurrentInformation ?? false;

  // Confidence: high when a pattern matched explicitly, lower for default
  const confidence = matchedPattern ? 0.85 : 0.5;
  const reasoning = matchedPattern
    ? `Matched ${matchedMode} mode pattern. Domains: ${domains.join(", ") || "none"}.`
    : `No explicit pattern matched — defaulting to think mode. Domains: ${domains.join(", ") || "none"}.`;

  // Anaphoric follow-up marker (see detection block above).
  const anaphoricFollowUp =
    !SITE_ARTIFACT_NOUN.test(trimmed) && ANAPHORIC_WORD.test(trimmed);

  return {
    mode: matchedMode,
    domains,
    requiresProject,
    requiresCurrentInformation,
    requiresPrivateData,
    requiresExecution,
    confidence,
    reasoning: anaphoricFollowUp
      ? `${reasoning} Anaphoric follow-up (no artifact noun)${opts?.hasProject ? " with project context — caller should clarify the target." : "."}`
      : reasoning,
    anaphoricFollowUp,
  };
}
