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
      /\b(is|are|does|do|can|could|will|would)\b.*\b(working|connected|online|offline|available|ready|broken|down|up|status|configured|enabled|disabled)\b/i,
      /\b(voice|microphone|mic|tts|camera|terminal|github|deployment|supabase|stripe|vercel|cloudflare)\b.*\b(working|connected|status|broken|down)\b/i,
      /\b(check|verify|test)\b.*\b(capabilit|connection|status|voice|terminal)\b/i,
    ],
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
      /\b(implement|build|write|create|edit|update|fix|refactor|add|remove|delete|change)\b.*\b(file|component|function|code|api|route|page|endpoint|class|module|test|config|readme|package)\b/i,
      /\b(add|implement|support)\b.*\b(dark mode|feature|endpoint|route|page)\b/i,
      /\b(fix|debug|resolve|patch)\b.*\b(bug|error|issue|crash|fail)\b/i,
      /\b(edit|update|change|modify|rename|delete)\b.*\b(file|readme|config|code|component)\b/i,
      /\b(run|execute)\b.*\b(test|build|lint|command|script)\b/i,
    ],
    requiresProject: true,
    requiresExecution: true,
    domains: ["engineering"],
  },

  // ─── review: audits, reviews, security, project assessment ────
  {
    mode: "review",
    patterns: [
      /\b(audit|review|check|analyze|inspect|assess)\b.*\b(security|accessibility|performance|seo|code|quality|compliance|vulnerab)\b/i,
      /\b(code review|pr review|security review|a11y audit)\b/i,
      /\b(lighthouse|wcag|owasp|cve)\b/i,
      /\b(what.*should i.*(get done|do|fix|work on)|what.*needs.*(fix|done|work)|what.*highly.*needed|what.*should.*be.*done|prioriti[sz]e.*work|what.*important.*right now)\b/i,
      /\bwhat.*(needs|need).*fix/i,
      /\bwhat.*(should|must).*i.*(do|fix|work|tackle|prioriti[sz]e)/i,
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

// ─── Main classifier ────────────────────────────────────────────

/**
 * Classifies a user message into an IntentClassification.
 *
 * This is deterministic (no LLM call) in Phase 1. The blueprint allows
 * a lightweight LLM fallback for ambiguous cases, but that comes later.
 */
export function classifyIntent(message: string): IntentClassification {
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

  return {
    mode: matchedMode,
    domains,
    requiresProject,
    requiresCurrentInformation,
    requiresPrivateData,
    requiresExecution,
    confidence,
    reasoning,
  };
}
