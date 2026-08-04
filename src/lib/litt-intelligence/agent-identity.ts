/**
 * LiTT Agent Identity — Canonical type definitions for agent identity.
 *
 * LiTT is the single primary operating agent. Spark, Builder, and Research
 * are MODES within LiTT, not separate autonomous agents.
 *
 * Every message, run, step, and timeline event must carry:
 *   agent_id    — always "litt" for the builtin operator
 *   agent_mode  — "standard" | "builder" | "research" | "spark"
 *
 * The UI may display mode-specific branding (Spark avatar, accent color),
 * but all execution remains controlled by the LiTT runtime.
 */

/**
 * The canonical agent identifier. Always "litt" for the builtin operator.
 * Marketplace agents use their instance ID as the agent_id.
 */
export type AgentId = string;

/**
 * The mode of operation within LiTT.
 *
 * - "standard" — operational, project-aware, concise, capable of planning and execution
 * - "builder"  — focused on code construction, refactoring, and technical implementation
 * - "research" — focused on research, synthesis, and source-backed analysis
 * - "spark"    — creative director: images, music, video, branding, storytelling
 */
export type AgentMode = "standard" | "builder" | "research" | "spark";

/**
 * All valid agent modes.
 */
export const AGENT_MODES: readonly AgentMode[] = [
  "standard",
  "builder",
  "research",
  "spark",
] as const;

/**
 * Returns true if a value is a valid AgentMode.
 */
export function isValidAgentMode(value: unknown): value is AgentMode {
  return typeof value === "string" && AGENT_MODES.includes(value as AgentMode);
}

/**
 * The canonical LiTT agent ID.
 */
export const LITT_AGENT_ID = "litt" as const;

/**
 * Default agent mode for new conversations and migrated messages.
 */
export const DEFAULT_AGENT_MODE: AgentMode = "standard";

/**
 * Map old agent slugs to agent_mode values.
 * "spark" → spark mode, everything else → standard.
 */
export function slugToMode(slug: string | null | undefined): AgentMode {
  if (slug === "spark") return "spark";
  if (slug === "researcher" || slug === "research") return "research";
  if (slug === "coder" || slug === "builder") return "builder";
  return "standard";
}

/**
 * Map an agent_mode to the old slug for backward-compatible UI rendering.
 * Spark mode → "spark", everything else → "litt".
 */
export function modeToSlug(mode: AgentMode): "litt" | "spark" {
  return mode === "spark" ? "spark" : "litt";
}

/**
 * Display label for an agent mode.
 */
export function modeLabel(mode: AgentMode): string {
  switch (mode) {
    case "standard": return "Standard";
    case "builder": return "Builder";
    case "research": return "Research";
    case "spark": return "Spark Creative";
  }
}

/**
 * Full display label: "LiTT · Spark Mode"
 */
export function modeDisplayLabel(mode: AgentMode): string {
  return `LiTT · ${modeLabel(mode)}`;
}

/**
 * Identity carried through the entire request lifecycle:
 * composer → API → run → memory → stream → message → timeline
 */
export interface AgentIdentity {
  agentId: AgentId;
  agentMode: AgentMode;
  /** Prompt version used for this identity. */
  promptVersion: string;
}

/**
 * Validate and parse an agent identity from a request body.
 * Returns a typed error if identity is missing or invalid.
 */
export function parseAgentIdentity(input: unknown):
  | { ok: true; identity: AgentIdentity }
  | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing agent identity" };
  }
  const obj = input as Record<string, unknown>;
  const agentId = obj.agentId;
  const agentMode = obj.agentMode;

  if (typeof agentId !== "string" || !agentId.trim()) {
    return { ok: false, error: "Missing or invalid agentId" };
  }
  if (!isValidAgentMode(agentMode)) {
    return { ok: false, error: `Invalid agentMode: expected one of ${AGENT_MODES.join(", ")}` };
  }

  return {
    ok: true,
    identity: {
      agentId,
      agentMode,
      promptVersion: typeof obj.promptVersion === "string" ? obj.promptVersion : "1.0.0",
    },
  };
}
