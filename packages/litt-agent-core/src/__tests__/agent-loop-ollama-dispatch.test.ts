/**
 * Agent loop Ollama/local-provider tool dispatch — regression tests for
 * the local-agent execution bug:
 *
 *   1. project.read_file request executes exactly project.read_file
 *      (never silently substituted with project.status)
 *   2. Ollama structured JSON tool call ({name, arguments}) is normalized
 *   3. Canonical provider-native tool envelope works
 *   4. Sequential tool request in following round executes
 *   5. Unknown tool gets explicit bounded error/retry
 *   6. Placeholder arguments are rejected pre-dispatch
 *   7. Illustrative JSON/code block is NOT executed
 *   8. Genuine structured tool request IS executed
 *   9. Required mutation fails → run cannot report success
 *  10. Mutation requested but no diff/state change → cannot report success
 *  11. Failed mutation + successful read-only checks → still not success
 *  12. Successful read → edit → diff → check → success
 *  13. Cancellation reports cancelled
 *  14. Worker/child exit propagates instead of hanging parent (total timeout)
 *  15. Max rounds/finalization guard prevents infinite RUNNING state
 *
 * These mirror the LiTT local-agent acceptance scenario:
 *   "Inspect one existing UI file, make one tiny safe visible UI change,
 *    show the diff, run one relevant check, then stop."
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runAgentLoop,
  parseToolCall,
  parseToolCalls,
  stripToolCallBlocks,
  validateToolCallArgs,
  type ParsedToolCall,
} from "../agent-loop.js";
import { ToolRegistry, createDefaultRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  ModelProfile,
  ToolDefinition,
  ToolResult,
  ToolEntry,
} from "../types.js";
import type { VerificationGateLike } from "../agent-loop.js";
import type { VerificationResult } from "../verification-gate.js";

// ─── Mocks ─────────────────────────────────────────────────────────

function makeMockModel(responses: string[]): ModelProvider {
  let call = 0;
  return {
    async stream(
      _messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      const response = responses[Math.min(call, responses.length - 1)] ?? "";
      call++;
      emit({ type: "meta", provider: "mock", model: "mock-model", profile: "fast" });
      for (const word of response.split(" ")) {
        emit({ type: "delta", text: word + " " });
      }
      emit({
        type: "done",
        model: "mock-model",
        usage: { total_tokens: responses.length },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });
      return {
        content: response,
        model: "mock-model",
        provider: "mock",
        usage: { total_tokens: responses.length },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
        profile: "fast" as ModelProfile,
      };
    },
    async health(): Promise<number> {
      return 100;
    },
  };
}

/** A gate that proves when the loop ran it. */
function makeProvingGate(message = "runtime proved it"): VerificationGateLike {
  return {
    async verify(): Promise<VerificationResult> {
      return {
        proven: true,
        status: "proven",
        checks: [
          {
            id: "evidence",
            status: "success",
            success: true,
            exitCode: 0,
            message,
            durationMs: 0,
            runId: "verify_test",
            toolCallId: "",
          },
        ],
        totalDurationMs: 0,
        message,
        runId: "verify_test",
        ranChecks: ["evidence"],
        skippedChecks: [],
      };
    },
  };
}

/** A gate that never proves (simulates a failing verification). */
function makeFailingGate(): VerificationGateLike {
  return {
    async verify(): Promise<VerificationResult> {
      return {
        proven: false,
        status: "failed",
        checks: [
          {
            id: "typecheck",
            status: "failed",
            success: false,
            exitCode: 1,
            message: "Typecheck failed",
            durationMs: 0,
            runId: "verify_test",
            toolCallId: "",
          },
        ],
        totalDurationMs: 0,
        message: "Typecheck failed",
        runId: "verify_test",
        ranChecks: ["typecheck"],
        skippedChecks: [],
      };
    },
  };
}

/** Build a registry with a custom tool for testing. */
function makeRegistryWithTool(
  id: string,
  handler: (ctx: { cwd: string; shell: NodeShellExecutor }, args: Record<string, unknown>) => Promise<ToolResult>,
  opts?: { readOnly?: boolean; mutating?: boolean },
): ToolRegistry {
  const def: ToolDefinition = {
    id,
    name: id.split(".").pop() ?? id,
    description: `Test tool ${id}`,
    inputSchema: { type: "object", properties: {} },
    readOnly: opts?.readOnly ?? true,
  };
  const entry: ToolEntry = {
    definition: def,
    handler: handler as never,
    metadata: {
      projectScoped: false,
      mutating: opts?.mutating ?? false,
      readOnly: opts?.readOnly ?? true,
    },
  };
  return new ToolRegistry({ [id]: entry });
}

// ─── A. project.read_file request executes exactly project.read_file ───

describe("A. Exact tool dispatch — project.read_file", () => {
  it("project.read_file request executes exactly project.read_file", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      "I read the file.",
    ]);

    const result = await runAgentLoop("Read the package.json file.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 1, "exactly one tool call");
    assert.equal(result.toolCalls[0].toolId, "project.read_file", "must be project.read_file");
    assert.notEqual(result.toolCalls[0].toolId, "project.status", "must NOT be project.status");
    assert.equal(result.toolCalls[0].result.success, true, "read_file must succeed");
  });
});

// ─── B. Requested tool can never silently become project.status ───

describe("B. No silent tool substitution", () => {
  it("project.read_file can never silently become project.status", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model requests read_file, then gives a final answer.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      "I read the file and here is the summary.",
    ]);

    const result = await runAgentLoop("Inspect the package.json file.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    // The dispatched tool MUST be project.read_file, not project.status.
    assert.equal(
      result.toolCalls.some((tc) => tc.toolId === "project.read_file"),
      true,
      "project.read_file must have been dispatched",
    );
    assert.equal(
      result.toolCalls.some((tc) => tc.toolId === "project.status"),
      false,
      "project.status must NOT have been substituted for project.read_file",
    );
  });

  it("deterministic evidence acquisition does NOT run when model made tool calls", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model calls read_file (which succeeds), then gives a final answer.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      "Done inspecting.",
    ]);

    const result = await runAgentLoop("Inspect the repository and read package.json.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    // The model's tool call must be the ONLY tool call — no deterministic
    // project.status substitution.
    assert.equal(result.toolCalls.length, 1, "exactly one tool call (the model's)");
    assert.equal(result.toolCalls[0].toolId, "project.read_file");
  });
});

// ─── C. Ollama structured JSON tool call is normalized correctly ───

describe("C. Ollama structured JSON normalization", () => {
  it("parses {name, arguments} format from bare JSON", () => {
    const parsed = parseToolCall('{"name": "project.read_file", "arguments": {"path": "src/index.ts"}}');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.read_file");
    assert.equal(parsed!.inputs.path, "src/index.ts");
  });

  it("parses {name, arguments} format from fenced block", () => {
    const parsed = parseToolCall('```tool_call\n{"name": "project.list_files", "arguments": {"path": "src"}}\n```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.list_files");
    assert.equal(parsed!.inputs.path, "src");
  });

  it("parses {name, arguments} format mid-prose", () => {
    const content = 'Let me check the file.\n{"name": "project.read_file", "arguments": {"path": "README.md"}}\nThat should work.';
    const parsed = parseToolCall(content);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.read_file");
    assert.equal(parsed!.inputs.path, "README.md");
  });

  it("parseToolCalls extracts all {name, arguments} calls", () => {
    const content = '{"name": "project.status", "arguments": {}}\n{"name": "project.branch", "arguments": {}}';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolId, "project.status");
    assert.equal(calls[1].toolId, "project.branch");
  });

  it("strips {name, arguments} blocks from content", () => {
    const content = 'Before\n{"name": "project.status", "arguments": {}}\nAfter';
    const stripped = stripToolCallBlocks(content);
    assert.ok(!stripped.includes("project.status"), "tool call must be stripped");
    assert.ok(stripped.includes("Before"), "prose must remain");
    assert.ok(stripped.includes("After"), "prose must remain");
  });

  it("parses tool call inside ```json fence", () => {
    const content = '```json\n{ "tool": "project.read_file", "inputs": { "path": "src/index.ts" } }\n```';
    const parsed = parseToolCall(content);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.read_file");
    assert.equal(parsed!.inputs.path, "src/index.ts");
  });

  it("parses {name, arguments} inside ```json fence", () => {
    const content = '```json\n{"name": "project.list_files", "arguments": {"path": "src"}}\n```';
    const parsed = parseToolCall(content);
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.list_files");
  });

  it("parses multiple tool calls inside ```json fence", () => {
    const content = '```json\n{ "tool": "project.status", "inputs": {} }\n{ "tool": "project.branch", "inputs": {} }\n```';
    const calls = parseToolCalls(content);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].toolId, "project.status");
    assert.equal(calls[1].toolId, "project.branch");
  });

  it("does NOT parse illustrative ```json as tool call", () => {
    const content = '```json\n{"name": "example", "value": 42}\n```';
    const parsed = parseToolCall(content);
    assert.equal(parsed, null, "illustrative JSON must not be a tool call");
  });

  it("strips ```json fences containing tool calls", () => {
    const content = 'Before\n```json\n{ "tool": "project.status", "inputs": {} }\n```\nAfter';
    const stripped = stripToolCallBlocks(content);
    assert.ok(!stripped.includes("project.status"), "tool call in json fence must be stripped");
    assert.ok(stripped.includes("Before"), "prose must remain");
    assert.ok(stripped.includes("After"), "prose must remain");
  });

  it("does NOT strip illustrative ```json fences", () => {
    const content = '```json\n{"name": "example", "value": 42}\n```';
    const stripped = stripToolCallBlocks(content);
    assert.ok(stripped.includes("example"), "illustrative JSON must remain");
  });
});

// ─── D. Canonical provider-native tool envelope works ───

describe("D. Canonical {tool, inputs} envelope", () => {
  it("parses {tool, inputs} format (canonical LiTT)", () => {
    const parsed = parseToolCall('{ "tool": "project.read_file", "inputs": { "path": "src/index.ts" } }');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.read_file");
    assert.equal(parsed!.inputs.path, "src/index.ts");
  });

  it("parses {tool, inputs} format from fenced block", () => {
    const parsed = parseToolCall('```tool_call\n{ "tool": "project.diff", "inputs": {} }\n```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.diff");
  });
});

// ─── E. Sequential tool request in following round executes ───

describe("E. Sequential tool execution", () => {
  it("second tool request in following round executes normally", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Round 1: read_file. Round 2: list_files. Round 3: final answer.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      '```tool_call\n{ "tool": "project.list_files", "inputs": { "path": "src" } }\n```',
      "Both tools executed successfully.",
    ]);

    const result = await runAgentLoop("Read package.json then list src directory.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2, "both tools must execute");
    assert.equal(result.toolCalls[0].toolId, "project.read_file");
    assert.equal(result.toolCalls[1].toolId, "project.list_files");
    assert.equal(result.toolCalls[1].result.success, true, "second tool must succeed");
  });

  it("second tool request using {name, arguments} format also executes", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Round 1: read_file (canonical). Round 2: list_files (Ollama format).
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      '{"name": "project.list_files", "arguments": {"path": "src"}}',
      "Done.",
    ]);

    const result = await runAgentLoop("Read package.json then list src directory.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    assert.equal(result.toolCalls.length, 2, "both tools must execute");
    assert.equal(result.toolCalls[0].toolId, "project.read_file");
    assert.equal(result.toolCalls[1].toolId, "project.list_files");
    assert.equal(result.toolCalls[1].result.success, true, "second tool (Ollama format) must succeed");
  });
});

// ─── F. Unknown tool gets explicit bounded error/retry ───

describe("F. Unknown tool bounded error/retry", () => {
  it("unknown tool produces structured error, not silent fallback", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model calls unknown tool, then gives up honestly.
    const model = makeMockModel([
      '{"name": "project_diff", "arguments": {}}',
      '{"name": "project_diff", "arguments": {}}',
      '{"name": "project_diff", "arguments": {}}',
      '{"name": "project_diff", "arguments": {}}',
      "I could not complete the task because the tool is not available.",
    ]);

    const result = await runAgentLoop("Show me the diff.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 10,
    });

    // Unknown tool must never be recorded as a successful tool call.
    assert.equal(
      result.toolCalls.some((tc) => tc.toolId === "project_diff"),
      false,
      "unknown tool must never be recorded as executed",
    );
    // The loop must NOT substitute project.status for project_diff.
    assert.equal(
      result.toolCalls.some((tc) => tc.toolId === "project.status"),
      false,
      "project.status must NOT be substituted for unknown tool",
    );
  });

  it("unknown tool retry is bounded — terminates after MAX_UNKNOWN_TOOL_RETRIES", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model keeps calling unknown tool forever.
    const model = makeMockModel([
      '{"name": "nonexistent.tool", "arguments": {}}',
    ]);

    const result = await runAgentLoop("Do something.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 20,
    });

    // Must terminate (not loop forever) and report error.
    assert.equal(result.termination, "error", "must terminate as error after bounded retries");
    assert.ok(result.content.includes("not available"), "must mention the tool is not available");
    assert.ok(result.content.includes("NOT substituted"), "must state no fallback was used");
  });
});

// ─── G. Placeholder arguments are rejected pre-dispatch ───

describe("G. Placeholder argument rejection", () => {
  it("rejects PLACEHOLDER style arguments", () => {
    const tools = createDefaultRegistry();
    const defs = tools.list();
    const err = validateToolCallArgs("project.read_file", { path: "URL_OF_DOCUMENTATION" }, defs);
    assert.notEqual(err, null, "placeholder must be rejected");
    assert.ok(err!.includes("placeholder"), "error must mention placeholder");
  });

  it("rejects <template> style arguments", () => {
    const tools = createDefaultRegistry();
    const defs = tools.list();
    const err = validateToolCallArgs("project.read_file", { path: "<path>" }, defs);
    assert.notEqual(err, null, "template must be rejected");
    assert.ok(err!.includes("template"), "error must mention template");
  });

  it("rejects missing required arguments", () => {
    const tools = createDefaultRegistry();
    const defs = tools.list();
    const err = validateToolCallArgs("project.read_file", {}, defs);
    assert.notEqual(err, null, "missing required arg must be rejected");
    assert.ok(err!.includes("path"), "error must mention the missing field");
  });

  it("accepts valid arguments", () => {
    const tools = createDefaultRegistry();
    const defs = tools.list();
    const err = validateToolCallArgs("project.read_file", { path: "src/index.ts" }, defs);
    assert.equal(err, null, "valid args must pass");
  });

  it("placeholder argument does not execute the tool", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    let toolRan = false;
    // Override read_file to track if it ran.
    const registry = new ToolRegistry({
      "project.read_file": {
        definition: {
          id: "project.read_file",
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string", description: "File path" } },
            required: ["path"],
          },
          readOnly: true,
        },
        handler: async (_ctx, _args) => {
          toolRan = true;
          return { status: "success", success: true, message: "read", data: {} };
        },
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "FILE_PATH" } }\n```',
      "Done.",
    ]);

    const result = await runAgentLoop("Read the file.", {
      model, tools: registry, shell, store, cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.equal(toolRan, false, "tool must NOT have executed with placeholder arg");
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].result.success, false, "placeholder call must fail");
    assert.ok(result.toolCalls[0].result.message.includes("placeholder"), "must mention placeholder");
  });
});

// ─── H. Illustrative JSON/code block is NOT executed ───

describe("H. Illustrative JSON not executed", () => {
  it("JSON with generic name key is not mistaken for a tool call", () => {
    // {"name": "Alice", "age": 30} — "Alice" is not a dotted tool ID
    const parsed = parseToolCall('{"name": "Alice", "age": 30}');
    assert.equal(parsed, null, "generic JSON with name key must not be a tool call");
  });

  it("JSON in a code block discussing tools is not executed", () => {
    const content = 'You could use:\n```json\n{"name": "example", "value": 42}\n```\nto illustrate.';
    const parsed = parseToolCall(content);
    assert.equal(parsed, null, "illustrative JSON must not be parsed as a tool call");
  });

  it("prose mentioning project.build does not execute it", () => {
    const content = "To build the project, you would run project.build or project.test.";
    const parsed = parseToolCall(content);
    assert.equal(parsed, null, "prose mentioning tools must not be a tool call");
  });

  it("JSON with non-dotted name value is not a tool call", () => {
    const parsed = parseToolCall('{"name": "build", "arguments": {}}');
    assert.equal(parsed, null, "non-dotted name must not be a tool call");
  });
});

// ─── I. Genuine structured tool request IS executed ───

describe("I. Genuine structured tool request executes", () => {
  it("genuine {name, arguments} tool request executes", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '{"name": "project.read_file", "arguments": {"path": "package.json"}}',
      "I read the file successfully.",
    ]);

    const result = await runAgentLoop("Read package.json.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.read_file");
    assert.equal(result.toolCalls[0].result.success, true);
  });

  it("genuine {tool, inputs} tool request executes", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Status checked.",
    ]);

    const result = await runAgentLoop("Check the project status.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[0].result.success, true);
  });
});

// ─── J. Required mutation fails → run cannot report success ───

describe("J. Mutation failure propagation", () => {
  it("failed mutation → run cannot report success", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    // project.run overridden to fail (simulating a failed edit).
    const tools = new ToolRegistry({
      "project.run": {
        definition: {
          id: "project.run",
          name: "run",
          description: "Run a command",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "Command" },
              args: { type: "array", items: { type: "string" }, description: "Args" },
            },
            required: ["command"],
          },
          readOnly: true,
        },
        handler: async () => ({
          status: "failed",
          success: false,
          message: "sed: command failed — permission denied",
          data: {},
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.read_file": {
        definition: {
          id: "project.read_file",
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          readOnly: true,
        },
        handler: async () => ({
          status: "success",
          success: true,
          message: "File read successfully",
          data: { content: "file content" },
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    // Model: read file, try to edit (fails), then claim done.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "src/index.ts" } }\n```',
      '```tool_call\n{ "tool": "project.run", "inputs": { "command": "sed", "args": ["-i", "s/old/new/", "src/index.ts"] } }\n```',
      "I edited the file successfully.",
    ]);

    const result = await runAgentLoop("Edit src/index.ts to change old to new.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    assert.notEqual(result.termination, "complete", "must NOT report success");
    assert.ok(
      result.termination === "failed" || result.termination === "max_rounds",
      "must report failed or max_rounds, not complete",
    );
  });
});

// ─── K. Mutation requested but no diff/state change → cannot report success ───

describe("K. Mutation requested but no mutation performed", () => {
  it("mutation requested, no mutation tool called → cannot report success", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model only reads, never edits, then claims done.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "package.json" } }\n```',
      "I have edited the file. The change is complete.",
    ]);

    const result = await runAgentLoop("Edit package.json to add a description field.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.notEqual(result.termination, "complete", "must NOT report success without mutation");
    assert.ok(
      result.content.includes("NOT completed") || result.content.includes("not performed"),
      "must state the mutation was not performed",
    );
  });
});

// ─── L. Failed mutation + successful read-only → still not success ───

describe("L. Failed mutation + successful read-only checks", () => {
  it("failed mutation followed by successful read → still not success", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    let runCallCount = 0;
    const tools = new ToolRegistry({
      "project.run": {
        definition: {
          id: "project.run",
          name: "run",
          description: "Run a command",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
            },
            required: ["command"],
          },
          readOnly: true,
        },
        handler: async () => {
          runCallCount++;
          return {
            status: "failed",
            success: false,
            message: "Edit command failed",
            data: {},
          };
        },
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.read_file": {
        definition: {
          id: "project.read_file",
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          readOnly: true,
        },
        handler: async () => ({
          status: "success",
          success: true,
          message: "File read successfully",
          data: { content: "file content" },
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    // Model: try edit (fails), then read (succeeds), then claims done.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.run", "inputs": { "command": "sed", "args": ["-i", "s/old/new/", "file.ts"] } }\n```',
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "file.ts" } }\n```',
      "The edit is complete and the file reads correctly.",
    ]);

    const result = await runAgentLoop("Edit file.ts to change old to new.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
    });

    assert.notEqual(result.termination, "complete", "must NOT report success despite successful read");
    assert.ok(runCallCount > 0, "mutation tool must have been attempted");
  });
});

// ─── M. Successful read → edit → diff → check → success ───

describe("M. Full read → edit → diff → check → success", () => {
  it("successful read, edit, diff, check → success", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    let editSucceeded = false;
    const tools = new ToolRegistry({
      "project.read_file": {
        definition: {
          id: "project.read_file",
          name: "read_file",
          description: "Read a file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          readOnly: true,
        },
        handler: async () => ({
          status: "success",
          success: true,
          message: "File read",
          data: { content: "export const x = 1;" },
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.run": {
        definition: {
          id: "project.run",
          name: "run",
          description: "Run a command",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string" },
              args: { type: "array", items: { type: "string" } },
            },
            required: ["command"],
          },
          readOnly: true,
        },
        handler: async () => {
          editSucceeded = true;
          return {
            status: "success",
            success: true,
            message: "Edit applied successfully",
            data: { exitCode: 0 },
          };
        },
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.diff": {
        definition: {
          id: "project.diff",
          name: "diff",
          description: "Get git diff",
          inputSchema: {
            type: "object",
            properties: { staged: { type: "boolean" } },
          },
          readOnly: true,
        },
        handler: async () => ({
          status: "success",
          success: true,
          message: "diff --git a/file.ts b/file.ts\n+export const x = 2;",
          data: { diff: "+export const x = 2;" },
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.check": {
        definition: {
          id: "project.check",
          name: "check",
          description: "Run typecheck",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
        handler: async () => ({
          status: "success",
          success: true,
          message: "Typecheck passed",
          data: { exitCode: 0 },
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    // Model: read → edit → diff → check → done
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "file.ts" } }\n```',
      '```tool_call\n{ "tool": "project.run", "inputs": { "command": "sed", "args": ["-i", "s/x = 1/x = 2/", "file.ts"] } }\n```',
      '```tool_call\n{ "tool": "project.diff", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.check", "inputs": {} }\n```',
      "I read the file, made the edit, showed the diff, and ran the typecheck. All done.",
    ]);

    const result = await runAgentLoop("Edit file.ts to change x from 1 to 2, show the diff, and run typecheck.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 10,
    });

    assert.equal(result.toolCalls.length, 4, "all 4 tools must execute");
    assert.equal(editSucceeded, true, "edit must have succeeded");
    assert.equal(result.termination, "complete", "must report success");
  });
});

// ─── N. Cancellation reports cancelled ───

describe("N. Cancellation", () => {
  it("abort signal reports cancelled", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const controller = new AbortController();
    // Abort before the loop starts.
    controller.abort();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Done.",
    ]);

    const result = await runAgentLoop("Check status.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 5,
      abortSignal: controller.signal,
    });

    assert.equal(result.termination, "cancelled", "must report cancelled");
    assert.ok(result.content.includes("cancelled"), "content must mention cancellation");
  });
});

// ─── O. Worker/child exit propagates instead of hanging parent ───

describe("O. Total timeout prevents hang", () => {
  it("total timeout terminates the loop instead of hanging", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model that takes a long time (simulated by many rounds).
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Still working...",
    ]);

    const result = await runAgentLoop("Check status.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 100,
      totalTimeoutMs: 1, // 1ms — will time out on the first round boundary
    });

    assert.equal(result.termination, "error", "must terminate as error (timeout)");
    assert.ok(result.content.includes("timed out"), "must mention timeout");
  });
});

// ─── P. Max rounds/finalization guard prevents infinite RUNNING ───

describe("P. Max rounds guard", () => {
  it("max rounds prevents infinite RUNNING state", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model keeps calling tools forever.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
    ]);

    const result = await runAgentLoop("Check status.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.ok(
      result.termination === "max_rounds" || result.termination === "verification_failed",
      "must terminate at max rounds, not loop forever",
    );
    assert.ok(result.rounds <= 3, "must not exceed max rounds");
  });

  it("failing verification gate does not loop forever", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // Model calls status then claims done, but gate always fails.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "I am done.",
    ]);

    const result = await runAgentLoop("Inspect the repository.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
      verificationGate: makeFailingGate(),
    });

    assert.equal(result.termination, "verification_failed", "must terminate as verification_failed");
    assert.ok(result.rounds <= 3, "must not exceed max rounds");
  });
});
