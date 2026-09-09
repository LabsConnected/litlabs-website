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

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  runAgentLoop,
  parseToolCall,
  stripToolCallBlocks,
  looksLikeToolCallAttempt,
  truncateAfterFirstToolCall,
  suggestToolName,
  PROJECT_EVIDENCE_TOOL_ID,
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

  it("an unknown tool never becomes project evidence", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();
    // The model calls a tool that is NOT in the registry, then asserts a
    // verified repository inspection it never performed.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "nonexistent.tool", "inputs": {} }\n```',
      "Repository verified: branch main, working tree clean.",
      "Repository verified: branch main, working tree clean.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
      verificationGate: makeProvingGate(),
    });

    // The rejected call is never recorded, so it can never satisfy the
    // evidence requirement — that is the invariant this test owns.
    assert.equal(
      result.toolCalls.some((tc) => tc.toolId === "nonexistent.tool"),
      false,
      "an unknown tool must never be recorded as evidence",
    );

    // This test previously asserted the loop could not reach "complete"
    // here. That held only because the runtime had no way to obtain
    // repository evidence on its own: the model's bad tool name left the
    // mission with nothing, and it re-prompted until the round limit —
    // the live REMOTE failure. The runtime now runs the canonical
    // read-only inspection itself, so whatever the model then says is
    // backed by a real project.status result rather than by nothing.
    // The evidence requirement is satisfied by RUNTIME execution here,
    // never by the model's claim.
    assert.ok(
      result.toolCalls.some(
        (tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID && tc.result.success,
      ),
      "the runtime must have acquired real repository evidence itself",
    );
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

// ─── Max-rounds truthful partial answer ─────────────────────────────

describe("Agent loop max-rounds — truthful partial answer from tool evidence", () => {
  it("returns evidence-based partial answer when maxRounds is reached with tool calls", async () => {
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
          status: "success",
          success: true,
          message: "Branch: main, 2 modified files",
          data: {},
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
          status: "failed",
          success: false,
          message: "Typecheck timed out after 120s",
          data: {},
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    // Model keeps calling tools — never gives a final answer.
    // This exhausts maxRounds with mixed success/failure tool evidence.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.check", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.check", "inputs": {} }\n```',
    ]);

    const result = await runAgentLoop("scan and see whats needed", {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 4,
    });

    // Must NOT be the generic "I reached the maximum number of tool-call rounds" message.
    assert.ok(!result.content.includes("I reached the maximum number of tool-call rounds without a final answer."),
      "max-rounds with tool evidence must NOT return the generic message");

    // Must summarize what actually happened.
    assert.ok(result.content.includes("project.status"), "partial answer must mention successful tool");
    assert.ok(result.content.includes("project.check"), "partial answer must mention failed tool");
    assert.ok(result.content.includes("Typecheck timed out"), "partial answer must include actual failure detail");
    assert.ok(result.content.includes("did not verify"), "partial answer must state it did not verify the project");

    // Termination and tool call count.
    assert.equal(result.termination, "max_rounds");
    assert.ok(result.toolCalls.length > 0);
  });

  it("returns generic message only when no tool calls were made", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({});

    // Model gives non-tool responses. Without a verification gate, the
    // loop treats the first non-tool response as a final answer (complete).
    // This test verifies that no tool calls were made and the loop did
    // NOT produce a fabricated evidence-based partial answer.
    const model = makeMockModel([
      "I'm not sure what to do here.",
    ]);

    const result = await runAgentLoop("hello world", {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 4,
    });

    // No tool calls — the model gave a conversational answer.
    assert.equal(result.toolCalls.length, 0);
    // The content is the model's own answer, not a fabricated partial summary.
    assert.ok(!result.content.includes("inspected the project"));
    assert.ok(!result.content.includes("did not verify"));
  });
});

// ─── Malformed tool-call handling (local/weak-model degradation) ───
//
// Root cause of the observed LiTT agent-acceptance failure loop
// ("Inspecting" → "Verify the summary" → failure → retry, never
// reaching edit/test/diff): a model turn with no PARSEABLE tool call
// was always treated as "the model claims it is done" once any earlier
// round had produced real tool evidence — even when the turn was
// obviously an ATTEMPTED tool call that failed to parse (malformed
// JSON, a common failure mode for small local models such as
// litt-coder:3b). That ran the full VerificationGate mid-task, which
// failed (nothing had been fixed yet), and fed back a repair prompt the
// model never asked for and could not act on — producing exactly the
// observed cycle without ever reaching a real edit call.

describe("looksLikeToolCallAttempt — malformed-call detection", () => {
  it("detects a fenced tool_call attempt even when unparseable", () => {
    assert.equal(
      looksLikeToolCallAttempt('```tool_call\n{ "tool": "project.edit_file", "inputs": {},}\n```'),
      true,
    );
  });

  it("detects an unclosed tool_call fence", () => {
    assert.equal(looksLikeToolCallAttempt('```tool_call\n{ "tool": "project.status"'), true);
  });

  it("detects a bare unparseable tool JSON object", () => {
    assert.equal(looksLikeToolCallAttempt('{ "tool": "project.status", broken'), true);
  });

  it("does not flag ordinary prose with no tool-call intent", () => {
    assert.equal(looksLikeToolCallAttempt("The repository is on main and the tree is clean."), false);
  });
});

describe("Agent loop — malformed tool-call output never runs the gate", () => {
  it("retries a malformed tool_call instead of treating it as a final answer", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    // Round 1: a real, successful tool call (real evidence exists).
    // Round 2+: the model keeps attempting a tool call but the JSON is
    // broken (trailing comma) — a realistic litt-coder:3b failure mode.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.status", "inputs": {},}\n```',
    ]);

    let gateCalls = 0;
    const gate: VerificationGateLike = {
      async verify(): Promise<VerificationResult> {
        gateCalls++;
        return {
          proven: true,
          status: "proven",
          checks: [],
          totalDurationMs: 0,
          message: "should never run",
          runId: "verify_test",
          ranChecks: [],
          skippedChecks: [],
        };
      },
    };

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 6,
      verificationGate: gate,
    });

    // The gate must NEVER run against a malformed, unfinished attempt —
    // that mid-task misfire is what produced the observed failure loop.
    assert.equal(gateCalls, 0, "the verification gate must not run on a malformed tool-call attempt");

    // The loop must fail closed with an honest terminal error, not
    // "complete" and not a silent generic max_rounds message.
    assert.notEqual(result.termination, "complete");
    assert.ok(result.content.toLowerCase().includes("malformed"), "the terminal error must name the real cause");

    // Valid work already done (the successful round-1 evidence call)
    // must be preserved, not discarded.
    assert.ok(
      result.toolCalls.some((tc) => tc.toolId === "project.status" && tc.result.success),
      "earlier valid tool evidence must survive a later malformed attempt",
    );
  });

  it("recovers once the model produces a valid tool call after a malformed attempt", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    // Round 1: malformed attempt. Round 2: the model self-corrects and
    // emits valid JSON. Round 3: final answer.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {},}\n```',
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "Repository inspected.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 6,
      verificationGate: makeProvingGate(),
    });

    assert.equal(result.termination, "complete");
    assert.equal(
      result.toolCalls.filter((tc) => tc.toolId === "project.status").length,
      1,
      "the malformed round-1 attempt must not itself count as an executed tool call",
    );
    assert.equal(result.toolCalls[0].result.success, true);
  });
});

// ─── Fabricated-transcript contamination (weak-model degradation) ──
//
// Observed live against the real litt-coder:3b model (not mocked, via
// `litt ask` over a real Ollama endpoint): given a valid, real tool_call,
// the model narrated an entire FABRICATED continuation in the SAME
// turn — its own invented "#### Tool Result" block (claiming success
// and inventing file contents that do not exist in the repo), further
// invented tool calls, and even an invented final diff. The dispatch
// logic already executes only the real first call and injects the REAL
// result — but the fabricated continuation was being persisted into
// conversation history verbatim, sitting right next to the real result
// on the next round. A weak model then kept re-asserting its own
// fabricated version instead of the contradicting real one, repeating
// across many rounds without ever reaching a real edit.

describe("truncateAfterFirstToolCall — strips a model's fabricated continuation", () => {
  it("keeps reasoning + the real tool call, drops everything invented after it", () => {
    const content =
      'Let\'s inspect the file.\n\n```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "a.ts" } }\n```\n\n' +
      '#### Tool Result\n\n```\n{ "path": "a.ts", "contents": "totally made up" }\n```\n\n' +
      'Now let\'s fix it.\n\n```tool_call\n{ "tool": "project.edit_file", "inputs": { "path": "a.ts" } }\n```\n\n' +
      '### Final Git Diff\n```diff\n+ fake change\n```';

    const out = truncateAfterFirstToolCall(content);
    assert.ok(out.includes("Let's inspect the file."));
    assert.ok(out.includes('"tool": "project.read_file"'));
    assert.ok(!out.includes("Tool Result"), "the model's own fabricated result must be dropped");
    assert.ok(!out.includes("totally made up"), "fabricated file contents must be dropped");
    assert.ok(!out.includes("project.edit_file"), "a fabricated second tool call must be dropped");
    assert.ok(!out.includes("Final Git Diff"), "a fabricated final answer must be dropped");
  });

  it("is a no-op when there is no tool call at all", () => {
    const content = "Just a plain final answer with no tool call.";
    assert.equal(truncateAfterFirstToolCall(content), content);
  });

  it("is a no-op when the only tool call is the last thing in the content", () => {
    const content = 'Checking status.\n\n```tool_call\n{ "tool": "project.status", "inputs": {} }\n```';
    assert.equal(truncateAfterFirstToolCall(content), content);
  });
});

describe("Agent loop — a fabricated continuation never contaminates history", () => {
  /** Records every `messages` array the model was called with. */
  function makeRecordingMockModel(responses: string[]): {
    model: ModelProvider;
    callsSeen: ChatMessage[][];
  } {
    let call = 0;
    const callsSeen: ChatMessage[][] = [];
    const model: ModelProvider = {
      async stream(messages, emit) {
        callsSeen.push(messages);
        const response = responses[Math.min(call, responses.length - 1)] ?? "";
        call++;
        emit({ type: "meta", provider: "mock", model: "mock-model", profile: "fast" });
        for (const word of response.split(" ")) emit({ type: "delta", text: word + " " });
        emit({
          type: "done",
          model: "mock-model",
          usage: { total_tokens: 1 },
          timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
        });
        return {
          content: response,
          model: "mock-model",
          provider: "mock",
          usage: { total_tokens: 1 },
          timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
          profile: "fast" as ModelProfile,
        };
      },
      async health() { return 100; },
    };
    return { model, callsSeen };
  }

  it("does not feed the model's own fabricated tool result back into its next-round context", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    // project.status is overridden to FAIL for real, so the model's
    // fabricated round-1 claim of success is verifiably a fabrication.
    // The fabricated continuation's SECOND tool call names a tool id
    // that does not exist anywhere in the registry — "project.replace_text"
    // — mirroring the real litt-coder:3b run this regression test is
    // based on, where the model invented non-existent tool ids
    // (project.replace_text, project.create_test) for its fabricated
    // follow-up steps. This is what forces sequential (not parallel
    // read-only) dispatch: an unknown second call fails the "every
    // parsed call is a known read-only tool" check, so only the FIRST
    // real call executes and truncateAfterFirstToolCall applies.
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status", name: "status", description: "Get project status",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({
          status: "failed", success: false,
          message: "git status failed: repository inspection tool unavailable", data: {},
        }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    const fabricatedRound1 =
      'Checking status.\n\n```tool_call\n{ "tool": "project.status", "inputs": {} }\n```\n\n' +
      '#### Tool Result\n\n```\n{ "branch": "main", "clean": true }\n```\n\n' +
      "Repository verified clean on main. Applying the fix next.\n\n" +
      '```tool_call\n{ "tool": "project.replace_text", "inputs": { "path": "b.ts", "search": "x", "replace": "y" } }\n```';

    const { model, callsSeen } = makeRecordingMockModel([
      fabricatedRound1,
      "The inspection tool could not read the repository state, so repository status could not be verified.",
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(), maxRounds: 3,
    });

    assert.equal(callsSeen.length, 2, "the model must have been called for a second round");
    const round2Messages = callsSeen[1];
    const round2Text = round2Messages.map((m) => m.content).join("\n");

    // The model's SELF-FABRICATED claims must not appear in the context
    // it sees on the next round. (Not asserting on the word "branch"
    // alone — INSPECT_PROMPT itself legitimately contains it.)
    assert.ok(!round2Text.includes("clean\": true"), "fabricated fake status fields must not survive into round 2");
    assert.ok(!round2Text.includes("verified clean on main"), "the model's fabricated narrative must not survive into round 2");
    assert.ok(!round2Text.includes("project.replace_text"), "a fabricated SECOND tool call must not survive into round 2");

    // The REAL, honest failure result must be what the model actually sees.
    assert.ok(round2Text.includes("repository inspection tool unavailable"), "the real tool failure must be present");

    // The loop must never claim complete off a fabricated success.
    assert.notEqual(result.termination, "complete");
    assert.ok(!result.content.includes("verified clean"), "a fabricated success must never reach the final answer");
  });
});

// ─── project.edit vs project.edit_file (acceptance run "bqga7kzj8") ─
//
// Root cause: "project.edit_file" was referenced everywhere as a real
// tool (mutation-tracking, scope mapping, UI labels) but was never
// registered — a model that correctly decided to edit a file had
// nothing real to call and fabricated "project.edit". Now that
// "project.edit_file" is a real, registered tool, this proves:
//   1. suggestToolName() picks it out unambiguously.
//   2. the unknown-tool feedback names it explicitly.
//   3. the NEXT round can actually invoke the real tool and mutate a
//      real file through the full runAgentLoop path.

describe("suggestToolName", () => {
  const AVAILABLE = [
    "project.status", "project.diff", "project.log", "project.branch",
    "project.list_files", "project.read_file", "project.edit_file",
    "project.search", "project.inspect_package", "project.check",
    "project.test", "project.build", "project.run",
  ];

  it("picks the one unambiguous match: project.edit -> project.edit_file", () => {
    assert.equal(suggestToolName("project.edit", AVAILABLE), "project.edit_file");
  });

  it("also resolves other _file/_files suffix guesses (read, list)", () => {
    assert.equal(suggestToolName("project.read", AVAILABLE), "project.read_file");
    assert.equal(suggestToolName("project.list", AVAILABLE), "project.list_files");
  });

  it("returns null when nothing plausible exists (e.g. project.write)", () => {
    // project.write_file does not exist in the registry — the function
    // must never invent a suggestion for a tool that isn't there.
    assert.equal(suggestToolName("project.write", AVAILABLE), null);
  });

  it("returns null for a completely unrelated unknown id", () => {
    assert.equal(suggestToolName("weather.today", AVAILABLE), null);
  });

  it("returns null when the id is already valid (no correction needed)", () => {
    assert.equal(suggestToolName("project.status", AVAILABLE), null);
  });
});

describe("Agent loop — unknown 'project.edit' truthfully suggests 'project.edit_file'", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-agent-loop-edit-test-"));
  });
  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("names project.edit_file in the corrective feedback, and the next round can invoke it for real", async () => {
    fs.writeFileSync(path.join(workDir, "a.ts"), "const x = 1;\n", "utf8");
    const shell = new NodeShellExecutor(workDir);
    const store = new RuntimeStore(() => {});
    const tools = createDefaultRegistry();

    // Records the exact `messages` array the model is called with each
    // round, so round 2's prompt can be inspected directly for the
    // corrective wording — not just the eventual dispatch outcome.
    const responses = [
      '```tool_call\n{ "tool": "project.edit", "inputs": { "path": "a.ts", "search": "const x = 1;", "replace": "const x = 2;" } }\n```',
      '```tool_call\n{ "tool": "project.edit_file", "inputs": { "path": "a.ts", "search": "const x = 1;", "replace": "const x = 2;" } }\n```',
      "Fixed and verified.",
    ];
    let call = 0;
    const callsSeen: ChatMessage[][] = [];
    const model: ModelProvider = {
      async stream(messages, emit) {
        callsSeen.push(messages);
        const response = responses[Math.min(call, responses.length - 1)] ?? "";
        call++;
        emit({ type: "meta", provider: "mock", model: "mock-model", profile: "fast" });
        for (const word of response.split(" ")) emit({ type: "delta", text: word + " " });
        emit({ type: "done", model: "mock-model", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } });
        return { content: response, model: "mock-model", provider: "mock", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 }, profile: "fast" as ModelProfile };
      },
      async health() { return 100; },
    };

    const result = await runAgentLoop("Fix the bug in a.ts", {
      model, tools, shell, store, cwd: workDir,
      maxRounds: 6,
      verificationGate: makeProvingGate(),
    });

    // Round 2's prompt — what the model actually saw after fabricating
    // "project.edit" — must name the real tool explicitly, matching the
    // acceptance criteria's exact wording.
    assert.equal(callsSeen.length, 3, "expected 3 model calls: bad tool, real tool, final answer");
    const round2Text = callsSeen[1].map((m) => m.content).join("\n");
    assert.match(round2Text, /Unknown tool "project\.edit"/);
    assert.match(round2Text, /Did you mean "project\.edit_file"/);
    assert.match(round2Text, /Available matching tool: project\.edit_file/);
    assert.match(round2Text, /Retry using the exact tool name/);

    // Round 2 must have actually dispatched the REAL tool and mutated
    // the real file — proof the correction was actionable, not just
    // informative.
    const editCall = result.toolCalls.find((tc) => tc.toolId === "project.edit_file");
    assert.ok(editCall, "project.edit_file must have been dispatched in a later round");
    assert.equal(editCall!.result.success, true);
    assert.equal(
      fs.readFileSync(path.join(workDir, "a.ts"), "utf8"),
      "const x = 2;\n",
      "the real file must have been mutated by the real tool",
    );

    // The fabricated "project.edit" must never be recorded as a real,
    // successful tool call — it was never a real tool.
    assert.ok(
      !result.toolCalls.some((tc) => tc.toolId === "project.edit"),
      "the unknown 'project.edit' must never be recorded as an executed tool call",
    );

    assert.equal(result.termination, "complete");
  });

  it("the corrective message itself names project.edit_file (unit-level, via suggestToolName)", () => {
    // Direct proof of the exact wording contract requested: given the
    // registry's real tool ids, the unknown "project.edit" resolves to
    // exactly "project.edit_file" — the same function runAgentLoop uses
    // to build: `Unknown tool "project.edit". Did you mean "project.edit_file"?
    // Available matching tool: project.edit_file. Retry using the exact tool name.`
    const availableIds = createDefaultRegistry().list().map((d) => d.id);
    const suggestion = suggestToolName("project.edit", availableIds);
    assert.equal(suggestion, "project.edit_file");
  });
});

describe("Agent loop — existing valid tool calls are unaffected by the new tool", () => {
  it("project.status still parses, dispatches, and completes exactly as before", async () => {
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
    assert.equal(result.toolCalls[0].result.success, true);
    assert.equal(result.termination, "complete");
  });
});
