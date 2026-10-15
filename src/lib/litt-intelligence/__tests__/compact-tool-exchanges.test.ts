import { describe, it, expect } from "vitest";
import { compactBuildInputs } from "../agent-loop-v2";
import type { LLMMessage } from "../llm-tool-calling";
import type { ToolDefinition } from "../llm-tool-calling";

// Regression tests for P1: "Trimming breaks tool exchanges"
// The old compactBuildInputs used shift() which could orphan tool results.
// New behavior: trim complete assistant/tool groups, preserve latest user request.

describe("compactBuildInputs tool-exchange preservation", () => {
  const toolDefs: ToolDefinition[] = [
    { id: "test_tool", description: "A test tool", inputSchema: {} },
  ];

  const userMsg = (content: string): LLMMessage => ({ role: "user", content });
  const assistantMsg = (content: string): LLMMessage => ({ role: "assistant", content });
  const assistantToolCall = (id: string, name = "test_tool"): LLMMessage => ({
    role: "assistant",
    content: "",
    tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
  });
  const toolResult = (id: string): LLMMessage => ({
    role: "tool",
    content: `Result for ${id}`,
    tool_call_id: id,
  });

  // Helper to make messages large enough to trigger compaction
  const big = (msg: LLMMessage, size = 20000): LLMMessage => ({
    ...msg,
    content: msg.content + "x".repeat(size),
  });

  it("never orphans tool results when trimming", () => {
    const messages: LLMMessage[] = [
      big(userMsg("old question 1")),
      big(assistantToolCall("call_1")),
      big(toolResult("call_1")),
      big(userMsg("old question 2")),
      big(assistantToolCall("call_2")),
      big(toolResult("call_2")),
      userMsg("current request - keep me"),
    ];

    const result = compactBuildInputs("sys", messages, toolDefs, 6000);

    // Verify no orphaned tool results: every tool message must have a
    // preceding assistant message with matching tool_calls
    for (let i = 0; i < result.messages.length; i++) {
      const msg = result.messages[i];
      if (msg.role === "tool" && msg.tool_call_id) {
        // Find the assistant message with this tool call
        const hasParent = result.messages.slice(0, i).some(
          (m) => m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === msg.tool_call_id)
        );
        expect(hasParent, `Orphaned tool result at index ${i} with id ${msg.tool_call_id}`).toBe(true);
      }
    }

    // Current request preserved
    expect(result.messages[result.messages.length - 1].content).toContain("current request");
  });

  it("trims complete assistant+tool groups together", () => {
    const messages: LLMMessage[] = [
      big(userMsg("q1")),
      big(assistantToolCall("c1")),
      big(toolResult("c1")),
      big(toolResult("c1-extra")), // multiple results for one call
      big(userMsg("q2")),
      userMsg("latest"),
    ];

    const result = compactBuildInputs("sys", messages, toolDefs, 6000);

    // If the assistant tool call was trimmed, its tool results must be gone too
    const hasAssistantC1 = result.messages.some(
      (m) => m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === "c1")
    );
    const hasToolC1 = result.messages.some(
      (m) => m.role === "tool" && (m.tool_call_id === "c1" || m.content.includes("c1"))
    );
    // Either both present or both absent — never orphaned
    expect(hasAssistantC1).toBe(hasToolC1);
  });

  it("preserves the latest user request even under extreme pressure", () => {
    const messages: LLMMessage[] = [
      big(userMsg("very old"), 50000),
      big(assistantMsg("old response"), 50000),
      userMsg("CRITICAL: latest user request must survive"),
    ];

    const result = compactBuildInputs("sys", messages, toolDefs, 100);

    expect(result.messages.length).toBeGreaterThan(0);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toContain("CRITICAL");
  });

  it("handles long conversations with multiple tool exchanges", () => {
    const messages: LLMMessage[] = [];
    // Build a long conversation: 5 rounds of user → assistant(tool) → tool result
    for (let i = 0; i < 5; i++) {
      messages.push(big(userMsg(`question ${i}`)));
      messages.push(big(assistantToolCall(`call_${i}`)));
      messages.push(big(toolResult(`call_${i}`)));
    }
    messages.push(userMsg("final question"));

    const result = compactBuildInputs("sys", messages, toolDefs, 6000);

    // No orphans
    for (let i = 0; i < result.messages.length; i++) {
      const msg = result.messages[i];
      if (msg.role === "tool" && msg.tool_call_id) {
        const hasParent = result.messages.slice(0, i).some(
          (m) => m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === msg.tool_call_id)
        );
        expect(hasParent).toBe(true);
      }
    }

    // Final question preserved
    expect(result.messages[result.messages.length - 1].content).toBe("final question");
    expect(result.compacted).toBe(true);
  });

  it("does not compact when under budget", () => {
    const messages: LLMMessage[] = [
      userMsg("hello"),
      assistantMsg("hi there"),
      userMsg("how are you?"),
    ];

    const result = compactBuildInputs("sys", messages, toolDefs, 6000);

    expect(result.compacted).toBe(false);
    expect(result.messages).toHaveLength(3);
  });
});
