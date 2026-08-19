/**
 * Agent loop evidence discipline — regression tests for the first-run
 * acceptance failure class:
 *
 *   1. Structured tool calls are executed and never leak raw protocol
 *      syntax into the final answer.
 *   2. project.status is available to agent-loop missions via the
 *      canonical default ToolRegistry.
 *   3. A failed/unavailable inspection tool can never result in a
 *      falsely verified success.
 *   4. A read-only repository inspection mission reaches COMPLETE when
 *      real evidence was collected.
 *
 * These mirror the LiTT first-run acceptance scenario:
 *   "Inspect this repository and tell me the current project, branch,
 *    and status."
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  runAgentLoop,
  parseToolCall,
  stripToolCallBlocks,
} from "../agent-loop.js";
import {
  createDefaultRegistry,
  ToolRegistry,
} from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import { RuntimeStore } from "../state.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  ModelProfile,
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

/** A gate that proves when the loop ran it (used for inspection missions). */
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

const INSPECT_PROMPT = "Inspect this repository and tell me the current project, branch, and status.";

// ─── Tool-call parsing robustness ──────────────────────────────────

describe("parseToolCall — tolerant parsing", () => {
  it("parses a standard fenced block", () => {
    const parsed = parseToolCall('```tool_call\n{ "tool": "project.status", "inputs": {} }\n```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
  });

  it("parses a fenced block with CRLF line endings", () => {
    const parsed = parseToolCall('```tool_call\r\n{ "tool": "project.status", "inputs": {} }\r\n```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
  });

  it("parses a fenced block with no newline before the closing fence", () => {
    // Models frequently omit the trailing newline: ```tool_call{...}```
    const parsed = parseToolCall('```tool_call\n{ "tool": "project.status", "inputs": {} }```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
  });

  it("parses a fenced block with the opener on the same line", () => {
    const parsed = parseToolCall('```tool_call { "tool": "project.status", "inputs": {} }```');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
  });

  it("parses a bare JSON tool object line (no fences)", () => {
    const parsed = parseToolCall('tool_call\n{ "tool": "project.status", "inputs": {} }');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.status");
  });

  it("parses a bare JSON object with nested inputs", () => {
    const parsed = parseToolCall('{ "tool": "project.run", "inputs": { "command": "echo", "args": ["hi"] } }');
    assert.notEqual(parsed, null);
    assert.equal(parsed!.toolId, "project.run");
    assert.equal(parsed!.inputs.command, "echo");
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseToolCall('```tool_call\n{ not valid }\n```'), null);
  });

  it("returns null for prose without a tool call", () => {
    assert.equal(parseToolCall("Just a normal answer."), null);
  });
});

describe("stripToolCallBlocks — tolerant stripping", () => {
  it("strips standard blocks", () => {
    const out = stripToolCallBlocks('Before\n```tool_call\n{ "tool": "x", "inputs": {} }\n```\nAfter');
    assert.ok(!out.includes("tool_call"));
    assert.ok(out.includes("Before"));
    assert.ok(out.includes("After"));
  });

  it("strips CRLF blocks", () => {
    const out = stripToolCallBlocks('```tool_call\r\n{ "tool": "x", "inputs": {} }\r\n```');
    assert.equal(out, "");
  });

  it("strips blocks with no newline before the closing fence", () => {
    const out = stripToolCallBlocks('```tool_call\n{ "tool": "x", "inputs": {} }```');
    assert.equal(out, "");
  });
});

// ─── Evidence discipline (first-run acceptance) ────────────────────

describe("Agent loop evidence discipline", () => {
  it("project.status is available to agent-loop missions and executes", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Repository inspected.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      verificationGate: makeProvingGate(),
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    assert.equal(result.toolCalls[0].result.success, true, "project.status must succeed in the repo");
    // The real tool reports the real branch — matches `git branch --show-current`.
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: process.cwd(), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const data = result.toolCalls[0].result.data as { branch?: string };
    assert.equal(data.branch, branch);
    assert.equal(result.termination, "complete");
  });

  it("structured tool calls execute and never leak raw syntax into the answer", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\r\n{ "tool": "project.status", "inputs": {} }\r\n```',
      "The repository is on the current feature branch and the working tree is clean.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      verificationGate: makeProvingGate(),
    });

    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].toolId, "project.status");
    // The final answer must never contain raw protocol syntax.
    assert.ok(!result.content.includes("tool_call"), "final content must not contain tool_call");
    assert.ok(!result.content.includes('"tool":'), "final content must not contain raw JSON");
    assert.ok(result.content.includes("feature branch"));
    assert.equal(result.termination, "complete");
  });

  it("an unknown tool + fabricated success cannot produce a verified result", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // The model calls a tool that is NOT in the registry, then fabricates
    // a verified repository inspection.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "nonexistent.tool", "inputs": {} }\n```',
      "Repository verified: branch main, working tree clean.",
      "Repository verified: branch main, working tree clean.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
      verificationGate: makeProvingGate(),
    });

    // The loop must NOT terminate complete with fabricated success.
    assert.notEqual(result.termination, "complete");
    assert.ok(!result.content.includes("Repository verified"),
      "fabricated verified claim must not survive");
  });

  it("a failing inspection tool + fabricated success cannot produce a verified result", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    // project.status OVERRIDDEN to fail — the model calls it, it fails,
    // and the model then fabricates a verified inspection.
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status",
          name: "status",
          description: "Get project status",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
        handler: async () => ({
          status: "failed",
          success: false,
          message: "git status failed: repository inspection tool unavailable",
          data: {},
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Repository inspected successfully: branch main, all clean.",
      "Repository inspected successfully: branch main, all clean.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
    });

    assert.notEqual(result.termination, "complete");
    assert.ok(!result.content.includes("inspected successfully"),
      "fabricated success must not survive a failed tool");
  });

  it("an honest failure report is accepted as a final answer (not complete)", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status",
          name: "status",
          description: "Get project status",
          inputSchema: { type: "object", properties: {} },
          readOnly: true,
        },
        handler: async () => ({
          status: "failed",
          success: false,
          message: "git status failed: repository inspection tool unavailable",
          data: {},
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "The inspection tool could not read the repository state, so repository status could not be verified.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
    });

    // The honest failure explanation is preserved — no fabricated claims.
    assert.ok(result.content.includes("could not be verified"));
    assert.notEqual(result.termination, "complete");
  });

  it("a read-only inspection mission reaches COMPLETE with real evidence", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "This repository is litlabs-website on the current branch. The working tree is clean.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      verificationGate: makeProvingGate(),
    });

    assert.equal(result.termination, "complete");
    assert.equal(result.verification?.proven, true);
    assert.equal(result.toolCalls[0].result.success, true);
    // The answer is grounded in the returned tool evidence.
    assert.ok(result.content.length > 0);
  });
});
