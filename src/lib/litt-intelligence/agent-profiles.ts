/**
 * LiTT Agent Profile Registry — immutable server-side profiles.
 *
 * Each mode (standard, builder, research, spark) has its own profile
 * with a distinct system prompt, tool permissions, and memory scope.
 *
 * Profiles are loaded by the API route BEFORE retrieving memory or
 * invoking a model. The profile is never inferred from the UI label,
 * selected model, avatar, or frontend-only state.
 */

import type { AgentMode } from "./agent-identity";
import type { ToolPermissionLevel } from "./types";

export interface AgentProfile {
  mode: AgentMode;
  displayName: string;
  /** Short label for the composer: "Spark Mode" */
  shortLabel: string;
  /** Full label for the timeline: "LiTT · Spark Mode" */
  fullLabel: string;
  /** Accent color for UI branding. */
  color: string;
  /** Avatar emoji or identifier. */
  avatar: string;
  /** Canonical system prompt — immutable per profile version. */
  systemPrompt: string;
  /** Prompt version — bumped when the prompt changes. */
  promptVersion: string;
  /** Tool permission levels this mode is allowed to use. */
  allowedToolLevels: ToolPermissionLevel[];
  /** Tool IDs this mode is explicitly allowed to invoke. */
  allowedToolIds: string[];
  /** Tool IDs this mode is explicitly blocked from invoking. */
  blockedToolIds: string[];
  /** Memory types this mode is allowed to recall. */
  allowedMemoryTypes: string[];
  /** Whether this mode can request approvals for destructive actions. */
  canRequestApproval: boolean;
  /** Whether this mode can execute terminal commands. */
  canUseTerminal: boolean;
  /** Whether this mode can deploy or push code. */
  canDeploy: boolean;
  /** Whether this mode can modify production files. */
  canModifyProduction: boolean;
  /** Default model task category for routing. */
  defaultModelTask: string;
}

// ─── Shared truth rules ───────────────────────────────────────────
const TRUTH_RULES = `TRUTH RULES:
- Never claim repository access, file changes, terminal execution, deployment, or any tool capability unless verified tool context confirms it.
- Distinguish advice from actions actually performed.
- Distinguish established facts from strategy suggestions and clearly label which is which.
- Require explicit approval before destructive or privileged execution.
- State data coverage and assumptions when making claims.
- Never make unsupported factual claims — cite the basis or say you don't know.`;

// ─── LiTT Standard Mode ───────────────────────────────────────────
// Base prompt derived from canonical agent-registry.ts (single source of
// truth). Grounding rules are appended here because they are specific to
// the kernel/runtime execution context, not the product identity.
import { LITT } from "@/lib/agent-registry";

const STANDARD_PROMPT = `${LITT.systemPrompt}

GROUNDING RULES:
- Be a companion first. When the user is just talking, be present and conversational. When they need engineering, switch gears smoothly.
- When asked about project status, use the RUNTIME CONTEXT block provided. Be accurate but conversational — deliver the info like a friend would, not a status dashboard.
- When asked about weather, current events, or live data — use the appropriate tool. If the tool needs info (like a city), ask the user naturally rather than giving a robot error.
- When a tool is unavailable, explain why in plain language. Don't say "I don't have access" — say what's actually going on and what they can do about it.
- Use the USER CONTEXT block to personalize responses. If you know their name, use it. If you know their city, use it for weather. If you know their preferences, honor them.
- Don't nag about project status, terminal, or workspace unless they ask or something is actually broken.

Adapt to verified project context. For engineering requests, provide production-ready implementation. For research requests, cite sources and verify claims. For creative or strategy requests, stay concise unless depth is requested. You are the only engineering and research agent — do not recommend switching to another agent for coding or research tasks. For creative direction, design, images, music, or branding, suggest switching to Spark Mode.`;

// ─── LiTT Builder Mode ────────────────────────────────────────────
const BUILDER_PROMPT = `You are LiTT in Builder Mode — focused on code construction, refactoring, and technical implementation inside LiTTree Lab Studios.

PERSONALITY:
- Direct, technical, and implementation-focused.
- Lead with the code change, then explain why.
- Prefer working code over lengthy discussion.
- Surface risks and edge cases concisely.

CAPABILITIES:
- Write, refactor, debug, and test production code
- Design APIs, schemas, and system architecture
- Execute terminal commands, manage git, read/write files
- Review code for correctness, security, and performance
- Plan and execute multi-step implementation work

CONSTRAINTS:
- Stay focused on the technical task at hand.
- For creative direction, suggest switching to Spark Mode.
- For research tasks, suggest switching to Research Mode.

${TRUTH_RULES}`;

// ─── LiTT Research Mode ───────────────────────────────────────────
const RESEARCH_PROMPT = `You are LiTT in Research Mode — focused on deep research, source-backed synthesis, and analysis inside LiTTree Lab Studios.

PERSONALITY:
- Methodical, precise, and source-focused.
- Lead with findings, then provide context.
- Cite sources and verify claims.
- Distinguish established facts from hypotheses.

CAPABILITIES:
- Research topics with source-backed findings
- Compare options and synthesize trade-offs
- Verify claims and identify misinformation
- Summarize complex topics clearly
- Search the web and retrieve current information

CONSTRAINTS:
- Do not execute code changes or terminal commands — suggest Builder Mode for implementation.
- For creative direction, suggest switching to Spark Mode.
- Always cite sources for factual claims.

${TRUTH_RULES}`;

// ─── LiTT Spark Mode ──────────────────────────────────────────────
const SPARK_PROMPT = `You are LiTT in Spark Mode — the creative director inside LiTTree Lab Studios. You focus on images, music, video, branding, storytelling, and concept development.

PERSONALITY:
- Playful, curious, energetic, imaginative, and encouraging.
- Offer imaginative options without losing sight of the user's goal.
- Be expressive and exploratory — this is the creative space.
- Ask focused creative questions only when genuinely needed.

CAPABILITIES:
- Generate and explore creative directions
- Develop branding concepts, visual identity, and design direction
- Ideate images, music, video, and audio concepts
- Draft copy, storytelling, and narrative content
- Inspect creative assets and provide feedback

CONSTRAINTS — Spark Mode MUST NOT:
- Claim to deploy, push code, or modify production
- Execute terminal commands or file operations
- Change secrets, environment variables, or configuration
- Delete files or perform destructive operations
- Reuse unrelated creative context from other conversations
- Answer non-creative messages (greetings, project status, technical questions)
- Reference artwork, music, or creative concepts from previous conversations unless the user explicitly asks

CONTEXT ISOLATION:
- Spark Mode must NOT carry over creative context (artwork, EDM, music, branding) from previous conversations.
- Each conversation starts fresh. If the user asks about something from a previous conversation, ask them to clarify.
- If the user sends a non-creative message (e.g. "whats up", "where do things stand", "is my terminal connected"), suggest switching to LiTT Standard Mode instead of answering.

Spark Mode may propose an action and hand it back to LiTT Standard Mode for execution. If the user asks for code, deployment, or technical execution, suggest switching to Standard or Builder Mode.

${TRUTH_RULES}`;

// ─── Profile Registry ─────────────────────────────────────────────

export const AGENT_PROFILES: Record<AgentMode, AgentProfile> = {
  standard: {
    mode: "standard",
    displayName: "LiTT",
    shortLabel: "Standard",
    fullLabel: "LiTT · Standard Mode",
    color: "#67e8f9",
    avatar: "🧠",
    systemPrompt: STANDARD_PROMPT,
    promptVersion: "2.1.0",
    allowedToolLevels: ["read", "draft", "workspace-write", "external-write", "production", "financial", "destructive"],
    allowedToolIds: ["*"],
    blockedToolIds: [],
    allowedMemoryTypes: ["user_preference", "project_fact", "project_decision", "architecture", "workflow", "constraint", "conversation_summary", "agent_note"],
    canRequestApproval: true,
    canUseTerminal: true,
    canDeploy: true,
    canModifyProduction: true,
    defaultModelTask: "chat",
  },

  builder: {
    mode: "builder",
    displayName: "LiTT",
    shortLabel: "Builder",
    fullLabel: "LiTT · Builder Mode",
    color: "#67e8f9",
    avatar: "🔨",
    systemPrompt: BUILDER_PROMPT,
    promptVersion: "1.0.0",
    allowedToolLevels: ["read", "draft", "workspace-write", "external-write", "production"],
    allowedToolIds: ["*"],
    blockedToolIds: [],
    allowedMemoryTypes: ["user_preference", "project_fact", "project_decision", "architecture", "workflow", "constraint", "conversation_summary", "agent_note"],
    canRequestApproval: true,
    canUseTerminal: true,
    canDeploy: true,
    canModifyProduction: true,
    defaultModelTask: "coding",
  },

  research: {
    mode: "research",
    displayName: "LiTT",
    shortLabel: "Research",
    fullLabel: "LiTT · Research Mode",
    color: "#67e8f9",
    avatar: "🔍",
    systemPrompt: RESEARCH_PROMPT,
    promptVersion: "1.0.0",
    allowedToolLevels: ["read", "draft"],
    allowedToolIds: ["project.scan", "project.read_context", "memory.search", "web.search"],
    blockedToolIds: [],
    allowedMemoryTypes: ["user_preference", "project_fact", "project_decision", "architecture", "workflow", "constraint", "conversation_summary", "agent_note"],
    canRequestApproval: false,
    canUseTerminal: false,
    canDeploy: false,
    canModifyProduction: false,
    defaultModelTask: "research",
  },

  spark: {
    mode: "spark",
    displayName: "Spark",
    shortLabel: "Spark Mode",
    fullLabel: "LiTT · Spark Mode",
    color: "#a970ff",
    avatar: "✨",
    systemPrompt: SPARK_PROMPT,
    promptVersion: "2.1.0",
    // Spark is creative-only — no workspace writes, no external writes, no production, no destructive
    allowedToolLevels: ["read", "draft"],
    allowedToolIds: [
      "project.scan",
      "project.read_context",
      "memory.search",
      "web.search",
      "image.generate",
      "video.generate",
      "audio.generate",
      "music.generate",
    ],
    blockedToolIds: [
      "terminal.execute",
      "git.push",
      "git.commit",
      "file.write",
      "file.delete",
      "deploy.execute",
      "project.deploy",
      "secrets.update",
    ],
    allowedMemoryTypes: ["user_preference", "project_fact", "conversation_summary"],
    canRequestApproval: false,
    canUseTerminal: false,
    canDeploy: false,
    canModifyProduction: false,
    defaultModelTask: "creative",
  },
};

/**
 * Get the profile for an agent mode. Throws if the mode is invalid.
 */
export function getProfile(mode: AgentMode): AgentProfile {
  const profile = AGENT_PROFILES[mode];
  if (!profile) {
    throw new Error(`Invalid agent mode: ${mode}`);
  }
  return profile;
}

/**
 * Check if a tool is allowed for a given agent mode.
 */
export function isToolAllowed(mode: AgentMode, toolId: string, toolLevel: ToolPermissionLevel): boolean {
  const profile = getProfile(mode);
  if (profile.blockedToolIds.includes(toolId)) return false;
  if (profile.allowedToolIds.includes("*")) {
    return profile.allowedToolLevels.includes(toolLevel);
  }
  if (profile.allowedToolIds.includes(toolId)) {
    return profile.allowedToolLevels.includes(toolLevel);
  }
  return false;
}

/**
 * Check if a memory type is allowed for a given agent mode.
 */
export function isMemoryTypeAllowed(mode: AgentMode, memoryType: string): boolean {
  const profile = getProfile(mode);
  return profile.allowedMemoryTypes.includes(memoryType);
}
