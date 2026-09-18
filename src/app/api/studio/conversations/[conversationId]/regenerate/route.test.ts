// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

/**
 * Regression tests for the regenerate tool-protocol boundary.
 *
 * The /regenerate endpoint is chat-only (generateText — no agent loop, no
 * tools), so a regenerated answer must never persist a pseudo tool call as
 * a completed response: it would imply work was done when nothing executed
 * (the puppet-master defect class). scanRegenerateOutput mirrors the
 * messages V1 lane: fail truthfully on markup with invocation intent,
 * strip-and-persist otherwise.
 */

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/rate-limiter", () => ({ withRateLimit: (handler: any) => handler }));
vi.mock("@/lib/llm", () => ({ generateText: vi.fn() }));
vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: vi.fn(),
  getMessage: vi.fn(),
  listMessages: vi.fn(),
  insertMessage: vi.fn(),
  updateMessageStatus: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/studio/agent-registry", () => ({ resolveAgent: vi.fn() }));
vi.mock("@/lib/studio/project-resolver", () => ({
  buildStudioContext: vi.fn(),
  buildProjectContextBlock: vi.fn(),
}));
vi.mock("@/lib/studio/memory-service", () => ({
  recallMemories: vi.fn(),
  formatMemoryContext: vi.fn(),
}));
vi.mock("@/lib/context/context-engine", () => ({
  buildUserContext: vi.fn(),
  buildContextBlock: vi.fn(),
}));
vi.mock("@/lib/studio/logger", () => ({ studioLog: vi.fn() }));
vi.mock("@/lib/capabilities/translate", () => ({ translateCapabilities: vi.fn() }));
vi.mock("@/lib/litt-kernel", () => ({
  routeKernel: vi.fn(),
  composeSystemPrompt: vi.fn(),
  adaptLegacyCapability: vi.fn(),
}));

import { scanRegenerateOutput } from "./route";

const TOOL_IDS = new Set(["terminal.execute", "files.read", "browser.open"]);

const HONEST_FAILURE =
  "The model produced a tool call in a format this run cannot execute, so nothing was executed.";

describe("scanRegenerateOutput", () => {
  it("fails on XML envelope markup with invocation intent", () => {
    const output =
      "Running that now.\n<tool_call>terminal.execute\n" +
      "<arg_key>command</arg_key><arg_value>ls</arg_value></tool_call>";
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(true);
    expect(result.content).toBe(HONEST_FAILURE);
    expect(result.hit?.kind).toBe("envelope");
    expect(result.hit?.toolId).toBeDefined();
  });

  it("fails on a fenced JSON tool-call payload", () => {
    const output =
      '```tool_call\n{"name": "files.read", "arguments": {"path": "README.md"}}\n```';
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(true);
    expect(result.content).toBe(HONEST_FAILURE);
    expect(result.hit?.kind).toBe("fenced_json");
  });

  it("fails on a truncated envelope (close tag never arrived)", () => {
    const output = "<tool_call>browser.open\n<arg_key>url</arg_key>";
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(true);
    expect(result.content).toBe(HONEST_FAILURE);
  });

  it("passes clean prose through as persistable", () => {
    const output = "Here is the summary you asked for.\n\n- item one\n- item two";
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(false);
    expect(result.hit).toBeUndefined();
    expect(result.content).toBe(output);
  });

  it("passes markup quoted as a prose example without failing", () => {
    const output = "Use backticks like `<tool_call>example</tool_call>` when showing markup.";
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(false);
    expect(result.hit).toBeUndefined();
  });

  it("strips intent-free orphan markup instead of persisting it verbatim", () => {
    const output = "some text <tool_call></tool_call> trailing";
    const result = scanRegenerateOutput(output, TOOL_IDS);

    expect(result.failed).toBe(false);
    expect(result.content).not.toContain("tool_call");
  });

  it("handles empty output without failing", () => {
    const result = scanRegenerateOutput("", TOOL_IDS);
    expect(result.failed).toBe(false);
    expect(result.content).toBe("");
  });
});
