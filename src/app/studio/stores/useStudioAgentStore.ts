import { create } from "zustand";
import type { ArtifactAction } from "@/lib/canvas/types";
import {
  AGENT_DEFINITIONS,
  type AgentDefinition,
} from "@/lib/agent-registry";
import type { PlanId } from "@/config/plans";

export type AgentId =
  | "litt"
  | "spark"
  | "researcher"
  | "writer"
  | "marketer"
  | "coder"
  | "analyst"
  | "nova"
  | "forge"
  | "echo";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  images?: string[];
  /** Canvas actions proposed by LiTT alongside this response. */
  actions?: ArtifactAction[];
}

export interface AgentMeta {
  id: AgentId;
  displayName: string;
  systemPrompt: string;
  color: string;
  tag: string;
  role: string;
  placeholder: string;
  /** Minimum plan required to use this agent. */
  minimumPlan: PlanId;
  /** Short description for the selector tooltip / locked card. */
  description: string;
  /** Starter actions shown in the empty state. */
  starterActions: { label: string; prompt: string }[];
}

/** Derive the studio agent metadata from the canonical registry. */
function definitionToMeta(def: AgentDefinition): AgentMeta {
  return {
    id: def.id as AgentId,
    displayName: def.name,
    systemPrompt: def.systemPrompt,
    color: def.color,
    tag: def.tag,
    role: def.role,
    placeholder: `Message ${def.name}…`,
    minimumPlan: def.minimumPlan,
    description: def.description,
    starterActions: def.starterActions,
  };
}

export const AGENT_META: Record<AgentId, AgentMeta> = Object.fromEntries(
  AGENT_DEFINITIONS.filter((d) => d.studioVisible).map((d) => [
    d.id,
    definitionToMeta(d),
  ]),
) as Record<AgentId, AgentMeta>;

export const STUDIO_AGENTS: AgentMeta[] = AGENT_DEFINITIONS.filter(
  (d) => d.studioVisible,
).map(definitionToMeta);

interface StudioAgentStore {
  activeAgentId: AgentId;
  /** Private agent instance ID (user_agents.id) when a marketplace agent is selected. */
  activeAgentInstanceId: string | null;
  setActiveAgent: (id: AgentId) => void;
  /** Select a marketplace agent instance by its private user_agents.id. */
  setActiveAgentInstance: (instanceId: string | null, fallbackSlug?: AgentId) => void;
}

export const useStudioAgentStore = create<StudioAgentStore>((set) => ({
  activeAgentId: "litt",
  activeAgentInstanceId: null,

  setActiveAgent: (activeAgentId) => set({ activeAgentId, activeAgentInstanceId: null }),

  setActiveAgentInstance: (instanceId, fallbackSlug) =>
    set({
      activeAgentInstanceId: instanceId,
      // Keep the slug in sync for UI display, but the server will use the instance ID
      activeAgentId: fallbackSlug ?? "litt",
    }),
}));
