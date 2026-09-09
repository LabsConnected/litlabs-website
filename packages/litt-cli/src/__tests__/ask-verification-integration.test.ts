/**
 * Integration coverage for the "ask" command's VerificationGate wiring.
 *
 * Root cause fixed: `runAgentLoop` (agent-core) treats any non-tool-call
 * model turn as "done" the moment ANY earlier tool call succeeded.
 * `packages/litt-cli/src/commands/ask.ts` never wired a VerificationGate,
 * so a model that inspected a little, had a mutation denied/failed, then
 * gave up with prose was reported as a successful (exit 0) completion.
 * Reproduced live in acceptance run "bqsci80gf": 6 rounds, no edit, no
 * test, `termination: "complete"`.
 *
 * These tests run the REAL runAgentLoop from @litt/agent-core, wired
 * with the REAL TaskAwareVerificationGate + MissionVerificationGate +
 * createMissionEvidenceTracker — exactly as ask.ts wires them — driven
 * by a scripted mock ModelProvider (no network, no real Ollama; the
 * mocked-model rule applies to the model only, not to the runtime
 * machinery under test, which is entirely real). This proves the fix
 * end-to-end: rejection-with-repair (round budget remains) and
 * rejection-to-failure (round budget exhausted) both actually happen
 * through the real agent loop, not just inside the gate's own verify().
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  runAgentLoop,
  ToolRegistry,
  NodeShellExecutor,
  RuntimeStore,
} from "@litt/agent-core";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  ModelProfile,
  RuntimeEvent,
  VerificationGateLike,
  VerificationResult,
} from "@litt/agent-core";
import {
  createMissionEvidenceTracker,
  MissionVerificationGate,
  TaskAwareVerificationGate,
  isMutatingToolCall,
} from "../lib/mission-verification.js";

// ─── Mocks ─────────────────────────────────────────────────────────

function makeMockModel(responses: string[]): ModelProvider {
  let call = 0;
  return {
    async stream(_messages: ChatMessage[], emit: (event: ModelStreamEvent) => void): Promise<ModelResult> {
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
    async health(): Promise<number> {
      return 100;
    },
  };
}

/** A trivial full gate — proves once called. Never actually runs a command. */
function makeAlwaysProvingFullGate(): VerificationGateLike & { called: () => number } {
  let calls = 0;
  return {
    called: () => calls,
    async verify(): Promise<VerificationResult> {
      calls++;
      return {
        proven: true,
        status: "proven",
        checks: [],
        totalDurationMs: 0,
        message: "full gate proven",
        runId: "full_gate_test",
        ranChecks: ["typecheck", "test"],
        skippedChecks: [],
      };
    },
  };
}

/**
 * Wires the SAME gate stack ask.ts wires: an evidence tracker fed from
 * the loop's emitter, a per-toolCallId successful-mutation tracker, a
 * MissionVerificationGate as the inner gate, and TaskAwareVerificationGate
 * on top. Mirrors ask.ts's wiring exactly so this test exercises the
 * real production wiring shape, not a simplified stand-in.
 */
function wireAskStyleGate(options: { mutationRequired: boolean; fullGate: VerificationGateLike; cwd: string }) {
  const MUTATION_TOOLS = new Set(["project.edit_file", "project.write_file", "project.run"]);
  const evidenceTracker = createMissionEvidenceTracker(MUTATION_TOOLS, { cwd: options.cwd });
  const mutationAttempts = new Map<string, boolean>();
  let hasSuccessfulMutation = false;

  const verificationGate = new TaskAwareVerificationGate({
    inner: new MissionVerificationGate({
      fullGate: options.fullGate,
      isReadOnly: evidenceTracker.isReadOnly,
      hasSuccessfulEvidence: evidenceTracker.hasSuccessfulEvidence,
      hasSuccessfulEvidenceType: evidenceTracker.hasSuccessfulEvidenceType,
      hasFailedEvidence: evidenceTracker.hasFailedEvidence,
      evidenceSummary: evidenceTracker.summary,
      failedSummary: evidenceTracker.failedSummary,
    }),
    hasSuccessfulMutation: () => hasSuccessfulMutation,
    mutationRequired: () => options.mutationRequired,
    evidenceSummary: evidenceTracker.summary,
  });

  const emitter = (event: RuntimeEvent) => {
    if (event.subtype === "agent_tool_call") {
      const toolId = (event.data as { toolId?: string }).toolId ?? "unknown";
      const inputs = (event.data as { inputs?: Record<string, unknown> }).inputs ?? null;
      const toolCallId = (event as { toolCallId?: string }).toolCallId ?? "";
      evidenceTracker.recordToolCall(toolId, inputs);
      if (toolCallId) {
        mutationAttempts.set(toolCallId, isMutatingToolCall(toolId, MUTATION_TOOLS, inputs, options.cwd));
      }
    } else if (event.subtype === "agent_tool_result") {
      const success = (event.data as { success?: boolean }).success ?? true;
      const toolId = (event.data as { toolId?: string }).toolId ?? "";
      const message = (event.data as { message?: string }).message ?? "";
      const toolCallId = (event as { toolCallId?: string }).toolCallId ?? "";
      evidenceTracker.recordToolResult(toolId, success, message);
      if (success && toolCallId && mutationAttempts.get(toolCallId)) {
        hasSuccessfulMutation = true;
      }
    }
  };

  return { verificationGate, emitter, hasSuccessfulMutation: () => hasSuccessfulMutation };
}

const CODE_FIX_PROMPT =
  "Inspect this repository. Find one small, real, low-risk bug or improvement. " +
  "Make the fix, add or update the relevant test, run only the targeted validation " +
  "needed, and show me the final git diff.";

describe("ask.ts VerificationGate wiring — real runAgentLoop, scripted model", () => {
  it("prose-only/no-tool completion for a requested code fix is rejected, not accepted", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status", name: "status", description: "status",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({ status: "success", success: true, message: "branch: main", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: true,
      fullGate: makeAlwaysProvingFullGate(),
      cwd: process.cwd(),
    });

    // Round 1: real read-only evidence. Round 2+: gives up with prose,
    // never edits anything — exactly the reproduced bug's shape.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "I could not safely make this change. Please apply the fix yourself and re-run the tests.",
    ]);

    const result = await runAgentLoop(CODE_FIX_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 4,
      verificationGate,
      emitter,
    });

    expect(result.termination).not.toBe("complete");
    expect(result.toolCalls.some((tc) => tc.toolId === "project.edit_file")).toBe(false);
  });

  it("denied/failed mutation attempts followed by 'run this manually' are rejected", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.run": {
        definition: {
          id: "project.run", name: "run", description: "run",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        // Simulates the ExecutionGateway's fail-closed approval denial —
        // the tool ran but the underlying command was refused.
        handler: async () => ({ status: "failed", success: false, message: "Approval denied or not available", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: true,
      fullGate: makeAlwaysProvingFullGate(),
      cwd: process.cwd(),
    });

    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.run", "inputs": { "command": "chmod", "args": ["+x", "a.sh"] } }\n```',
      "It seems I don't have permission to make this change. " +
        "Please run `chmod +x a.sh` yourself and re-run the CLI.",
    ]);

    const result = await runAgentLoop(CODE_FIX_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 4,
      verificationGate,
      emitter,
    });

    expect(result.termination).not.toBe("complete");
  });

  it("inspection + required edit + successful verification is accepted", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status", name: "status", description: "status",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({ status: "success", success: true, message: "branch: main", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.edit_file": {
        definition: {
          id: "project.edit_file", name: "edit_file", description: "edit",
          inputSchema: { type: "object", properties: {} }, readOnly: false,
        },
        handler: async () => ({ status: "success", success: true, message: "edited a.ts", data: {} }),
        metadata: { projectScoped: false, mutating: true, readOnly: false },
      },
    });

    const fullGate = makeAlwaysProvingFullGate();
    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: true,
      fullGate,
      cwd: process.cwd(),
    });

    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      '```tool_call\n{ "tool": "project.edit_file", "inputs": { "path": "a.ts" } }\n```',
      "Fixed the null check in a.ts and verified it. Here is the diff.",
    ]);

    const result = await runAgentLoop(CODE_FIX_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 6,
      verificationGate,
      emitter,
    });

    expect(result.termination).toBe("complete");
    expect(fullGate.called()).toBeGreaterThan(0);
    expect(result.toolCalls.some((tc) => tc.toolId === "project.edit_file" && tc.result.success)).toBe(true);
  });

  it("the REAL, registered project.edit_file tool's mutation evidence reaches the VerificationGate", async () => {
    // Root cause this closes: project.edit_file was referenced everywhere
    // (mutation-tracking, scope mapping, labels) but never registered —
    // this run's earlier test used a hand-mocked stand-in. This one uses
    // NO tool override at all: the real default ToolRegistry, a real
    // temp file, and the real editFile() find/replace primitive.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-ask-real-edit-"));
    fs.writeFileSync(path.join(workDir, "a.ts"), "const x = 1;\n", "utf8");
    try {
      const shell = new NodeShellExecutor(workDir);
      const store = new RuntimeStore(() => {});
      const tools = new ToolRegistry(); // the REAL default registry — no override

      const fullGate = makeAlwaysProvingFullGate();
      const { verificationGate, emitter, hasSuccessfulMutation } = wireAskStyleGate({
        mutationRequired: true,
        fullGate,
        cwd: workDir,
      });

      const model = makeMockModel([
        '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
        '```tool_call\n{ "tool": "project.edit_file", "inputs": { "path": "a.ts", "search": "const x = 1;", "replace": "const x = 2;" } }\n```',
        "Fixed and verified.",
      ]);

      const result = await runAgentLoop(CODE_FIX_PROMPT, {
        model, tools, shell, store, cwd: workDir,
        maxRounds: 6,
        verificationGate,
        emitter,
      });

      // The real file was actually mutated by the real tool.
      expect(fs.readFileSync(path.join(workDir, "a.ts"), "utf8")).toBe("const x = 2;\n");
      // The evidence tracker's successful-mutation signal (the one
      // TaskAwareVerificationGate's guard reads) reflects the real edit.
      expect(hasSuccessfulMutation()).toBe(true);
      // Because a real mutation happened, MissionVerificationGate
      // delegated to the full gate (not the evidence-only path).
      expect(fullGate.called()).toBeGreaterThan(0);
      expect(result.termination).toBe("complete");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("verification rejection with rounds remaining feeds the failure back and continues", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status", name: "status", description: "status",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({ status: "success", success: true, message: "branch: main", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
      "project.edit_file": {
        definition: {
          id: "project.edit_file", name: "edit_file", description: "edit",
          inputSchema: { type: "object", properties: {} }, readOnly: false,
        },
        handler: async () => ({ status: "success", success: true, message: "edited a.ts", data: {} }),
        metadata: { projectScoped: false, mutating: true, readOnly: false },
      },
    });

    const fullGate = makeAlwaysProvingFullGate();
    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: true,
      fullGate,
      cwd: process.cwd(),
    });

    // Round 1: evidence. Round 2: gives up (REJECTED — rounds remain,
    // so the loop must continue, not terminate). Round 3: the model
    // reacts to the repair feedback and actually makes the edit.
    // Round 4: claims done — now genuinely provable.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "I looked around but couldn't find anything worth changing.",
      '```tool_call\n{ "tool": "project.edit_file", "inputs": { "path": "a.ts" } }\n```',
      "Done — fixed and verified.",
    ]);

    const result = await runAgentLoop(CODE_FIX_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 8,
      verificationGate,
      emitter,
    });

    // The loop must have continued past the round-2 rejection (4 model
    // calls happened: evidence, rejected give-up, edit, final done) and
    // reached a real, runtime-proven completion.
    expect(result.rounds).toBeGreaterThanOrEqual(4);
    expect(result.termination).toBe("complete");
    expect(result.toolCalls.some((tc) => tc.toolId === "project.edit_file")).toBe(true);
  });

  it("round exhaustion without verification is reported as failure, never as success", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.status": {
        definition: {
          id: "project.status", name: "status", description: "status",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({ status: "success", success: true, message: "branch: main", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    const fullGate = makeAlwaysProvingFullGate();
    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: true,
      fullGate,
      cwd: process.cwd(),
    });

    // The model NEVER makes a real edit — every round after the first
    // is the same "give up" prose. This is exactly acceptance run
    // "bqsci80gf" with no round budget left to recover in.
    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.status", "inputs": {} }\n```',
      "I could not find a safe change to make. Please do this yourself.",
    ]);

    const result = await runAgentLoop(CODE_FIX_PROMPT, {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 3,
      verificationGate,
      emitter,
    });

    expect(result.termination).not.toBe("complete");
    expect(result.termination).toBe("verification_failed");
    expect(fullGate.called()).toBe(0); // never mutated — the full gate is never even the question
    // The CLI contract (ask.ts): `return result.termination === "complete" ? 0 : 1`.
    expect(result.termination === "complete" ? 0 : 1).toBe(1);
  });

  it("a read-only/explanation task can still complete without a mutation", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const store = new RuntimeStore(() => {});
    const tools = new ToolRegistry({
      "project.read_file": {
        definition: {
          id: "project.read_file", name: "read_file", description: "read",
          inputSchema: { type: "object", properties: {} }, readOnly: true,
        },
        handler: async () => ({ status: "success", success: true, message: "file contents: ...", data: {} }),
        metadata: { projectScoped: false, mutating: false, readOnly: true },
      },
    });

    const fullGate = makeAlwaysProvingFullGate();
    // mutationRequired: false — requiresMutationEvidence("explain this file") === false.
    const { verificationGate, emitter } = wireAskStyleGate({
      mutationRequired: false,
      fullGate,
      cwd: process.cwd(),
    });

    const model = makeMockModel([
      '```tool_call\n{ "tool": "project.read_file", "inputs": { "path": "a.ts" } }\n```',
      "This file defines the CLI's status command; it reads git state and prints it.",
    ]);

    const result = await runAgentLoop("Explain what this file does.", {
      model, tools, shell, store, cwd: process.cwd(),
      maxRounds: 4,
      verificationGate,
      emitter,
    });

    expect(result.termination).toBe("complete");
    expect(fullGate.called()).toBe(0); // never escalated to the expensive full gate
    expect(result.toolCalls.some((tc) => tc.toolId === "project.edit_file")).toBe(false);
  });
});
