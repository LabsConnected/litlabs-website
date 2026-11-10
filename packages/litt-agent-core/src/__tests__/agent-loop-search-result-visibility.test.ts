/**
 * Regression test: search/tool results must actually reach the model and
 * be reflected in the final answer — not just "PASS" in the activity feed.
 *
 * Reported symptom: user asked "What time does bset buy open", Web.Search
 * reported PASS, CLI showed DONE — and the displayed answer never
 * incorporated (or even acknowledged) the search outcome.
 *
 * The contract under test:
 *   1. After a tool executes, its result is appended to the conversation
 *      as a user-role message via renderToolResult — status, message, and
 *      the full data payload (answer/abstract/relatedTopics for web.search).
 *   2. The model's NEXT stream() call receives that message.
 *   3. The final assistant content completes truthfully.
 *
 * The stub search handler returns the same data shape as the real
 * webSearchHandler (realtime.ts) with a distinctive token so we can prove
 * the payload survived the round-trip into the model's context.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  ToolDefinition,
  ToolResult,
  ToolEntry,
} from "../types.js";

const SEARCH_TOKEN = "ZZCAPITAL-7741-ORBITAL";

function makeRegistryWithSearch(): ToolRegistry {
  const def: ToolDefinition = {
    id: "web.search",
    name: "search",
    description: "Search the web (DuckDuckGo Instant Answers)",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    readOnly: true,
  };
  const entry: ToolEntry = {
    definition: def,
    handler: async (_ctx, args): Promise<ToolResult> => {
      const query = typeof args.query === "string" ? args.query : "";
      // Same shape as realtime.ts webSearchHandler success path.
      return {
        status: "success",
        success: true,
        message: `Search results for "${query}"`,
        data: {
          query,
          answer: null,
          abstract: `The capital is Paris. Marker: ${SEARCH_TOKEN}.`,
          abstractSource: "Wikipedia",
          abstractUrl: "https://example.org/capital",
          relatedTopics: [{ text: `Paris is the capital (${SEARCH_TOKEN})`, url: "https://example.org/p" }],
          empty: false,
        },
      };
    },
    metadata: { projectScoped: false, mutating: false, readOnly: true },
  };
  return new ToolRegistry({ "web.search": entry });
}

/** Mock model that records every conversation it is shown. */
function recordingModel(rounds: Array<(messages: ChatMessage[]) => string>): {
  model: ModelProvider;
  seen: ChatMessage[][];
} {
  const seen: ChatMessage[][] = [];
  let call = 0;
  const model: ModelProvider = {
    async stream(
      messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      seen.push(messages.map((m) => ({ ...m })));
      const response = rounds[Math.min(call, rounds.length - 1)](messages);
      call++;
      emit({ type: "delta", text: response });
      return {
        content: response,
        model: "mock",
        provider: "mock",
        usage: { total_tokens: 10 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 1 },
        profile: "fast",
      };
    },
    async health(): Promise<number> {
      return 1;
    },
  };
  return { model, seen };
}

describe("runAgentLoop — tool results reach the model and the answer", () => {
  it("web.search result JSON is appended before the next model call", async () => {
    const tools = makeRegistryWithSearch();
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});

    const { model, seen } = recordingModel([
      // Round 1: model requests the search.
      () => '```tool_call\n{ "tool": "web.search", "inputs": { "query": "capital of France" } }\n```',
      // Round 2: model synthesizes — echoes the token it can only know
      // if the tool result reached its context.
      () => `According to the search, the capital is Paris (${SEARCH_TOKEN}).`,
    ]);

    const result = await runAgentLoop("what is the capital of France", {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "web.search");
    assert.equal(result.toolCalls[0].result.success, true);
    assert.equal(result.termination, "complete");

    // The second model call MUST see the rendered tool result.
    assert.ok(seen.length >= 2, `expected >=2 model calls, saw ${seen.length}`);
    const roundTwo = seen[1];
    const toolResultMsg = roundTwo.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("Tool \"search\" returned:"),
    );
    assert.ok(toolResultMsg, "no user message carrying the tool result reached round 2");
    const content = toolResultMsg!.content as string;
    assert.ok(content.includes(SEARCH_TOKEN), "search payload token missing from tool-result message");
    assert.ok(content.includes('"abstract"'), "abstract field missing from rendered result");
    assert.ok(content.includes('"status": "success"'), "status field missing from rendered result");

    // Ordering: the tool-result message must come AFTER the assistant's
    // tool-call turn, not be lost or reordered.
    const lastAssistantIdx = roundTwo.map((m) => m.role).lastIndexOf("assistant");
    const resultIdx = roundTwo.indexOf(toolResultMsg!);
    assert.ok(resultIdx > lastAssistantIdx, "tool result must follow the assistant tool-call turn");

    // The final answer reflects what the search returned.
    assert.ok(result.content.includes(SEARCH_TOKEN), `final answer lost the search data: ${JSON.stringify(result.content)}`);
  });

  it("a failed search reaches the model as an explicit failure, not silence", async () => {
    const def: ToolDefinition = {
      id: "web.search",
      name: "search",
      description: "Search the web",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
      readOnly: true,
    };
    const entry: ToolEntry = {
      definition: def,
      handler: async (): Promise<ToolResult> => ({
        status: "failed",
        success: false,
        message: "network unreachable",
        data: { query: "anything" },
      }),
      metadata: { projectScoped: false, mutating: false, readOnly: true },
    };
    const tools = new ToolRegistry({ "web.search": entry });
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});

    const { model, seen } = recordingModel([
      () => '```tool_call\n{ "tool": "web.search", "inputs": { "query": "x" } }\n```',
      () => "The search failed, so I cannot confirm that.",
    ]);

    const result = await runAgentLoop("search for x", {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 5,
    });

    const roundTwo = seen[1];
    const toolResultMsg = roundTwo.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("network unreachable"),
    );
    assert.ok(toolResultMsg, "failed tool result never reached the model");
    assert.ok(
      (toolResultMsg!.content as string).includes('"status": "failed"'),
      "failure status not rendered to the model",
    );
    assert.equal(result.toolCalls[0].result.success, false);
  });
});
