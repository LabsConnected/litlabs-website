/**
 * Semantic Mission Planner — turns a user goal into a persisted
 * MissionStep[] plan BEFORE any tool execution begins.
 *
 * Contract:
 *   USER GOAL
 *     → AgentLoop/model generates a semantic execution plan
 *     → plan is persisted as MissionStep[] on the canonical Mission
 *     → execution begins; tools execute UNDER an existing semantic step
 *
 * Tools do NOT define steps. Tools attach to existing steps via
 * toolHistory / actionHistory / evidence. One step may cover many
 * tool calls (e.g. "Diagnose failures" may run search + read_file +
 * edit_file). One tool may be invoked under different steps.
 *
 * The planner is model-driven but deterministic-fallback safe:
 *   - If the model returns a parseable plan, use it.
 *   - If the model is unavailable or returns garbage, fall back to a
 *     goal-derived default plan so the mission still has semantic steps
 *     before execution. We never silently skip planning.
 *
 * The fallback is INTENT-SAFE: it classifies the goal's domain
 * (repository/dev, system/PC, informational, unknown) and only derives
 * plans for that domain. PC/system goals get system-inspection steps,
 * never repository steps. Goals matching no safe domain FAIL CLOSED with
 * an honest message instead of inventing work, and unproven fallback
 * plans never perform mutations automatically — even in Act mode.
 */

import type { ChatMessage, ModelProvider, ModelStreamEvent, ProjectContext } from "./types.js";
import type { RuntimeStore } from "./state.js";
import type { Mission, MissionStep } from "./missions/mission-entities.js";
import type { EvidenceType, MissionEvidence } from "./missions/mission-types.js";

// ─── Plan types ────────────────────────────────────────────────────

export interface SemanticStepSpec {
  title: string;
  description?: string;
  requiredEvidence?: EvidenceType[];
  /** Optional hint about which tool scope this step covers. */
  scope?: string;
}

export interface SemanticPlan {
  steps: SemanticStepSpec[];
  /** Where the plan came from. */
  source: "model" | "fallback";
  /** Classified domain when the fallback was used (source === "fallback"). */
  fallbackDomain?: FallbackDomain;
  /** Raw model text if source === "model" (for debugging/audit). */
  rawModelText?: string;
}

/**
 * Domains the deterministic fallback planner is allowed to derive a plan
 * for. Anything outside these domains fails closed — the planner never
 * invents work for an intent it cannot safely classify.
 */
export type FallbackDomain = "repo" | "system" | "info" | "unknown";

/**
 * Thrown when planning must fail closed instead of inventing work
 * (e.g. the model failed to plan AND the goal has no safe fallback
 * domain). The message preserves the original user goal.
 */
export class MissionPlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissionPlanningError";
  }
}

export interface PlanMissionOptions {
  /** The model provider used to generate the semantic plan. */
  model: ModelProvider;
  /** The canonical RuntimeStore that owns the active mission. */
  store: RuntimeStore;
  /** The user goal text (already used to create the mission). */
  goal: string;
  /** Project context for the planning prompt. */
  projectContext?: ProjectContext | null;
  /** Optional stream callback for live planning output. */
  onModelStream?: (event: ModelStreamEvent) => void;
  /** Max tokens to spend on planning (default 800). */
  maxPlanTokens?: number;
}

export interface PlanMissionResult {
  plan: SemanticPlan;
  steps: MissionStep[];
  mission: Mission;
}

// ─── Planning prompt ───────────────────────────────────────────────

function buildPlanningPrompt(
  goal: string,
  project: ProjectContext | null,
): string {
  const projectSection = project
    ? `\nProject context (canonical — do not guess):\n  - Name: ${project.name}\n  - Root: ${project.root}\n  - Branch: ${project.branch ?? "unknown"}\n`
    : "";

  return `You are LiTT's mission planner. Given a user goal, produce a SEMANTIC execution plan as a JSON array of steps.

Rules:
- Each step is a SEMANTIC phase of work, NOT one tool call.
- A step may cover many tool calls (e.g. "Diagnose failures" may include search, read_file, edit_file).
- Do NOT create one step per tool. Do NOT mention tool IDs.
- Steps must be ordered and represent real phases: inspect → check → test → build → diagnose → repair → revalidate → verify.
- 4–9 steps is ideal. Fewer is fine if the goal is simple.
- Each step has a short "title" (≤60 chars) and optional "description".
- The final step should be verification ("Verify production readiness" or similar).
- DOMAIN SAFETY: the goal decides the domain. Include repository steps
  (git status, typecheck, tests, build) ONLY when the goal is about a
  repository, project, app, or code. For a PC/system goal, plan system
  inspection (CPU, memory, disk, processes) — never repository steps.
  For an informational goal, plan research/summary steps. Never copy
  repository steps into a plan for a goal that is not about a repository.

Output ONLY a JSON array, no prose, no code fences:
[
  { "title": "Inspect repository baseline", "description": "Capture git status, branch, and current state" },
  { "title": "Typecheck", "description": "Run the project's type checker and capture errors" },
  { "title": "Run tests", "description": "Execute the test suite and capture results" },
  { "title": "Production build", "description": "Run the production build and capture any failures" },
  { "title": "Diagnose failures", "description": "Investigate any failures from the previous steps" },
  { "title": "Apply approved repairs", "description": "Fix the diagnosed issues" },
  { "title": "Revalidate", "description": "Re-run typecheck, tests, and build after repairs" },
  { "title": "Verify production readiness", "description": "Final verification gate" }
]

User goal:
${goal}
${projectSection}
Output the JSON array now.`;
}

// ─── Plan parsing ──────────────────────────────────────────────────

/**
 * Parse model output into a SemanticPlan. Tolerates code fences and
 * surrounding prose. Returns null if no valid array is found.
 */
export function parseSemanticPlan(text: string): SemanticStepSpec[] | null {
  if (!text || !text.trim()) return null;

  // Strip code fences if present
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\n```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;

  // Find the first JSON array in the text
  const arrayStart = candidate.indexOf("[");
  const arrayEnd = candidate.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1 || arrayEnd <= arrayStart) return null;

  const jsonText = candidate.slice(arrayStart, arrayEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const steps: SemanticStepSpec[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === "string" ? obj.title.trim() : "";
    if (!title) continue;
    const description = typeof obj.description === "string" ? obj.description.trim() : undefined;
    const scope = typeof obj.scope === "string" ? obj.scope.trim() : undefined;
    const requiredEvidence = Array.isArray(obj.requiredEvidence)
      ? obj.requiredEvidence.filter((e): e is EvidenceType => typeof e === "string")
      : undefined;
    steps.push({
      title: title.slice(0, 120),
      description: description?.slice(0, 400),
      requiredEvidence: requiredEvidence?.length ? requiredEvidence : undefined,
      scope,
    });
  }

  return steps.length > 0 ? steps : null;
}

/** Normalize a semantic plan by inferring requiredEvidence from step titles
 * when the model omitted it. This enforces the mission truth contract:
 *   - "Run tests"        → requiredEvidence: ["test_result"]
 *   - "Typecheck"       → requiredEvidence: ["typecheck_result"]
 *   - "Production build"→ requiredEvidence: ["build_result"]
 *
 * This runs after parseSemanticPlan so that explicitly provided
 * requiredEvidence is preserved, and only undefined values are filled in.
 */
export function normalizeSemanticPlan(steps: SemanticStepSpec[]): SemanticStepSpec[] {
  return steps.map((step) => {
    // Explicit model/planner contracts always win.
    if (step.requiredEvidence !== undefined) {
      return step;
    }

    const title = step.title.toLowerCase();
    const inferred: EvidenceType[] = [];

    const add = (type: EvidenceType) => {
      if (!inferred.includes(type)) inferred.push(type);
    };

    // Infer only evidence types with canonical runtime producers.
    // Do not use generic words such as "run" or "production":
    // "run build" must not accidentally become test_result.
    if (/\btype[ -]?check\b/.test(title)) {
      add("typecheck_result");
    }

    if (/\btests?\b|\btesting\b/.test(title)) {
      add("test_result");
    }

    if (/\bbuild\b/.test(title)) {
      add("build_result");
    }

    return {
      ...step,
      requiredEvidence: inferred.length > 0 ? inferred : undefined,
    };
  });
}

// ─── Fallback plan ─────────────────────────────────────────────────

/**
 * Derive a reasonable default semantic plan from the goal text when the
 * model is unavailable or returns an unparseable response.
 *
 * This is NOT a hardcoded universal plan — it adapts to goal keywords.
 * The goal "Get my website stable and ready for production" maps to a
 * stabilize-and-verify plan; a goal like "Add a login page" maps to a
 * simpler inspect→implement→verify plan.
 */
/**
 * Classify the goal's domain so the deterministic fallback planner never
 * substitutes a repository mission for an unrelated user intent.
 *
 * Priority order (first match wins):
 *   1. "system" — explicit machine terms (pc, computer, laptop, cpu, ram,
 *      disk, startup, driver, windows, ...). PC/system requests get
 *      system-inspection steps, NEVER repository steps.
 *   2. "info" — read-only questions and research requests.
 *   3. "repo" — repository, project, app, or code work.
 *   4. "unknown" — fail closed: the planner must NOT invent work.
 *
 * "inspect my PC, find what is slowing it down, fix what is safe"
 * → "system" (strong term "pc") — it will never see repository steps.
 */
export function classifyGoalDomain(goal: string): FallbackDomain {
  const g = goal.toLowerCase();

  const systemKeywords = [
    "pc", "computer", "laptop", "desktop", "machine", "cpu", "processor",
    "ram", "hard drive", "hdd", "ssd", "task manager", "driver", "drivers",
    "windows", "operating system", "hardware", "malware", "virus",
    "bloatware", "autostart", "registry", "blue screen", "bsod", "startup",
    "booting", "boot time", "boot up", "perfmon", "resource monitor",
    "sysmain", "superfetch", "my system", "this system", "my machine",
    "this machine", "my computer", "my laptop", "my desktop", "my pc",
    "slow startup", "slow boot", "slow pc", "slow computer", "slow laptop",
    "system performance", "system is slow", "system slow", "pc performance",
    "memory usage", "high cpu", "high memory", "disk usage", "overheat",
    "overheating", "temp files", "startup programs", "background processes",
    "running processes", "startup items", "boot items", "process explorer",
    "slowdown", "slowing", "slowing down", "lag",
  ];
  if (systemKeywords.some((k) => g.includes(k))) return "system";

  const infoKeywords = [
    "explain", "what is", "what are", "what does", "what happened",
    "how does", "how do", "how to", "tell me", "summarize", "summary",
    "research", "look up", "define", "meaning", "compare", "difference",
    "differences", "list of", "report on", "find out", "learn about",
    "understand", "documentation", "docs", "why is", "why does",
    "overview", "background", "history of", "walk me through",
    "information about", "information on", "facts about",
    "information regarding",
  ];
  if (infoKeywords.some((k) => g.includes(k))) return "info";

  const repoKeywords = [
    "repository", "repo", "monorepo", "project", "codebase", "source code",
    "code", "app", "application", "website", "web app", "frontend",
    "backend", "api", "build", "typecheck", "type check", "test suite",
    "tests", "test", "deploy", "deployment", "production", "npm", "yarn",
    "pnpm", "package.json", "commit", "pull request", "branch", "ci",
    "lint", "bug", "compile", "compiler", "typescript", "javascript",
    "git", "github", "vercel", "stabilize", "stabilization", "stability",
    "stable", "refactor", "feature", "component", "dependency",
    "dependencies", "bundle", "bundler", "login page", "pipeline",
    "readme", "package", "config file", "script", "module", "worker",
    "server", "database", "sql", "docker", "terraform", "cloudflare",
    "react", "next.js", "node", "vite", "jest", "vitest", "eslint",
    "prettier", "tsc", "broken build", "build fails", "test failures",
    "fix the build", "pages", "route", "auth", "supabase", "clerk",
    "stripe",
  ];
  if (repoKeywords.some((k) => g.includes(k))) return "repo";

  return "unknown";
}

/** Scopes that perform automatic mutations under a fallback plan. */
const MUTATION_SCOPES = new Set(["repair", "implement", "act"]);

/**
 * True when a step would mutate state (files, system, commands with side
 * effects) under a fallback plan. Fallback plans are unproven — the model
 * failed to plan — so these steps must never execute automatically.
 */
export function isMutationStep(step: SemanticStepSpec): boolean {
  return MUTATION_SCOPES.has(step.scope ?? "");
}

/**
 * Replace an auto-mutation step with a read-only approval-proposal step.
 * The user's intent is preserved ("fix what is safe") but nothing is
 * changed without explicit approval.
 */
function mutationSafeStep(step: SemanticStepSpec): SemanticStepSpec {
  switch (step.scope) {
    case "repair":
      return {
        title: "Propose repairs for approval",
        description: "Present diagnosed issues and proposed fixes — no changes are applied without explicit approval",
        scope: "report",
      };
    case "implement":
      return {
        title: "Propose implementation for approval",
        description: "Present the implementation plan — no changes are applied without explicit approval",
        scope: "plan",
      };
    case "act":
      return {
        title: "Report findings and recommended actions",
        description: "Present findings and recommended actions — no changes are applied automatically",
        scope: "report",
      };
    default:
      return step;
  }
}

/** System/PC inspection plan — read-only, NEVER repository steps. */
function systemFallbackPlan(): SemanticStepSpec[] {
  return [
    { title: "Inspect system performance state", description: "Gather CPU, memory, disk, and running-process metrics", scope: "inspect" },
    { title: "Diagnose slowdown causes", description: "Identify processes or services consuming resources", scope: "diagnose" },
    { title: "Report findings and safe-fix proposals", description: "Present findings and propose safe fixes — no changes are applied automatically", scope: "report" },
    { title: "Verify the report", description: "Confirm the findings address the user's goal", scope: "verify" },
  ];
}

/** Informational/read-only plan — research, summarize, verify. */
function infoFallbackPlan(): SemanticStepSpec[] {
  return [
    { title: "Research the topic", description: "Gather authoritative, current information relevant to the goal", scope: "investigate" },
    { title: "Summarize findings", description: "Present a clear, sourced summary that answers the goal", scope: "report" },
    { title: "Verify the summary", description: "Confirm the summary fully addresses the goal", scope: "verify" },
  ];
}

/**
 * Repository/dev fallback plans. ONLY reached when classifyGoalDomain()
 * returned "repo" — the goal is explicitly about a repository, project,
 * app, or code, so repository steps are intent-safe.
 */
function repoFallbackPlan(goal: string): SemanticStepSpec[] {
  const g = goal.toLowerCase();

  const stabilizeKeywords = ["stable", "stabilize", "stability", "production", "ready", "fix", "broken", "deploy"];
  const isStabilize = stabilizeKeywords.some((k) => g.includes(k));

  if (isStabilize) {
    return [
      { title: "Inspect repository baseline", description: "Capture git status, branch, and current project state", scope: "inspect" },
      { title: "Typecheck", description: "Run the project's type checker and capture errors", requiredEvidence: ["typecheck_result"], scope: "check" },
      { title: "Run tests", description: "Execute the test suite and capture results", requiredEvidence: ["test_result"], scope: "check" },
      { title: "Production build", description: "Run the production build and capture any failures", requiredEvidence: ["build_result"], scope: "check" },
      { title: "Diagnose failures", description: "Investigate any failures from the previous steps", scope: "diagnose" },
      { title: "Apply approved repairs", description: "Fix the diagnosed issues with human approval", scope: "repair" },
      { title: "Revalidate", description: "Re-run typecheck, tests, and build after repairs", scope: "revalidate" },
      { title: "Verify production readiness", description: "Final verification gate", requiredEvidence: ["verification_result"], scope: "verify" },
    ];
  }

  const implementKeywords = ["add", "implement", "create", "build a", "make a", "new"];
  const isImplement = implementKeywords.some((k) => g.includes(k));

  if (isImplement) {
    return [
      { title: "Inspect repository baseline", description: "Capture current project state", scope: "inspect" },
      { title: "Plan implementation", description: "Identify files to change and approach", scope: "plan" },
      { title: "Implement changes", description: "Apply the planned changes", scope: "implement" },
      { title: "Typecheck and test", description: "Run typecheck and tests", requiredEvidence: ["typecheck_result", "test_result"], scope: "check" },
      { title: "Verify", description: "Final verification gate", requiredEvidence: ["verification_result"], scope: "verify" },
    ];
  }

  // Generic inspect → verify plan (repo domain)
  return [
    { title: "Inspect repository baseline", description: "Capture current project state", scope: "inspect" },
    { title: "Investigate", description: "Gather evidence relevant to the goal", scope: "investigate" },
    { title: "Take action", description: "Perform the work the goal requires", scope: "act" },
    { title: "Verify", description: "Final verification gate", requiredEvidence: ["verification_result"], scope: "verify" },
  ];
}

/**
 * Derive a reasonable default semantic plan from the goal text when the
 * model is unavailable or returns an unparseable response.
 *
 * INTENT SAFETY: the plan is derived ONLY for the classified domain of
 * the goal. PC/system goals get system-inspection steps; informational
 * goals get research/summary steps; repository goals keep the repo
 * plans. Goals that match no safe domain return [] — the caller fails
 * closed with an honest message instead of inventing work.
 *
 * ACT MODE SAFETY: an unproven fallback (the model failed to plan) never
 * performs mutations automatically — even in Act mode. Steps that would
 * mutate (repair/implement/act scopes) become read-only approval
 * proposals.
 */
export function fallbackPlan(goal: string, mode?: "plan" | "act" | "auto"): SemanticStepSpec[] {
  const domain = classifyGoalDomain(goal);

  let steps: SemanticStepSpec[];
  switch (domain) {
    case "system":
      steps = systemFallbackPlan();
      break;
    case "info":
      steps = infoFallbackPlan();
      break;
    case "repo":
      steps = repoFallbackPlan(goal);
      break;
    default:
      // unknown — fail closed. Never invent work for an intent the
      // fallback cannot safely classify.
      return [];
  }

  if (mode === "act") {
    steps = steps.map(mutationSafeStep);
  }
  return steps;
}

// ─── Main entry: planMission ───────────────────────────────────────

/**
 * Generate a semantic plan for the active mission and persist it as
 * MissionStep[] on the canonical RuntimeStore BEFORE any tool execution.
 *
 * The active mission must already exist on the store (created via
 * store.createMission()). This function:
 *   1. Asks the model for a semantic plan (with fallback)
 *   2. Persists each step via store.addMissionStep()
 *   3. Returns the plan + the persisted steps
 *
 * It does NOT start execution. The caller runs the agent loop after
 * planning and attaches tool calls to the existing steps.
 */
export async function planMission(
  options: PlanMissionOptions,
): Promise<PlanMissionResult> {
  const mission = options.store.getMission();
  if (!mission) {
    throw new Error("planMission: no active mission on the RuntimeStore. Create the mission first.");
  }

  // 1. Ask the model for a semantic plan
  let plan: SemanticPlan;
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are LiTT's mission planner. Output only a JSON array of semantic steps." },
      { role: "user", content: buildPlanningPrompt(options.goal, options.projectContext ?? null) },
    ];

    let modelText = "";
    await options.model.stream(messages, (event) => {
      if (options.onModelStream) {
        try { options.onModelStream(event); } catch { /* listener errors don't crash planning */ }
      }
      if (event.type === "delta") {
        modelText += event.text;
      }
    });

    const modelSteps = parseSemanticPlan(modelText);
    if (modelSteps && modelSteps.length > 0) {
      plan = { steps: modelSteps, source: "model", rawModelText: modelText };
    } else {
      plan = await buildFallbackOrBlock(options, modelText);
    }
  } catch (err) {
    // A fail-closed planning result must propagate — never mask it by
    // falling back again. The honest message is the deliverable.
    if (err instanceof MissionPlanningError) throw err;
    // Model unavailable — fall back to a goal-derived plan (which may
    // itself fail closed with an honest message for unknown domains).
    plan = await buildFallbackOrBlock(options, undefined);
  }

  // 2. Persist each step on the canonical mission
  // Normalize requiredEvidence for any steps the model omitted.
  const normalizedSteps = normalizeSemanticPlan(plan.steps);

  const steps: MissionStep[] = [];
  for (const spec of normalizedSteps) {
    const step = await options.store.addMissionStep({
      title: spec.title,
      description: spec.description,
      requiredEvidence: spec.requiredEvidence,
      allowedActionScope: spec.scope ? [spec.scope] : undefined,
    });
    if (step) steps.push(step);
  }

  // 3. Record planning truth on the mission (source, domain, raw text)
  const finalMission = options.store.getMission();
  if (!finalMission) {
    throw new Error("planMission: mission disappeared from the store during planning.");
  }
  finalMission.metadata = {
    ...finalMission.metadata,
    plan: {
      source: plan.source,
      domain: plan.fallbackDomain ?? null,
      stepCount: plan.steps.length,
      rawModelText: plan.rawModelText ?? null,
    },
  };
  await options.store.persistMissionNow();

  return { plan, steps, mission: finalMission };
}

/**
 * Build the deterministic fallback plan for the goal, or FAIL CLOSED.
 *
 * The fallback only ever derives plans for the classified domain of the
 * goal (repo/system/info). A goal with no safe domain returns [] here —
 * the planner refuses to invent work and surfaces an honest message that
 * preserves the original user goal. The failure is also recorded on the
 * mission's metadata so the planning failure survives persistence.
 */
async function buildFallbackOrBlock(
  options: PlanMissionOptions,
  modelText: string | undefined,
): Promise<SemanticPlan> {
  const mission = options.store.getMission();
  const domain = classifyGoalDomain(options.goal);
  const steps = fallbackPlan(options.goal, mission?.mode);

  if (steps.length === 0) {
    const failureReason =
      `Planning failed: the model planner could not produce a plan, and "${options.goal}" ` +
      `does not match a safe fallback domain (repository/dev, system/PC, or informational). ` +
      `No work was started and nothing was changed.`;
    const m = options.store.getMission();
    if (m) {
      m.metadata = {
        ...m.metadata,
        plan: { source: "fallback", domain, failureReason, stepCount: 0 },
      };
      await options.store.persistMissionNow();
    }
    throw new MissionPlanningError(failureReason);
  }

  return { steps, source: "fallback", fallbackDomain: domain, rawModelText: modelText };
}

// ─── Step attachment ───────────────────────────────────────────────

/**
 * Decide which existing semantic step a tool call should attach to.
 *
 * The mapping is based on the step's allowedActionScope (set during
 * planning) and the tool's identity. This is NOT one-step-per-tool —
 * many tools may attach to the same step, and the same tool may attach
 * to different steps across a mission.
 *
 * Returns the step id, or null if no step matches (caller may create
 * an ad-hoc step or attach to the current step).
 */
export function resolveStepForTool(
  steps: MissionStep[],
  toolId: string,
  currentStepId: string | null,
): string | null {
  if (steps.length === 0) return null;

  // 1. If there's a current working step, attach there by default.
  const working = steps.find((s) => s.status === "working");
  if (working) return working.id;

  // 2. Map tool → scope, then find the first pending step with that scope.
  const toolScope = toolToScope(toolId);
  if (toolScope) {
    const byScope = steps.find(
      (s) => s.status === "pending" && s.allowedActionScope.includes(toolScope),
    );
    if (byScope) return byScope.id;
  }

  // 3. Fall back to the first pending step (sequential progression).
  const firstPending = steps.find((s) => s.status === "pending");
  if (firstPending) return firstPending.id;

  // 4. Last resort: the current step id.
  return currentStepId;
}

/** Map a tool id to a semantic scope used during planning. */
function toolToScope(toolId: string): string | null {
  // Inspection tools
  if (
    toolId === "project.status" ||
    toolId === "project.diff" ||
    toolId === "project.log" ||
    toolId === "project.branch" ||
    toolId === "project.list_files" ||
    toolId === "project.read_file" ||
    toolId === "project.search" ||
    toolId === "project.package"
  ) {
    return "inspect";
  }
  // Check tools
  if (toolId === "project.typecheck" || toolId === "project.test" || toolId === "project.build") {
    return "check";
  }
  // Mutation tools → repair/implement/act
  if (toolId === "project.edit_file" || toolId === "project.write_file") {
    return "repair";
  }
  // Arbitrary run → act
  if (toolId === "project.run") {
    return "act";
  }
  return null;
}

/**
 * Record a tool call against a step's toolHistory and actionHistory.
 * This is the canonical way tools attach to existing semantic steps —
 * the tool does NOT define the step, it contributes to it.
 *
 * The record is created with status "pending" — the result is NOT
 * known yet at tool_call time. Use updateToolResultOnStep() to update
 * the record when the tool result arrives. This prevents recording
 * success: true before execution completes.
 */
export async function attachToolToStep(
  store: RuntimeStore,
  stepId: string,
  record: {
    toolId: string;
    toolName: string;
    toolCallId: string;
    toolRunId?: string;
    message?: string;
    filesRead?: string[];
    filesChanged?: string[];
  },
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;
  const step = mission.steps.find((s) => s.id === stepId);
  if (!step) return;

  // Append to toolHistory (dedup by toolCallId)
  if (!step.toolHistory.includes(record.toolCallId)) {
    step.toolHistory.push(record.toolCallId);
  }

  // Append to actionHistory with PENDING status — the result is not
  // known yet. The record is updated when the tool result arrives.
  step.actionHistory.push({
    description: `${record.toolName}: ${record.message?.slice(0, 120) ?? "started"}`,
    tool: record.toolId,
    toolCallId: record.toolCallId,
    toolRunId: record.toolRunId,
    timestamp: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    status: "pending",
  });

  // Append file lists (dedup)
  if (record.filesRead) {
    for (const f of record.filesRead) {
      if (!step.filesRead.includes(f)) step.filesRead.push(f);
    }
  }
  if (record.filesChanged) {
    for (const f of record.filesChanged) {
      if (!step.filesChanged.includes(f)) step.filesChanged.push(f);
    }
  }

  // Persist via the store's touch + persist path
  await store.persistMissionNow();
}

/**
 * Update a tool's action record on a step when the tool result arrives.
 * This is the canonical way to record the truthful outcome of a tool
 * execution — the record was created with status "pending" by
 * attachToolToStep, and this function updates it to "success" or
 * "failed" with the actual result.
 *
 * A failed tool must remain failed in history. This function does NOT
 * rewrite a failed record to success — it only updates pending records.
 */
export async function updateToolResultOnStep(
  store: RuntimeStore,
  stepId: string,
  toolCallId: string,
  result: { success: boolean; message: string; durationMs?: number },
): Promise<void> {
  const mission = store.getMission();
  if (!mission) return;
  const step = mission.steps.find((s) => s.id === stepId);
  if (!step) return;

  // Find the action record by toolCallId
  const record = step.actionHistory.find((r) => r.toolCallId === toolCallId);
  if (!record) return;

  // Only update pending records — a failed record stays failed
  if (record.status === "pending") {
    record.status = result.success ? "success" : "failed";
    record.completedAt = new Date().toISOString();
    record.result = { success: result.success, message: result.message.slice(0, 300) };
    if (result.message && record.description.endsWith("started")) {
      record.description = `${record.tool ?? "tool"}: ${result.message.slice(0, 120)}`;
    }
  }

  await store.persistMissionNow();
}

/**
 * Map a tool id to the canonical evidence type it produces.
 *
 * This is the key mapping that drives semantic step progression: when
 * a tool succeeds, it produces evidence of a specific type. If the
 * current step's `requiredEvidence` includes that type, the step is
 * semantically complete and the mission advances to the next step.
 *
 * Without this mapping, all tool results produce generic
 * `command_result` evidence, which never matches `typecheck_result`,
 * `test_result`, `build_result`, etc. — so steps never advance.
 */
export function toolToEvidenceType(toolId: string): EvidenceType {
  switch (toolId) {
    case "project.status":
      return "repository_status";
    case "project.diff":
      return "diff";
    case "project.typecheck":
      return "typecheck_result";
    case "project.test":
      return "test_result";
    case "project.build":
      return "build_result";
    case "project.read_file":
      return "file_read";
    case "project.search":
      return "search_result";
    case "project.list_files":
      return "repository_status";
    default:
      return "command_result";
  }
}

/**
 * Check if a mission step's required evidence has been satisfied by
 * the evidence collected on the mission.
 *
 * A step is semantically complete when ALL of its requiredEvidence
 * types are present in the mission's evidence list with success=true.
 *
 * Steps without requiredEvidence are never auto-advanced by this
 * check — they rely on the model moving to a different scope or the
 * agent loop completion path.
 */
export function isStepEvidenceSatisfied(
  step: MissionStep,
  evidence: MissionEvidence[],
): boolean {
  if (!step.requiredEvidence || step.requiredEvidence.length === 0) return false;
  for (const requiredType of step.requiredEvidence) {
    const found = evidence.some(
      (e) =>
        e.stepId === step.id &&
        e.type === requiredType &&
        e.success === true,
    );
    if (!found) return false;
  }
  return true;
}

/**
 * Advance the canonical mission after a tool result if the current
 * step's required evidence is now satisfied.
 *
 * THE REAL RUNTIME LIFECYCLE (not presentation):
 *
 *   step 1 working (requiredEvidence: [repository_status])
 *     → project.status succeeds → evidence: repository_status
 *     → isStepEvidenceSatisfied(step 1) → true
 *     → step 1 passed (mission:step_passed)
 *     → step 2 working (mission:step_started)
 *
 *   step 2 working (requiredEvidence: [typecheck_result])
 *     → project.typecheck succeeds → evidence: typecheck_result
 *     → isStepEvidenceSatisfied(step 2) → true
 *     → step 2 passed
 *     → step 3 working
 *
 * Rules:
 *   - A FAILED tool result never advances — the mission stays on the
 *     current working step so repairs/retries attach to the same step.
 *   - The current working step is passed only when its requiredEvidence
 *     is fully satisfied AND a later pending step exists (the final
 *     step is left working for the VerificationGate).
 *   - Steps without requiredEvidence are advanced when the tool's scope
 *     differs from the current step's scope (the model moved to a new
 *     semantic phase).
 *   - All transitions go through the canonical RuntimeStore state
 *     machine, which validates every transition and emits canonical
 *     mission:* events.
 *
 * Returns the steps that were transitioned, or null when nothing moved.
 */
export async function progressMissionStepAfterTool(
  store: RuntimeStore,
  options: {
    success: boolean;
    toolId: string;
  },
): Promise<{ passedStepId: string | null; openedStepId: string | null } | null> {
  const mission = store.getMission();
  if (!mission) return null;
  if (!options.success) return null; // failed/retried tool — stay in step

  const step =
    mission.steps.find((s) => s.id === mission.currentStepId) ??
    mission.steps.find((s) => s.status === "working");
  if (!step || step.status !== "working") return null;

  // Check if the step's required evidence is now satisfied
  const evidenceSatisfied = isStepEvidenceSatisfied(step, mission.evidence);

  // If evidence isn't satisfied, check if we should still advance:
  //   - Steps WITHOUT requiredEvidence advance when any tool succeeds
  //     (the tool success IS the evidence — there's no specific
  //     evidence contract to wait for)
  //   - Steps WITH requiredEvidence advance only when the evidence
  //     contract is met (or when the tool's scope differs, meaning
  //     the model moved to a new phase)
  if (!evidenceSatisfied) {
    if (!step.requiredEvidence || step.requiredEvidence.length === 0) {
      // No evidence contract — a successful tool is enough to advance
      // (but only if there's a next step — checked below)
    } else {
      // Has requiredEvidence — check if the tool's scope differs
      const toolScope = toolToScope(options.toolId);
      if (!toolScope || !step.allowedActionScope.includes(toolScope)) {
        // Tool scope doesn't match — but we still need evidence
        return null;
      } else {
        return null; // same scope, evidence not satisfied yet — stay
      }
    }
  }

  const idx = mission.steps.indexOf(step);
  const nextPending = mission.steps.slice(idx + 1).find((s) => s.status === "pending");
  if (!nextPending) return null; // final step — the gate/loop-end owns completion

  await store.updateMissionStepStatus(step.id, "passed", {
    verificationPassed: true,
    verificationEvidence: `Step satisfied by ${options.toolId} evidence`,
  });
  await store.setCurrentStep(nextPending.id);

  return { passedStepId: step.id, openedStepId: nextPending.id };
}
