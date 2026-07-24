import { create } from "zustand";

export type AgentId = "litt" | "spark";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  images?: string[];
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
  threads: Record<AgentId, ChatMessage[]>;
  setActiveAgent: (id: AgentId) => void;
  setMessages: (
    agentId: AgentId,
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[]),
  ) => void;
  clearThread: (agentId: AgentId) => void;
}

export const useStudioAgentStore = create<StudioAgentStore>((set) => ({
  activeAgentId: "litt",
  threads: { litt: [], spark: [] },

  setActiveAgent: (activeAgentId) => set({ activeAgentId }),

  setMessages: (agentId, updater) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [agentId]:
          typeof updater === "function"
            ? (updater as (prev: ChatMessage[]) => ChatMessage[])(state.threads[agentId] ?? [])
            : updater,
      },
    })),

  clearThread: (agentId) =>
    set((state) => ({
      threads: { ...state.threads, [agentId]: [] },
    })),
}));
