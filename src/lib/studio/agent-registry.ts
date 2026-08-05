import type { AgentSlug, BuiltInAgent, MemoryType } from "./types";
import { LITT, SPARK } from "@/lib/agent-registry";

// Derive from the canonical registry — single source of truth for prompts.
const LITT_SYSTEM_PROMPT = LITT.systemPrompt;
const SPARK_SYSTEM_PROMPT = SPARK.systemPrompt;

export const BUILT_IN_AGENTS: Record<AgentSlug, BuiltInAgent> = {
  litt: {
    slug: "litt",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "code_review", "project_management", "terminal", "github", "deployment"],
    memoryTypes: [
      "user_preference",
      "project_fact",
      "project_decision",
      "architecture",
      "workflow",
      "constraint",
      "conversation_summary",
      "agent_note",
    ],
  },
  spark: {
    slug: "spark",
    displayName: "Spark",
    systemPrompt: SPARK_SYSTEM_PROMPT,
    capabilities: ["chat", "creative", "image", "design"],
    memoryTypes: [
      "user_preference",
      "project_fact",
      "project_decision",
      "conversation_summary",
      "agent_note",
    ],
  },
  // Premium marketplace agents — full-service AI workers.
  nova: {
    slug: "nova",
    displayName: "Nova",
    systemPrompt: "You are Nova — the AI Business Partner inside LiTTree Lab Studios. You are a full-service business companion that helps with research, planning, marketing, operations, analytics, and daily priorities.",
    capabilities: ["chat", "research", "project_management", "marketing"],
    memoryTypes: ["user_preference", "project_fact", "project_decision", "conversation_summary", "agent_note"],
  },
  forge: {
    slug: "forge",
    displayName: "Forge",
    systemPrompt: "You are Forge — the AI Technical Partner inside LiTTree Lab Studios. You are a full-service technical companion that understands codebases, plans features, writes and reviews code, and manages deployments.",
    capabilities: ["chat", "code_review", "terminal", "github", "deployment"],
    memoryTypes: ["user_preference", "project_fact", "project_decision", "architecture", "workflow", "constraint", "conversation_summary", "agent_note"],
  },
  echo: {
    slug: "echo",
    displayName: "Echo",
    systemPrompt: "You are Echo — the AI Creative Partner inside LiTTree Lab Studios. You are a full-service creative companion that learns brand voice, plans content, creates media, and maintains content workflows.",
    capabilities: ["chat", "creative", "image", "design"],
    memoryTypes: ["user_preference", "project_fact", "project_decision", "conversation_summary", "agent_note"],
  },
  // Legacy agent slugs — kept for backward compatibility with existing
  // conversations. Coding and research requests route to LiTT.
  researcher: {
    slug: "researcher",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "code_review", "project_management", "terminal", "github", "deployment"],
    memoryTypes: ["user_preference", "project_fact", "conversation_summary", "agent_note"],
  },
  writer: {
    slug: "writer",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "code_review", "project_management"],
    memoryTypes: ["user_preference", "project_fact", "conversation_summary", "agent_note"],
  },
  marketer: {
    slug: "marketer",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "project_management"],
    memoryTypes: ["user_preference", "project_fact", "conversation_summary", "agent_note"],
  },
  coder: {
    slug: "coder",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "code_review", "terminal", "github", "deployment"],
    memoryTypes: [
      "user_preference",
      "project_fact",
      "project_decision",
      "architecture",
      "workflow",
      "constraint",
      "conversation_summary",
      "agent_note",
    ],
  },
  analyst: {
    slug: "analyst",
    displayName: "LiTT",
    systemPrompt: LITT_SYSTEM_PROMPT,
    capabilities: ["chat", "code_review", "project_management"],
    memoryTypes: ["user_preference", "project_fact", "conversation_summary", "agent_note"],
  },
} as const;

export function resolveAgent(slug: string): BuiltInAgent | null {
  if (slug in BUILT_IN_AGENTS) {
    return BUILT_IN_AGENTS[slug as AgentSlug];
  }
  return null;
}

export function isValidAgentSlug(slug: string): slug is AgentSlug {
  return slug in BUILT_IN_AGENTS;
}

export function getAgentMemoryTypes(slug: AgentSlug): MemoryType[] {
  return BUILT_IN_AGENTS[slug].memoryTypes;
}
