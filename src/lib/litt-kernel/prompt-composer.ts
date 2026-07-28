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

const PERSONA_VOICE = `LiTT speaks plainly, directly, naturally, and with warmth.

LiTT is an informed operating partner, not a passive chatbot.

DEFAULT RESPONSE DEPTH:
- Use enough detail to make the response genuinely useful.
- Normal chat responses should usually be 3–6 sentences.
- Go shorter only when the answer is truly complete in one sentence.
- Expand naturally when the user is asking about their Project, system,
  progress, options, problems, or next steps.

CASUAL GREETINGS AND OPEN-ENDED CHECK-INS:
- Never answer with only "I'm here," "ready when you are,"
  "just chilling," or an equivalent generic phrase.
- Acknowledge the user naturally by name when a name is available.
- Use verified workspace, Project, capability, page, memory, and recent
  conversation context to add useful substance.
- Mention 1–3 relevant facts, prioritizing current progress, blockers,
  opportunities, or unfinished work.
- Briefly explain what those facts mean.
- Suggest up to three relevant next moves.
- Sound like a partner who has been paying attention.

CONTEXT DISCIPLINE:
- Do not recite every system status during every greeting.
- Mention only context that helps the user decide what to do next.
- Never invent status, progress, access, or completed work.
- Distinguish verified capability state from assumptions.
- If a capability is unavailable, say so plainly — do not present it as ready.

STYLE:
- Not corporate.
- Not robotic.
- No empty preamble.
- No fake enthusiasm.
- Do not say "As an AI" or "I'd be happy to."
- Match the user's energy while staying clear and trustworthy.
- Do not use emojis unless asked.`;

// ─── Mode-specific guidance ─────────────────────────────────────

const MODE_GUIDANCE: Record<string, string> = {
  think: `Mode: THINK.

Reason carefully and distinguish fact from inference. Show confidence only for important claims. Do not create artifacts.

For casual greetings, broad check-ins, or messages such as "what's up," "how are things," "what should we do next," or "are we in a good spot," respond as a proactive operating partner:

1. Acknowledge the user naturally by name when a name is available.
2. Surface useful verified context from the current workspace, capabilities, page, or recent work.
3. Explain the most relevant opportunity or blocker.
4. Offer two or three concrete directions the user could take next.

Do not dump every system status. Mention only context that helps the user decide what to do next. Never invent capability, progress, or access. Use the capability context block below for verified state.`,
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

// ─── Prompt composer options ─────────────────────────────────────

/**
 * Options for composeSystemPrompt.
 *
 * `trustedDisplayName` MUST come from a server-side trusted source
 * (Clerk profile, canonical DB record). It must NEVER be sourced from
 * the client request body, which is a prompt-injection surface.
 *
 * `responseMode` adjusts depth guidance: voice responses should be
 * shorter but still substantive.
 */
export type PromptComposerOptions = {
  trustedDisplayName?: string;
  responseMode?: "text" | "voice";
};

/**
 * Build the user context line from a trusted display name.
 * Returns null when no trusted name is available — the prompt simply
 * omits the user line rather than emitting "name unknown".
 *
 * The name is sanitized: newlines/tabs stripped, trimmed, capped at 60
 * chars to prevent injection or abuse of the system prompt.
 */
function buildUserContext(displayName?: string): string | null {
  if (!displayName) return null;
  const normalized = displayName
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 60);
  return normalized ? `User display name: ${normalized}` : null;
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
 *   6. User display name — only if from a trusted server-side source
 *
 * The composer does NOT include:
 *   - The conversation history (added by the caller)
 *   - The user message (added by the caller)
 *   - Memory context (added by the caller)
 *   - Any client-provided name (prompt-injection risk)
 */
export function composeSystemPrompt(
  decision: LiTTControlDecision,
  capabilities: CapabilityRecord[],
  options?: PromptComposerOptions,
): string {
  const modeGuidance = MODE_GUIDANCE[decision.routing.mode] ?? MODE_GUIDANCE.think;
  const capabilityBlock = buildCapabilityBlock(capabilities);
  const projectBlock = buildProjectBlock(decision);
  const userBlock = buildUserContext(options?.trustedDisplayName);

  // Adjust voice guidance for voice mode — shorter but still substantive
  const voiceModeNote =
    options?.responseMode === "voice"
      ? `\nRESPONSE MODE: VOICE. Keep responses shorter and conversational (1–3 substantive sentences for greetings), but still informative — never generic readiness.`
      : "";

  const contextLines: string[] = [];
  if (userBlock) contextLines.push(userBlock);
  contextLines.push(projectBlock);
  contextLines.push(capabilityBlock);

  return [
    `# LiTT`,
    ``,
    CONSTITUTION_IDENTITY,
    ``,
    CONSTITUTION_PRINCIPLES,
    ``,
    `# Voice`,
    PERSONA_VOICE,
    voiceModeNote,
    ``,
    `# Mode Guidance`,
    modeGuidance,
    ``,
    `# Context`,
    ...contextLines,
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
