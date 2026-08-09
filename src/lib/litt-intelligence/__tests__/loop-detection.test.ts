import { describe, it, expect } from "vitest";

// Extract the loop detection function for testing
// We replicate it here to test the logic without importing server-only modules

interface ToolCallRecord {
  toolId: string;
  inputsHash: string;
  resultHash: string;
  step: number;
}

function detectRepeatedCalls(
  records: ToolCallRecord[],
  currentToolId: string,
  currentInputsHash: string,
  hasInterveningMutation: boolean,
): boolean {
  if (hasInterveningMutation) return false;

  const identical = records.filter(
    (r) => r.toolId === currentToolId && r.inputsHash === currentInputsHash,
  );

  return identical.length >= 3;
}

describe("Loop detection", () => {
  it("does not cancel on first identical call", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"foo.ts"}', false)).toBe(false);
  });

  it("does not cancel on second identical call", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 2 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"foo.ts"}', false)).toBe(false);
  });

  it("cancels on third identical call (no intervening mutation)", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 2 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 3 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"foo.ts"}', false)).toBe(true);
  });

  it("does not cancel if there was an intervening mutation", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 2 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 3 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"foo.ts"}', true)).toBe(false);
  });

  it("does not cancel for different tools with same inputs", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 2 },
      { toolId: "git.status", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 3 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"foo.ts"}', false)).toBe(false);
  });

  it("does not cancel for same tool with different inputs", () => {
    const records: ToolCallRecord[] = [
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 1 },
      { toolId: "files.read", inputsHash: '{"path":"foo.ts"}', resultHash: "abc", step: 2 },
      { toolId: "files.read", inputsHash: '{"path":"bar.ts"}', resultHash: "def", step: 3 },
    ];
    expect(detectRepeatedCalls(records, "files.read", '{"path":"bar.ts"}', false)).toBe(false);
  });
});
