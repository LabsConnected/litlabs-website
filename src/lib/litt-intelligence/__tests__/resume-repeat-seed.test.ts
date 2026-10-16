/**
 * Gate B regression (2026-10-13): repeated-call detection must survive
 * approval pauses. The resume loop used to restart its ToolCallRecord
 * ledger empty, so a model retrying a failing approval-gated tool
 * re-entered the gate on every resume (preview.launch was approved
 * seven times in one staging run). seedToolCallRecordsFromHistory
 * rebuilds the ledger from the paused run's messages.
 */
import { describe, it, expect } from "vitest";
import { seedToolCallRecordsFromHistory, hasSuccessfulFileWriteInHistory } from "../agent-loop-v2";
import type { LLMMessage } from "../llm-tool-calling";

function assistantCall(id: string, wireName: string, args: Record<string, unknown>): LLMMessage {
  return {
    role: "assistant",
    content: "",
    tool_calls: [
      { id, type: "function", function: { name: wireName, arguments: JSON.stringify(args) } },
    ],
  };
}

function toolResult(id: string, content: string): LLMMessage {
  return { role: "tool", content, tool_call_id: id };
}

describe("seedToolCallRecordsFromHistory", () => {
  it("credits only a successful structured file result", () => {
    const call = assistantCall("write-1", "files_write", { path: "index.html", content: "<html/>" });
    expect(hasSuccessfulFileWriteInHistory([call, toolResult("write-1", '{"success":true}')])).toBe(true);
    expect(hasSuccessfulFileWriteInHistory([call, toolResult("write-1", 'Error: denied')])).toBe(false);
    expect(hasSuccessfulFileWriteInHistory([call, toolResult("write-1", '{"success":false}')])).toBe(false);
    expect(hasSuccessfulFileWriteInHistory([call, { role: "assistant", content: "Done, wrote index.html" }])).toBe(false);
  });
  it("rebuilds records for executed calls with registry tool ids", () => {
    const history: LLMMessage[] = [
      { role: "user", content: "Build a Hello Gate 3 webpage" },
      assistantCall("c1", "preview_launch", {}),
      toolResult("c1", "Error: Preview start failed (403): HOST_EXECUTION_DISABLED"),
      assistantCall("c2", "preview_launch", {}),
      toolResult("c2", "Error: Preview start failed (403): HOST_EXECUTION_DISABLED"),
      assistantCall("c3", "preview_launch", {}),
      toolResult("c3", "Error: Preview start failed (403): HOST_EXECUTION_DISABLED"),
    ];
    const records = seedToolCallRecordsFromHistory(history);
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.toolId === "preview.launch")).toBe(true);
    // Identical inputs → identical hashes: the detector can now fire.
    expect(new Set(records.map((r) => r.inputsHash)).size).toBe(1);
  });

  it("excludes gated calls that never executed (no tool result)", () => {
    const history: LLMMessage[] = [
      assistantCall("c1", "files_write", { path: "index.html", content: "<html/>" }),
      toolResult("c1", "{\"success\":true}"),
      // The gated call the run paused on: present as a tool call, but no
      // result exists yet — it must not be counted as an execution.
      assistantCall("c2", "preview_launch", {}),
    ];
    const records = seedToolCallRecordsFromHistory(history);
    expect(records).toHaveLength(1);
    expect(records[0].toolId).toBe("files.write");
  });

  it("distinguishes different inputs", () => {
    const history: LLMMessage[] = [
      assistantCall("c1", "files_read", { path: "a.html" }),
      toolResult("c1", "aaa"),
      assistantCall("c2", "files_read", { path: "b.html" }),
      toolResult("c2", "bbb"),
    ];
    const records = seedToolCallRecordsFromHistory(history);
    expect(records).toHaveLength(2);
    expect(records[0].toolId).toBe("files.read");
    expect(records[0].inputsHash).not.toBe(records[1].inputsHash);
  });

  it("returns an empty ledger for a fresh conversation", () => {
    expect(seedToolCallRecordsFromHistory([{ role: "user", content: "hi" }])).toEqual([]);
  });
});
