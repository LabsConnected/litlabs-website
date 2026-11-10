/**
 * Regression test for the "DONE with no visible answer" bug.
 *
 * Observed symptom (reported against the CLI CHAT lane): the user asked
 * "What time does bset buy open", a tool reported PASS, the activity
 * feed showed DONE — and no answer ever appeared. The persisted session
 * transcript (~/.litt/sessions.json) recorded the assistant content as
 * literally "```json\n```" with status "complete".
 *
 * Root cause: the agent loop's empty-response guard checks
 * `modelContent.trim()` — the RAW model output. A response consisting
 * solely of an empty fenced block ("```json\n```") is non-empty raw
 * text, so it passed the guard. `stripToolCallBlocks` removed tool-call
 * markup but kept generic empty fences, so `cleanContent` was the same
 * markup residue — returned with termination "complete". The UI then
 * rendered an empty code fence: DONE displayed, zero answer visible.
 *
 * The fix has two parts:
 *   1. stripToolCallBlocks removes empty fenced blocks (they carry zero
 *      information — never a real answer).
 *   2. The no-tool-call branch treats a blank cleanContent exactly like
 *      an empty model response: retry with an explicit instruction,
 *      then return an honest error — never "complete".
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop, stripToolCallBlocks } from "../agent-loop.js";
import { ToolRegistry } from "../tools.js";
import type {
  ModelProvider,
  ChatMessage,
  ModelStreamEvent,
  ModelResult,
} from "../types.js";

// ─── Mock helpers (mirrors redundant-tool-call.test.ts) ────────────

/** A model whose Nth call returns responses[N] (or the last one, repeated). */
function mockModelMultiRound(responses: string[]): ModelProvider {
  let round = 0;
  return {
    async stream(_messages: ChatMessage[], emit: (event: ModelStreamEvent) => void): Promise<ModelResult> {
      const response = responses[round] ?? responses[responses.length - 1];
      round++;
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
    async health(): Promise<number> { return 1; },
  };
}

function emptyRegistry(): ToolRegistry {
  return new ToolRegistry({}, { includeDefaults: false });
}

const runOpts = (model: ModelProvider, maxRounds = 4) => ({
  model,
  tools: emptyRegistry(),
  shell: null as unknown as any,
  cwd: process.cwd(),
  maxRounds,
});

// ─── Unit tests: stripToolCallBlocks empty-fence handling ──────────

describe("stripToolCallBlocks — empty fenced blocks are markup residue", () => {
  it("strips a bare empty ```json fence (the reported bug payload)", () => {
    assert.equal(stripToolCallBlocks("```json\n```"), "");
  });

  it("strips an empty fence with no language tag", () => {
    assert.equal(stripToolCallBlocks("```\n```"), "");
    assert.equal(stripToolCallBlocks("```   \n   ```"), "");
  });

  it("strips an empty fence surrounded by prose, keeping the prose", () => {
    assert.equal(stripToolCallBlocks("Here is the answer.\n```json\n```"), "Here is the answer.");
  });

  it("keeps a fence that contains real content", () => {
    const md = "Example:\n```js\nconst x = 1;\n```";
    assert.equal(stripToolCallBlocks(md), md);
  });

  it("keeps a ```json fence containing real JSON data", () => {
    const md = "Data:\n```json\n{\"a\": 1}\n```";
    assert.equal(stripToolCallBlocks(md), md);
  });

  it("does not eat a legitimate closing fence at end of content", () => {
    const md = "```js\ncode()\n```";
    assert.equal(stripToolCallBlocks(md), md);
  });
});

// ─── Integration: runAgentLoop must never complete on markup-only ──

describe("runAgentLoop — markup-only responses are not answers", () => {
  it("empty ```json fence every round → error termination, explicit message", async () => {
    const model = mockModelMultiRound(["```json\n```"]);
    const result = await runAgentLoop("What time does bset buy open?", runOpts(model));

    assert.notEqual(result.termination, "complete");
    assert.equal(result.termination, "error");
    assert.match(result.content, /no visible answer|not completed/i);
    // The content must be an honest failure message, not markup residue.
    assert.ok(!result.content.includes("```"), `content still contains fence markup: ${JSON.stringify(result.content)}`);
  });

  it("markup-only first round then a real answer → recovers to complete", async () => {
    const model = mockModelMultiRound([
      "```json\n```",
      "Best Buy typically opens at 10 AM, but hours vary by location — check the store page for your local store.",
    ]);
    const result = await runAgentLoop("What time does bset buy open?", runOpts(model));

    assert.equal(result.termination, "complete");
    assert.match(result.content, /Best Buy|opens/i);
    assert.ok(!result.content.includes("```json"));
  });

  it("whitespace-only visible content is also rejected", async () => {
    // "```\n\n```" strips to nothing — same residue class as the bug.
    const model = mockModelMultiRound(["```\n\n```"]);
    const result = await runAgentLoop("hello?", runOpts(model));
    assert.equal(result.termination, "error");
  });

  it("a real answer that legitimately contains a code fence still completes", async () => {
    const answer = "Here is the config:\n```json\n{\"key\": \"value\"}\n```\nThat is the setup.";
    const model = mockModelMultiRound([answer]);
    const result = await runAgentLoop("show me config", runOpts(model));

    assert.equal(result.termination, "complete");
    assert.match(result.content, /config/);
    // The real fence content must survive stripping.
    assert.ok(result.content.includes("key"), `real fence content lost: ${JSON.stringify(result.content)}`);
  });
});
