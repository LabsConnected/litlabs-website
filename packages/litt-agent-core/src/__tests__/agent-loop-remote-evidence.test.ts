/**
 * Agent loop — REMOTE repository-evidence regression suite.
 *
 * This suite reproduces the LIVE failure the existing green suites all
 * miss:
 *
 *   REMOTE
 *     → repository-evidence-required prompt
 *     → model does not produce evidence the loop accepts
 *     → the loop re-prompts, round after round
 *     → "LiTT could not obtain required project evidence before reaching
 *        the tool-call round limit."
 *     → inspection not verified
 *
 * Two distinct defects produce that sequence, and both are covered here:
 *
 *   D1  Native tool_calls are translated into `tool_call` fence blocks on
 *       the provider's RETURNED ModelResult.content, never as stream
 *       deltas. The loop only adopted that content when the streamed
 *       deltas were EMPTY, so any model that narrates before calling a
 *       tool ("Let me check the repository…") had its tool call silently
 *       discarded. Every pre-existing test streams the fence as deltas,
 *       which is why they stayed green while the live path failed.
 *
 *   D2  Evidence acquisition was model-voluntary. Nothing in the runtime
 *       could obtain repository evidence itself, so a model that keeps
 *       answering in prose burns every round and the mission fails.
 *
 * The invariant these tests pin down:
 *
 *   If LiTT is operating in a valid project workspace and the request
 *   requires repository evidence, LiTT obtains deterministic repository
 *   evidence before exhausting model tool-call rounds — and if that
 *   deterministic inspection genuinely fails, it fails ONCE with the
 *   real underlying error and never claims project state.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAgentLoop, PROJECT_EVIDENCE_TOOL_ID } from "../agent-loop.js";
import { createDefaultRegistry, ToolRegistry } from "../tools.js";
import { NodeShellExecutor } from "../shell.js";
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  ModelProfile,
  ToolEntry,
  ToolDefinition,
} from "../types.js";
import type { VerificationGateLike } from "../agent-loop.js";
import type { VerificationResult } from "../verification-gate.js";

// ─── The REMOTE provider shape ─────────────────────────────────────
//
// RemoteModelProvider (and OpenRouterModelProvider) both:
//   - emit the model's prose as `delta` events, and
//   - append the translated ```tool_call fence blocks to the RETURNED
//     ModelResult.content only — never as a delta, because the fence is
//     a LiTT-internal construct rather than model prose.
//
// This mock reproduces that contract exactly. Using it (instead of a
// mock that streams the fence as deltas) is what makes D1 visible.

interface RemoteTurn {
  /** Prose the model streamed as deltas. */
  prose: string;
  /** Native tool calls the provider translated onto the returned content. */
  nativeToolCalls?: Array<{ tool: string; inputs?: Record<string, unknown> }>;
}

function makeRemoteShapedModel(turns: RemoteTurn[]): ModelProvider {
  let call = 0;
  return {
    async stream(
      _messages: ChatMessage[],
      emit: (event: ModelStreamEvent) => void,
    ): Promise<ModelResult> {
      const turn = turns[Math.min(call, turns.length - 1)] ?? { prose: "" };
      call++;
      emit({ type: "meta", provider: "remote-mock", model: "remote-mock", profile: "smart" });
      if (turn.prose) emit({ type: "delta", text: turn.prose });
      emit({
        type: "done",
        model: "remote-mock",
        usage: { total_tokens: 1 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });

      const blocks = (turn.nativeToolCalls ?? [])
        .map((tc) =>
          "```tool_call\n" +
          JSON.stringify({ tool: tc.tool, inputs: tc.inputs ?? {} }, null, 2) +
          "\n```",
        )
        .join("\n");
      const content = blocks ? (turn.prose ? `${turn.prose}\n${blocks}` : blocks) : turn.prose;

      return {
        content,
        model: "remote-mock",
        provider: "remote-mock",
        usage: { total_tokens: 1 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
        profile: "smart" as ModelProfile,
      };
    },
    async health(): Promise<number> {
      return 100;
    },
  };
}

// ─── Gates ─────────────────────────────────────────────────────────

/** Read-only evidence gate: proves exactly when real evidence exists. */
function makeEvidenceGate(hasEvidence: () => boolean): VerificationGateLike {
  return {
    async verify(): Promise<VerificationResult> {
      const proven = hasEvidence();
      return {
        proven,
        status: proven ? "proven" : "failed",
        checks: [],
        totalDurationMs: 0,
        message: proven ? "Evidence collected" : "No successful tool evidence",
        runId: "verify_test",
        ranChecks: ["evidence"],
        skippedChecks: [],
      };
    },
  };
}

/** A gate that can never be proven — used to pin maxRounds safety. */
const NEVER_PROVEN_GATE: VerificationGateLike = {
  async verify(): Promise<VerificationResult> {
    return {
      proven: false,
      status: "failed",
      checks: [],
      totalDurationMs: 0,
      message: "typecheck failed",
      runId: "verify_test",
      ranChecks: ["typecheck"],
      skippedChecks: [],
    };
  },
};

// ─── Registries ────────────────────────────────────────────────────

/** A registry whose project.status ALWAYS fails, with a real error. */
function makeFailingStatusRegistry(message: string): ToolRegistry {
  const registry = createDefaultRegistry();
  const real = registry.get(PROJECT_EVIDENCE_TOOL_ID);
  assert.ok(real, "project.status must exist in the default registry");
  const failing: ToolEntry = {
    definition: real!.definition,
    metadata: real!.metadata,
    handler: async () => ({ status: "failed", success: false, message, data: {} }),
  };
  registry.register(failing);
  return registry;
}

/** A registry with nothing registered — the "no deterministic capability" case. */
class EmptyRegistry extends ToolRegistry {
  constructor() {
    super({});
  }
  override get(): ToolEntry | null {
    return null;
  }
  override list(): ToolDefinition[] {
    return [];
  }
}

const INSPECT_PROMPT = "What branch am I on and is the working tree clean?";
const SHELL = new NodeShellExecutor(process.cwd());

function baseOptions(model: ModelProvider, tools: ToolRegistry) {
  return {
    model,
    tools,
    shell: SHELL,
    cwd: process.cwd(),
    maxRounds: 10,
  };
}

// ─── D1 — native tool calls survive a narrating model ───────────────

describe("agent loop — provider-returned tool calls (REMOTE transport shape)", () => {
  it("executes a native tool call that arrives alongside streamed prose", async () => {
    // The exact live shape: the model narrates AND calls the tool. The
    // fence block exists only on ModelResult.content.
    const model = makeRemoteShapedModel([
      {
        prose: "Let me check the repository status.",
        nativeToolCalls: [{ tool: PROJECT_EVIDENCE_TOOL_ID }],
      },
      { prose: "You are on a branch and the working tree state is shown above." },
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, baseOptions(model, createDefaultRegistry()));

    assert.ok(
      result.toolCalls.some((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID),
      "the narrated native tool call must be executed, not discarded",
    );
    assert.ok(
      result.toolCalls.some((tc) => tc.result.success),
      "project.status must have produced successful evidence",
    );
    assert.ok(result.rounds < 10, `expected an early finish, ran ${result.rounds} rounds`);
  });

  it("still executes a native tool call when the model streamed no prose", async () => {
    const model = makeRemoteShapedModel([
      { prose: "", nativeToolCalls: [{ tool: PROJECT_EVIDENCE_TOOL_ID }] },
      { prose: "Reported from the tool result above." },
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, baseOptions(model, createDefaultRegistry()));

    assert.ok(result.toolCalls.some((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID));
  });

  it("does not double-execute when the fence was streamed as prose too", async () => {
    // A model that literally types the fence: the deltas already carry
    // the call, and the provider adds no native block. Exactly one
    // execution must happen.
    const fence =
      "```tool_call\n" +
      JSON.stringify({ tool: PROJECT_EVIDENCE_TOOL_ID, inputs: {} }, null, 2) +
      "\n```";
    const model = makeRemoteShapedModel([{ prose: fence }, { prose: "Done." }]);

    const result = await runAgentLoop(INSPECT_PROMPT, baseOptions(model, createDefaultRegistry()));

    const statusCalls = result.toolCalls.filter((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID);
    assert.equal(statusCalls.length, 1, "the tool must execute exactly once");
  });
});

// ─── D2 — deterministic repository evidence ─────────────────────────

describe("agent loop — deterministic repository evidence", () => {
  it("obtains repository evidence without the model ever selecting a project tool", async () => {
    // The live failure: the model answers in prose forever. Before this
    // repair the loop nagged for all 10 rounds and returned
    // "could not obtain required project evidence".
    const model = makeRemoteShapedModel([
      { prose: "You are probably on the main branch and the tree looks clean." },
    ]);
    const tools = createDefaultRegistry();
    let evidence = false;

    const result = await runAgentLoop(INSPECT_PROMPT, {
      ...baseOptions(model, tools),
      verificationGate: makeEvidenceGate(() => evidence),
      emitter: (event) => {
        if (
          event.subtype === "agent_tool_result" &&
          (event.data as { toolId?: string }).toolId === PROJECT_EVIDENCE_TOOL_ID &&
          (event.data as { success?: boolean }).success === true
        ) {
          evidence = true;
        }
      },
    });

    assert.ok(
      result.toolCalls.some(
        (tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID && tc.result.success,
      ),
      "the runtime must acquire repository evidence itself",
    );
    assert.equal(result.termination, "complete");
    assert.doesNotMatch(
      result.content,
      /could not obtain required project evidence/i,
      "the round-limit evidence failure must no longer be reachable here",
    );
  });

  it("cannot burn all ten rounds when deterministic evidence is available", async () => {
    const model = makeRemoteShapedModel([{ prose: "I think the tree is clean." }]);
    let evidence = false;

    const result = await runAgentLoop(INSPECT_PROMPT, {
      ...baseOptions(model, createDefaultRegistry()),
      verificationGate: makeEvidenceGate(() => evidence),
      emitter: (event) => {
        if (
          event.subtype === "agent_tool_result" &&
          (event.data as { success?: boolean }).success === true
        ) {
          evidence = true;
        }
      },
    });

    assert.ok(
      result.rounds < 10,
      `deterministic evidence must short-circuit the nag loop, ran ${result.rounds} rounds`,
    );
  });

  it("emits the acquisition through the canonical tool event pair", async () => {
    // Evidence must reach the controller's MissionEvidenceTracker, which
    // is fed exclusively by agent_tool_call / agent_tool_result.
    const model = makeRemoteShapedModel([{ prose: "Probably clean." }]);
    const seen: string[] = [];

    await runAgentLoop(INSPECT_PROMPT, {
      ...baseOptions(model, createDefaultRegistry()),
      emitter: (event) => {
        if (
          event.subtype === "agent_tool_call" ||
          event.subtype === "agent_tool_result"
        ) {
          seen.push(
            `${event.subtype}:${(event.data as { toolId?: string }).toolId ?? "?"}`,
          );
        }
      },
    });

    assert.ok(seen.includes(`agent_tool_call:${PROJECT_EVIDENCE_TOOL_ID}`));
    assert.ok(seen.includes(`agent_tool_result:${PROJECT_EVIDENCE_TOOL_ID}`));
  });

  it("fails ONCE with the real underlying error when the inspection genuinely fails", async () => {
    const REAL_ERROR = "git not found on PATH";
    const model = makeRemoteShapedModel([{ prose: "You are on main and the tree is clean." }]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      ...baseOptions(model, makeFailingStatusRegistry(REAL_ERROR)),
      verificationGate: makeEvidenceGate(() => false),
    });

    assert.equal(result.rounds, 1, "a genuine inspection failure must not be retried ten times");
    assert.equal(result.termination, "verification_failed");
    assert.match(result.content, /git not found on PATH/);
  });

  it("never turns a failed inspection into successful evidence or a state claim", async () => {
    const model = makeRemoteShapedModel([{ prose: "You are on main and the tree is clean." }]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      ...baseOptions(model, makeFailingStatusRegistry("permission denied")),
      verificationGate: makeEvidenceGate(() => false),
    });

    assert.equal(
      result.toolCalls.some((tc) => tc.result.success),
      false,
      "a failed project.status must never count as successful evidence",
    );
    assert.doesNotMatch(
      result.content,
      /\bon main\b|\btree is clean\b/i,
      "the runtime must not repeat the model's unverified project-state claim",
    );
  });

  it("preserves the legacy re-prompt path when no evidence tool is registered", async () => {
    // Fail closed: with nothing deterministic to run, the loop must still
    // refuse to claim project state.
    const model = makeRemoteShapedModel([{ prose: "You are on main." }]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model,
      tools: new EmptyRegistry(),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 3,
    });

    assert.notEqual(result.termination, "complete");
    assert.equal(
      result.toolCalls.some((tc) => tc.result.success),
      false,
    );
  });
});

// ─── Unrelated loops keep their existing safety ─────────────────────

describe("agent loop — existing maxRounds safety is unchanged", () => {
  it("does not acquire repository evidence for a non-repository request", async () => {
    const model = makeRemoteShapedModel([{ prose: "Paris is the capital of France." }]);

    const result = await runAgentLoop("What is the capital of France?", {
      ...baseOptions(model, createDefaultRegistry()),
    });

    assert.equal(result.toolCalls.length, 0, "no project tool should run for a general question");
    assert.equal(result.termination, "complete");
    assert.equal(result.rounds, 1);
  });

  it("still exhausts maxRounds when a mutating gate can never be proven", async () => {
    const model = makeRemoteShapedModel([{ prose: "I fixed it." }]);

    const result = await runAgentLoop("Refactor the helper module.", {
      ...baseOptions(model, createDefaultRegistry()),
      maxRounds: 3,
      verificationGate: NEVER_PROVEN_GATE,
    });

    assert.equal(result.rounds, 3);
    assert.equal(result.termination, "verification_failed");
  });
});
