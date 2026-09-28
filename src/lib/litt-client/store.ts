import { createStore, type StoreApi } from "zustand/vanilla";
import type { AgentState } from "./derive-agent-state";

/**
 * Per-instance state for one LiTT App mount.
 *
 * Studio's conversation and execution stores are module-level zustand
 * singletons. This factory never touches them. Two calls return two
 * stores; nothing is shared with `useConversationStore` or
 * `useExecutionStore`.
 *
 * Phase 0 only keeps the handles Phase 1 will fill in: which
 * conversation is open, and the derived agent header state. It does
 * not stream, poll, or call a model.
 */
export interface LittAppState {
  conversationId: string | null;
  agentState: AgentState | null;
  setConversationId: (conversationId: string | null) => void;
  setAgentState: (agentState: AgentState | null) => void;
  reset: () => void;
}

export type LittAppStore = StoreApi<LittAppState>;

export function createLittAppStore(): LittAppStore {
  return createStore<LittAppState>((set) => ({
    conversationId: null,
    agentState: null,
    setConversationId: (conversationId) => set({ conversationId }),
    setAgentState: (agentState) => set({ agentState }),
    reset: () => set({ conversationId: null, agentState: null }),
  }));
}
