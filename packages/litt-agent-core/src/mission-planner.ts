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
 */

import type { ChatMessage, ModelProvider, ModelStreamEvent } from "./types.js";
import type { RuntimeStore } from "./state.js";
import type { Mission, MissionStep } from "./missions/mission-entities.js";
import type { EvidenceType } from "./missions/mission-types.js";

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
  /** Raw model text if source === "model" (for debugging/audit). */
  rawModelText?: string;
}

export interface PlanMissionOptions {
  /** The model provider used to generate the semantic plan. */
  model: ModelProvider;
  /** The canonical RuntimeStore that owns the active mission. */
  store: RuntimeStore;
  /** The user goal text (already used to create the mission). */
  goal: string;
  /** Project context for the planning prompt. */
  projectContext?: { name: string; root: string; branch?: string | null } | null;
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
  project: { name: string; root: string; branch?: string | null } | null,
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
export function fallbackPlan(goal: string): SemanticStepSpec[] {
  const g = goal.toLowerCase();

  const stabilizeKeywords = ["stable", "stability", "production", "ready", "fix", "broken", "deploy"];
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

  // Generic inspect → verify plan
  return [
    { title: "Inspect repository baseline", description: "Capture current project state", scope: "inspect" },
    { title: "Investigate", description: "Gather evidence relevant to the goal", scope: "investigate" },
    { title: "Take action", description: "Perform the work the goal requires", scope: "act" },
    { title: "Verify", description: "Final verification gate", requiredEvidence: ["verification_result"], scope: "verify" },
  ];
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
      plan = { steps: fallbackPlan(options.goal), source: "fallback", rawModelText: modelText };
    }
  } catch {
    // Model unavailable — fall back to a goal-derived plan
    plan = { steps: fallbackPlan(options.goal), source: "fallback" };
  }

  // 2. Persist each step on the canonical mission
  const steps: MissionStep[] = [];
  for (const spec of plan.steps) {
    const step = await options.store.addMissionStep({
      title: spec.title,
      description: spec.description,
      requiredEvidence: spec.requiredEvidence,
      allowedActionScope: spec.scope ? [spec.scope] : undefined,
    });
    if (step) steps.push(step);
  }

  // 3. Return the plan + persisted steps
  const finalMission = options.store.getMission();
  if (!finalMission) {
    throw new Error("planMission: mission disappeared from the store during planning.");
  }

  return { plan, steps, mission: finalMission };
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
 */
export async function attachToolToStep(
  store: RuntimeStore,
  stepId: string,
  record: {
    toolId: string;
    toolName: string;
    toolCallId: string;
    success: boolean;
    message: string;
    durationMs?: number;
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

  // Append to actionHistory
  step.actionHistory.push({
    description: `${record.toolName}: ${record.message.slice(0, 120)}`,
    tool: record.toolId,
    timestamp: new Date().toISOString(),
    status: record.success ? "success" : "failed",
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
