import "server-only";

/**
 * LiTT Capability Planner — Part A of the Tool Orchestrator fix.
 *
 * Before substantive execution, classify what capabilities a goal needs.
 * This is a pure function (no LLM calls, no I/O) so the classification
 * rules are fully unit-testable.
 *
 * The plan is internal machine-readable state. It is NOT user-configured
 * and NOT displayed as a giant planner UI — it feeds the operator prompt
 * so the model knows which of its real capabilities materially improve
 * THIS goal.
 *
 * Design principle: ALL REAL TOOLS AVAILABLE WHEN NEEDED,
 * NOT ALL TOOLS USED EVERY TIME.
 */

// ─── Capability vocabulary ────────────────────────────────────────
// These are coarse capability families, not individual tool IDs. The
// agent loop maps them to concrete tools via ToolRegistry +
// PermissionEngine + resolveAvailableCapabilities.

export const CAPABILITY_FAMILIES = [
  "project_inspection", // files.list, files.read, project.scan
  "filesystem", // files.write, files.patch, project.insert_asset
  "web_search", // web.search
  "web_fetch", // web.fetch (SSRF-safe URL retrieval)
  "image_generation", // image.generate
  "terminal", // terminal.execute
  "preview", // preview/build tools, preview.launch
  "browser", // browser.start_session, screenshot, extract, navigate
  "deployment", // project.deploy, deploy.execute
  "memory", // memory.search, memory recall
  "git", // git.status, git.commit, git.push
] as const;

export type CapabilityFamily = (typeof CAPABILITY_FAMILIES)[number];

/** How strongly the goal calls for a capability. */
export type CapabilityNeed = "required" | "useful" | "not_needed";

export interface CapabilityPlan {
  /** The user's goal, trimmed. */
  goal: string;
  /** Capabilities the goal cannot be completed without. */
  requiredCapabilities: CapabilityFamily[];
  /** Capabilities that would materially improve the result. */
  usefulCapabilities: CapabilityFamily[];
  /** Per-capability rationale (only for required/useful). */
  reason: Partial<Record<CapabilityFamily, string>>;
  /** True when the user supplied a visual reference to match. */
  isReferenceMatch: boolean;
  /** True when the goal is a visual/site build needing verification. */
  needsVisualVerification: boolean;
}

// ─── Intent detection patterns ────────────────────────────────────

const REFERENCE_MATCH_PATTERNS = [
  /make (mine|it) look like/i,
  /rebuild what i (showed|sent|gave) you/i,
  /match this/i,
  /same (quality|design|look|style) as/i,
  /like this (reference|site|design|screenshot)/i,
  /use this (screenshot|reference|design|image|site)/i,
  /recreate (this|that)/i,
  /copy (the|this) (design|layout|style)/i,
];

const VISUAL_BUILD_PATTERNS = [
  /(build|create|redesign|rebuild).*(website|site|landing page|web app|webapp|page|homepage)/i,
  /redesign/i,
  /landing page/i,
  /\bui\b/i,
  /dashboard/i,
  /portfolio/i,
];

const RESEARCH_PATTERNS = [
  /research/i,
  /what (is|are) (the |a )?best/i,
  /compare/i,
  /find (me |out )?/i,
  /look up/i,
  /current/i,
  /latest/i,
  /competitor/i,
  /pricing/i,
];

const IMAGE_PATTERNS = [
  /generate (an |a )?image/i,
  /create (an |a )?(image|logo|illustration|graphic|banner|hero)/i,
  /visual/i,
  /custom (image|graphic|illustration|artwork)/i,
  /premium/i,
  /polished/i,
  /\brich\b/i,
];

const TERMINAL_PATTERNS = [
  /terminal/i,
  /run (the |a )?build/i,
  /install/i,
  /npm|pnpm|yarn/i,
  /typecheck/i,
  /test/i,
  /deploy/i,
  /git /i,
];

const DEPLOY_PATTERNS = [
  /\bdeploy\b/i,
  /\bpublish\b/i,
  /go live/i,
  /\bship\b/i,
];

const SIMPLE_TEXT_PATTERNS = [
  /^(change|update|fix|edit) (the )?(\w+ )?(text|heading|title|copy|wording)/i,
  /^(what|how|why|when|where|is|are|can|do|does) /i,
];

/**
 * Classify a user goal into required/useful capabilities.
 * Pure function — deterministic, no I/O.
 */
export function planCapabilities(goal: string): CapabilityPlan {
  const g = goal.trim();
  const reason: Partial<Record<CapabilityFamily, string>> = {};
  const required = new Set<CapabilityFamily>();
  const useful = new Set<CapabilityFamily>();

  const add = (
    set: Set<CapabilityFamily>,
    cap: CapabilityFamily,
    why: string,
  ) => {
    set.add(cap);
    reason[cap] = why;
  };

  // Reference-match detection (Part H) — a reference to match changes
  // the whole plan: inspect the reference, extract its visual language,
  // generate matching imagery, and visually verify against it.
  const isReferenceMatch = REFERENCE_MATCH_PATTERNS.some((p) => p.test(g));

  // Visual/site builds always need inspection + verification.
  // A reference-match is inherently visual: the user will compare side by side.
  const needsVisualVerification =
    VISUAL_BUILD_PATTERNS.some((p) => p.test(g)) || isReferenceMatch;

  // Project inspection: required for anything touching a project.
  // We default to useful (not required) since the loop injects
  // auto-inspection results; the planner marks it required when the
  // goal explicitly names project files or structure.
  if (/project|file|code|repo|site/i.test(g)) {
    add(
      required,
      "project_inspection",
      "Goal names project files or structure — inspect before acting.",
    );
  }

  // Filesystem writes: required when building/changing anything.
  if (/build|create|change|update|fix|edit|write|redesign|generate/i.test(g)) {
    add(required, "filesystem", "Goal requires creating or changing files.");
  }

  // Research: useful when the goal benefits from external context.
  if (RESEARCH_PATTERNS.some((p) => p.test(g)) || isReferenceMatch) {
    add(
      useful,
      "web_search",
      isReferenceMatch
        ? "Reference-match benefits from researching the reference's domain/design patterns."
        : "Goal asks for research or current information.",
    );
  }
  // Local-business builds benefit from local context research.
  if (/roofing|plumber|restaurant|local business|grand haven|service area/i.test(g)) {
    add(useful, "web_search", "Local-business site benefits from real local context research.");
  }

  // Web fetch: useful alongside search, or when a URL/reference is given.
  if (/https?:\/\//i.test(g) || /reference/i.test(g)) {
    add(useful, "web_fetch", "A URL or reference was supplied — fetch it for analysis.");
  }

  // Images: useful when visual quality matters.
  if (IMAGE_PATTERNS.some((p) => p.test(g)) || needsVisualVerification) {
    add(
      useful,
      "image_generation",
      needsVisualVerification
        ? "Visual build — custom imagery materially improves the result over placeholders."
        : "Goal explicitly asks for imagery.",
    );
  }

  // Terminal: required for engineering proof when the goal mentions it.
  if (TERMINAL_PATTERNS.some((p) => p.test(g))) {
    add(required, "terminal", "Goal requires running commands, builds, or tests.");
  } else if (/build|fix/i.test(g) && needsVisualVerification) {
    // Site builds should verify with real build tooling when available.
    add(useful, "terminal", "Site build should be verified with real build/typecheck tooling.");
  }

  // Preview + browser: required for visual builds (verify the render).
  if (needsVisualVerification || isReferenceMatch) {
    add(required, "preview", "Visual build — must preview the rendered result.");
    add(required, "browser", "Visual build — must visually inspect the rendered result.");
  }

  // Deployment: only when the user asks to ship.
  if (DEPLOY_PATTERNS.some((p) => p.test(g))) {
    add(required, "deployment", "User asked to deploy/publish/ship.");
  }

  // Memory: useful for personalization, never required.
  if (/my|preference|remember|usual/i.test(g)) {
    add(useful, "memory", "Goal references user context — recall preferences.");
  }

  // Git: useful when the goal mentions version control.
  if (/git|commit|push|branch/i.test(g)) {
    add(useful, "git", "Goal mentions version control.");
  }

  // Simple text/Q&A: keep the plan minimal — files only, no
  // pointless web/image/browser usage (spec Test 1).
  if (
    SIMPLE_TEXT_PATTERNS.some((p) => p.test(g)) &&
    !needsVisualVerification &&
    !isReferenceMatch
  ) {
    return {
      goal: g,
      requiredCapabilities: ["project_inspection", "filesystem"],
      usefulCapabilities: [],
      reason: {
        project_inspection: "Locate the text to change.",
        filesystem: "Apply the text change.",
      },
      isReferenceMatch: false,
      needsVisualVerification: false,
    };
  }

  return {
    goal: g,
    requiredCapabilities: [...required],
    usefulCapabilities: [...useful].filter((c) => !required.has(c)),
    reason,
    isReferenceMatch,
    needsVisualVerification,
  };
}

/**
 * Render the capability plan as a compact operator-prompt block.
 * Injected into the system prompt so the model knows which of its real
 * capabilities materially improve THIS goal.
 */
export function buildCapabilityPlanPrompt(plan: CapabilityPlan): string {
  const lines: string[] = [
    `CAPABILITY PLAN (derived from your goal — use what materially helps):`,
    `Goal: "${plan.goal.slice(0, 200)}"`,
  ];
  if (plan.requiredCapabilities.length > 0) {
    lines.push(`Required: ${plan.requiredCapabilities.join(", ")}`);
  }
  if (plan.usefulCapabilities.length > 0) {
    lines.push(`Useful when they improve the result: ${plan.usefulCapabilities.join(", ")}`);
  }
  for (const [cap, why] of Object.entries(plan.reason)) {
    lines.push(`- ${cap}: ${why}`);
  }
  if (plan.isReferenceMatch) {
    lines.push(
      `REFERENCE-MATCH TASK: the user supplied a reference to match. Follow the reference-match workflow: inspect the reference, extract its visual language (layout, typography, colors, spacing, imagery style, section structure), then implement toward it, preview, visually compare, and iterate.`,
    );
  }
  if (plan.needsVisualVerification) {
    lines.push(
      `VISUAL VERIFICATION REQUIRED: writing code is not completion. After preview starts, inspect the actual rendered result with browser/screenshot tools, compare against the goal${plan.isReferenceMatch ? "/reference" : ""}, fix defects, and re-check before declaring done.`,
    );
  }
  return lines.join("\n");
}
