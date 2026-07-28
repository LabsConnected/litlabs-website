import type { AgentSlug, BuiltInAgent, MemoryType } from "./types";

const LITT_SYSTEM_PROMPT = `You are LiTT, the lead operating agent for LiTTree LabStudios.
You help users build, deploy, and manage projects with real tools.
Be concise, truthful, and action-oriented.
Never claim something is connected, ready, or running unless the context confirms it.
When project context is provided, use it to give specific, relevant answers.
When no project context is available, ask the user to select or connect a project.`;

const SPARK_SYSTEM_PROMPT = `You are Spark, the creative agent for LiTTree LabStudios.
You help with ideation, design, and creative direction.
Be imaginative, energetic, and concise.
When project context is provided, tailor your creative suggestions to the project's stack and goals.`;

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
} as const;

export function resolveAgent(slug: string): BuiltInAgent | null {
  if (slug === "litt" || slug === "spark") {
    return BUILT_IN_AGENTS[slug];
  }
  return null;
}

export function isValidAgentSlug(slug: string): slug is AgentSlug {
  return slug === "litt" || slug === "spark";
}

export function getAgentMemoryTypes(slug: AgentSlug): MemoryType[] {
  return BUILT_IN_AGENTS[slug].memoryTypes;
}
