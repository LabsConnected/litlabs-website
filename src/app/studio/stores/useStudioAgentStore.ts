import { create } from "zustand";
import type { ArtifactAction } from "@/lib/canvas/types";
import {
  AGENT_DEFINITIONS,
  type AgentDefinition,
} from "@/lib/agent-registry";
import type { PlanId } from "@/config/plans";
import type { AgentMode } from "@/lib/studio/types";

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
  id?: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "streaming" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  agentSlug?: string | null;
  /** Agent mode that produced this message. Preserved across mode switches. */
  agentMode?: AgentMode | null;
  createdAt?: number;
  images?: string[];
  /** Canvas actions proposed by LiTT alongside this response. */
  actions?: ArtifactAction[];
  /** Provider reasoning/thinking trace (client-side only, not persisted). */
  reasoning?: string;
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
    placeholder: `Ask ${def.name} anything…`,
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
  /** Active agent mode — the operational profile within LiTT. */
  activeAgentMode: AgentMode;
  /** Private agent instance ID (user_agents.id) when a marketplace agent is selected. */
  activeAgentInstanceId: string | null;
  /** V2 execution mode: "auto" auto-approves safe ops, "act" requires approval for mutations. */
  executionMode: "auto" | "act";
  setActiveAgent: (id: AgentId) => void;
  /** Set the active agent mode — only affects future messages. */
  setActiveAgentMode: (mode: AgentMode) => void;
  /** Select a marketplace agent instance by its private user_agents.id. */
  setActiveAgentInstance: (instanceId: string | null, fallbackSlug?: AgentId) => void;
  /** Set the V2 execution mode (auto/act). */
  setExecutionMode: (mode: "auto" | "act") => void;
}

export const useStudioAgentStore = create<StudioAgentStore>((set) => ({
  activeAgentId: "litt",
  activeAgentMode: "standard",
  activeAgentInstanceId: null,
  executionMode: "auto",

  setActiveAgent: (activeAgentId) => set({
    activeAgentId,
    activeAgentInstanceId: null,
    // Sync mode with slug — "spark" → spark mode, everything else → standard
    activeAgentMode: activeAgentId === "spark" ? "spark" : "standard",
  }),

  setActiveAgentMode: (mode) => set({
    activeAgentMode: mode,
    // Sync slug with mode — spark mode → "spark", everything else → "litt"
    activeAgentId: mode === "spark" ? "spark" as AgentId : "litt" as AgentId,
  }),

  setActiveAgentInstance: (instanceId, fallbackSlug) =>
    set({
      activeAgentInstanceId: instanceId,
      // Keep the slug in sync for UI display, but the server will use the instance ID
      activeAgentId: fallbackSlug ?? "litt",
      // Marketplace agents always run in standard mode
      activeAgentMode: "standard",
    }),

  setExecutionMode: (executionMode) => set({ executionMode }),
}));
