import { describe, it, expect } from "vitest";
import { callLLMWithTools } from "../src/lib/litt-intelligence/llm-tool-calling";
import type { ToolDefinition } from "../src/lib/litt-intelligence/llm-tool-calling";

/**
 * Real end-to-end routing probe — NOT a unit test.
 *
 * Sends an actual website-generation prompt through callLLMWithTools and
 * requires a real files.write tool call back. Free providers are expected to
 * fail (gemini 429 quota, openrouter/groq dead keys) and the chain must land
 * on the local Ollama litt-hermes model. Run via vitest.probe-ollama.config.ts.
 */
const WRITE_TOOL: ToolDefinition = {
  id: "files.write",
  description: "Write a file into the project workspace.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Workspace-relative file path" },
      content: { type: "string", description: "Full file content" },
    },
    required: ["path", "content"],
  },
};

describe("real routing probe → local ollama", () => {
  it(
    "a natural-language prompt produces a files.write tool call with real HTML",
    async () => {
      const resp = await callLLMWithTools(
        [
          "You are LiTT Studio's website generator. You MUST create files by",
          "calling the files.write tool — never print code in chat. For a",
          "single-file site, write path 'index.html' containing a complete",
          "<!DOCTYPE html> document.",
        ].join(" "),
        [
          {
            role: "user",
            content:
              "Create a one-page landing site for a coffee shop called 'Bright Bean'. " +
              "Include a hero headline, a menu section with 3 drinks and prices, and a footer. " +
              "Use the files.write tool now.",
          },
        ],
        [WRITE_TOOL],
        {
          toolChoice: "required",
          deadlineMs: Date.now() + 180_000,
          requireReliableFileWriting: true,
        },
      );

      console.log(
        `[probe] provider=${resp.provider} model=${resp.model} finish=${resp.finishReason} ` +
          `toolCalls=${resp.toolCalls.length} textLen=${resp.text.length}`,
      );

      expect(resp.toolCalls.length).toBeGreaterThan(0);
      const write = resp.toolCalls.find((c) => c.toolId === "files.write");
      expect(write).toBeTruthy();
      const content = String(write!.inputs.content ?? "");
      const path = String(write!.inputs.path ?? "");
      console.log(`[probe] wrote path=${path} bytes=${content.length}`);
      expect(content.toLowerCase()).toContain("<html");
      expect(content.toLowerCase()).toContain("bright bean");
    },
    200_000,
  );
});
