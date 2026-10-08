import { describe, expect, it } from "vitest";
import { compactBuildInputs, instrumentInputBudget } from "../build-input-compaction";
import type { LLMMessage, ToolDefinition } from "../llm-tool-calling";

const defs: ToolDefinition[] = [
  { id: "files.write", description: "Write a file", inputSchema: {} },
  { id: "terminal.execute", description: "Execute an approved command", inputSchema: {} },
  { id: "test.run", description: "Run tests", inputSchema: {} },
];
const assistantCall = (id: string, name: string): LLMMessage => ({
  role: "assistant",
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: "{}" } }],
});
const result = (id: string, content: string): LLMMessage => ({
  role: "tool", tool_call_id: id, content,
});

describe("real BUILD input compaction", () => {
  it("preserves the original user request even when the last message is a tool result", () => {
    const request = "Edit the page and run the project's test command";
    const messages: LLMMessage[] = [
      { role: "user", content: "old request " + "o".repeat(3500) },
      { role: "assistant", content: "old reply " + "r".repeat(3500) },
      { role: "user", content: request },
      assistantCall("write-1", "files.write"),
      result("write-1", "file edit complete"),
      assistantCall("test-1", "terminal.execute"),
      result("test-1", "tests passed"),
    ];
    const c = compactBuildInputs("system", messages, defs, 300, 2);
    expect(c.compacted).toBe(true);
    expect(c.budget.totalTokens).toBeLessThanOrEqual(300);
    expect(c.messages).toContainEqual(messages[2]);
    expect(c.messages.at(-1)).toEqual(messages.at(-1));
    expect(c.messages.map((m) => m.tool_call_id).filter(Boolean)).toContain("test-1");
    expect(c.messages.some((m) => m.tool_calls?.[0]?.id === "test-1")).toBe(true);
  });

  it("never leaves an orphan result after trimming an assistant/tool exchange", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "Edit and then test" },
      assistantCall("old-write", "files.write"),
      result("old-write", "x".repeat(5000)),
      assistantCall("new-test", "test.run"),
      result("new-test", "one test passed"),
    ];
    const c = compactBuildInputs("system", messages, defs, 170, 0);
    expect(c.budget.totalTokens).toBeLessThanOrEqual(170);
    expect(c.messages.some((m) => m.tool_call_id === "old-write")).toBe(false);
    for (const message of c.messages.filter((m) => m.role === "tool")) {
      expect(c.messages.some((m) => m.tool_calls?.some((tc) => tc.id === message.tool_call_id))).toBe(true);
    }
    expect(c.messages.some((m) => m.tool_call_id === "new-test")).toBe(true);
  });

  it("keeps all tools and both edit and terminal calls in one non-compacted run", () => {
    const messages: LLMMessage[] = [
      { role: "user", content: "Edit index.tsx, then execute pnpm test" },
      assistantCall("w1", "files.write"),
      result("w1", "file written"),
      assistantCall("t1", "terminal.execute"),
      result("t1", "test passed"),
    ];
    const c = compactBuildInputs("system", messages, defs, 6000, 0);
    expect(c.compacted).toBe(false);
    expect(c.messages).toEqual(messages);
    expect(c.budget.toolTokens).toBe(instrumentInputBudget("system", messages, defs).toolTokens);
    expect(defs.map((t) => t.id)).toEqual(["files.write", "terminal.execute", "test.run"]);
  });

  it("preserves complete multi-tool assistant batches", () => {
    const batch: LLMMessage = {
      role: "assistant", content: "",
      tool_calls: [
        { id: "a", type: "function", function: { name: "files.write", arguments: "{}" } },
        { id: "b", type: "function", function: { name: "test.run", arguments: "{}" } },
      ],
    };
    const messages: LLMMessage[] = [
      { role: "user", content: "old " + "x".repeat(3000) },
      batch, result("a", "edited"), result("b", "passed"),
      { role: "user", content: "new request" },
    ];
    const c = compactBuildInputs("sys", messages, defs, 150, 4);
    // The tool batch (assistant + results) is preserved as an indivisible group,
    // along with the final user request. Only the oversized old message is dropped.
    expect(c.messages).toEqual([messages[1], messages[2], messages[3], messages[4]]);
    expect(c.budget.totalTokens).toBeLessThanOrEqual(150);
  });

  it("flags unshrinkable fixed budgets instead of claiming compliance", () => {
    const system = "x".repeat(16_000);
    const tools: ToolDefinition[] = [{ id: "huge", description: "y".repeat(12_000), inputSchema: {} }];
    const messages: LLMMessage[] = [{ role: "user", content: "Build a page" }];
    const c = compactBuildInputs(system, messages, tools, 6000, 0);
    expect(c.exceedsFixedBudget).toBe(true);
    expect(c.budget.totalTokens).toBeGreaterThan(6000);
    expect(c.messages).toEqual(messages);
  });
});
