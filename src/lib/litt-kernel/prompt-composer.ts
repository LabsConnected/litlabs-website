/**
 * LiTT Prompt Composer
 *
 * Assembles the system prompt for an LLM call by loading ONLY the
 * relevant sections from docs/litt/. This enforces the anti-pattern
 * rule: "Do not send the entire document tree to the model on every
 * request."
 *
 * The composer loads:
 *   1. The Constitution (always — identity + principles are immutable)
 *   2. The persona voice (always — LiTT must always speak in its voice)
 *   3. The mode-specific section (e.g., 02-intent-router/classification.md
 *      for status mode, 05-artifact-engine/canvas.md for create mode)
 *   4. The capability context block (verified capabilities only)
 *   5. The project context (if a project is active)
 *
 * It does NOT load:
 *   - Every skill definition
 *   - Every plugin description
 *   - The entire document tree
 *   - Unverified capability claims
 */

import type { LiTTControlDecision, CapabilityRecord } from "./types";
import { isCapabilityReady } from "./principles";

// ─── Constitution (inline — these are immutable and short) ──────

const CONSTITUTION_IDENTITY = `LiTT is a conversation-driven AI operating system. It is not a chatbot. It is the layer between the user's intent and the work that fulfills it.`;

const CONSTITUTION_PRINCIPLES = `LiTT Principles (immutable):
1. Truth over confidence — never claim a fact, capability, or success unless verified.
2. Intent over interface — users describe goals; LiTT selects mode, tools, workspace.
3. Projects over chats — conversations are temporary; Projects, Canvases, Artifacts persist.

Operating rules:
- Verify before acting when verification is materially possible.
- Never fake readiness, deployment, connection, or completion.
- Answer the actual question before expanding scope.
- Distinguish fact, reasoning, estimate, and opinion.
- Require approval before destructive, costly, public, or irreversible actions.
- Never require a Project for a request that does not need one.
- Do not create permanent content (Canvas, Task, File) unless intent is explicit or the user approves.`;

const PERSONA_VOICE = `LiTT speaks plainly, directly, and with warmth. Concise. Not corporate. Not robotic. Does not say "As an AI..." or "I'd be happy to...". Does not prepend disclaimers. Does not inflate confidence. Does not use emojis unless asked.`;

// ─── Mode-specific guidance ─────────────────────────────────────

const MODE_GUIDANCE: Record<string, string> = {
  think: `Mode: THINK. Reason carefully. Distinguish fact from inference. Show confidence only for important claims. Do not create artifacts.`,
  research: `Mode: RESEARCH. Use web search for current information. Cite sources. Mark freshness. Distinguish verified facts from reported facts. Do not claim "latest" without a source from the last 24 hours.`,
  create: `Mode: CREATE. Design or generate the requested content. Propose Canvas actions only when the user explicitly asks ("open in canvas", "make notes", "create a checklist"). Do not auto-create permanent content for casual responses.`,
  build: `Mode: BUILD. This requires a Project. If no Project is active, tell the user and offer to create one. Propose file changes as actions — do not silently write files. Require approval for destructive changes.`,
  review: `Mode: REVIEW. Audit the requested aspect (security, accessibility, performance, code quality). Report findings with severity. Distinguish verified issues from suspected ones.`,
  ship: `Mode: SHIP. This is high-risk. Require explicit approval before deploying. Verify the deployment URL after claiming success. Never claim "deployed" without a live URL.`,
  status: `Mode: STATUS. Report the verified state of the requested capability. If a capability is unknown, say so — do not guess. Use the capability context block below.`,
  learn: `Mode: LEARN. Explain the concept clearly. Use analogies and examples. Adjust depth to the user's apparent expertise. Do not require a Project.`,
};

// ─── Capability context block ───────────────────────────────────

/**
 * Builds a plain-English capability context block from verified
 * capability records. Only READY capabilities are listed as available;
 * others are listed with their actual state.
 */
function buildCapabilityBlock(capabilities: CapabilityRecord[]): string {
  if (capabilities.length === 0) {
    return "Capabilities: none verified.";
  }
  const ready = capabilities.filter((c) => isCapabilityReady(c));
  const notReady = capabilities.filter((c) => !isCapabilityReady(c));
  const lines: string[] = [];
  if (ready.length > 0) {
    lines.push(`Available (verified): ${ready.map((c) => c.id).join(", ")}`);
  } else {
    lines.push("Available (verified): none");
  }
  // Only list non-ready capabilities that are relevant (not "unknown")
  const relevant = notReady.filter((c) => c.state !== "unknown");
  if (relevant.length > 0) {
    lines.push(
      `Unavailable: ${relevant.map((c) => `${c.id} (${c.state})`).join(", ")}`,
    );
  }
  return `Capabilities: ${lines.join(" | ")}`;
}

// ─── Project context block ──────────────────────────────────────

function buildProjectBlock(decision: LiTTControlDecision): string {
  if (!decision.context.projectId) {
    if (decision.routing.requiresProject) {
      return "Project: REQUIRED but none active. Ask the user to create or select a Project.";
    }
    return "Project: none (not required for this request).";
  }
  return `Project: ${decision.context.projectId} (active).`;
}

// ─── Main composer ──────────────────────────────────────────────

/**
 * Composes the system prompt for an LLM call.
 *
 * The prompt is assembled from:
 *   1. Constitution (identity + principles) — always
 *   2. Persona voice — always
 *   3. Mode-specific guidance — based on the control decision
 *   4. Capability context — verified state only
 *   5. Project context — if relevant
 *
 * The composer does NOT include:
 *   - The conversation history (added by the caller)
 *   - The user message (added by the caller)
 *   - Memory context (added by the caller)
 */
export function composeSystemPrompt(
  decision: LiTTControlDecision,
  capabilities: CapabilityRecord[],
): string {
  const modeGuidance = MODE_GUIDANCE[decision.routing.mode] ?? MODE_GUIDANCE.think;
  const capabilityBlock = buildCapabilityBlock(capabilities);
  const projectBlock = buildProjectBlock(decision);

  return [
    `# LiTT`,
    ``,
    CONSTITUTION_IDENTITY,
    ``,
    CONSTITUTION_PRINCIPLES,
    ``,
    `# Voice`,
    PERSONA_VOICE,
    ``,
    `# Mode Guidance`,
    modeGuidance,
    ``,
    `# Context`,
    projectBlock,
    capabilityBlock,
    ``,
  ].join("\n");
}

/**
 * Returns ONLY the Constitution + principles (for non-LLM contexts
 * like logging or display).
 */
export function getConstitutionBlock(): string {
  return `${CONSTITUTION_IDENTITY}\n\n${CONSTITUTION_PRINCIPLES}`;
}
