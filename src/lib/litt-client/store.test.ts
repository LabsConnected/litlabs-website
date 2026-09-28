import { describe, expect, it } from "vitest";
import { useConversationStore } from "@/app/(app)/studio/stores/useConversationStore";
import { useExecutionStore } from "@/app/(app)/studio/stores/useExecutionStore";
import { deriveAgentState } from "./derive-agent-state";
import { createLittAppStore } from "./store";

describe("createLittAppStore", () => {
  it("gives each caller its own store and does not touch Studio singletons", () => {
    const studioConversation = useConversationStore.getState().selectedConversationId;
    const studioPhase = useExecutionStore.getState().phase;

    const first = createLittAppStore();
    const second = createLittAppStore();
    first.getState().setConversationId("conv-a");
    first.getState().setAgentState(deriveAgentState({ messageStatus: "streaming" }));

    expect(first.getState().conversationId).toBe("conv-a");
    expect(first.getState().agentState).toMatchObject({ kind: "working", label: "Working" });
    expect(second.getState().conversationId).toBeNull();
    expect(second.getState().agentState).toBeNull();

    second.getState().reset();
    expect(first.getState().conversationId).toBe("conv-a");

    expect(useConversationStore.getState().selectedConversationId).toBe(studioConversation);
    expect(useExecutionStore.getState().phase).toBe(studioPhase);
    expect(first).not.toBe(useConversationStore);
    expect(first).not.toBe(useExecutionStore);
  });
});
