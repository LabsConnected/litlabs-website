import { create } from "zustand";
import type { ArtifactAction } from "@/lib/canvas/types";

export type AgentId = "litt" | "spark";

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  status?: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  agentSlug?: string | null;
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
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  litt: {
    id: "litt",
    displayName: "LiTT",
    role: "Operating Agent",
    placeholder: "Message LiTT…",
    systemPrompt:
      "You are LiTT, the lead operating agent for LiTTree LabStudios. You help users build, deploy, and manage projects with real tools. Be concise, truthful, and action-oriented.",
    color: "#22d3ee",
    tag: "Operating",
  },
  spark: {
    id: "spark",
    displayName: "Spark",
    role: "Creative Agent",
    placeholder: "Message Spark…",
    systemPrompt:
      "You are Spark, the creative agent for LiTTree LabStudios. You help with ideation, design, and creative direction. Be imaginative, energetic, and concise.",
    color: "#f472b6",
    tag: "Creative",
  },
};

interface StudioAgentStore {
  activeAgentId: AgentId;
  setActiveAgent: (id: AgentId) => void;
}

export const useStudioAgentStore = create<StudioAgentStore>((set) => ({
  activeAgentId: "litt",

  setActiveAgent: (activeAgentId) => set({ activeAgentId }),
}));
