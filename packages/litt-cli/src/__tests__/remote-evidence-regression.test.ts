/**
 * REMOTE repository-evidence regression suite.
 *
 * Reproduces the live cockpit failure end to end, on the REMOTE path:
 *
 *   REMOTE + TOOLS enabled
 *     → "What branch am I on and is the working tree clean?"
 *     → repository evidence required
 *     → the model narrates instead of producing evidence the loop accepts
 *     → rounds burn
 *     → "LiTT could not obtain required project evidence before reaching
 *        the tool-call round limit." / inspection not verified
 *
 * The pre-existing suites (mission-verification, remote-fail-closed,
 * native-tools, workspace-context-fix) all stayed green through that
 * failure because none of them drives RemoteModelProvider through
 * runAgentLoop with the transport's real event shape. This file does.
 *
 * Covered:
 *   1. REMOTE native tool_calls survive a model that narrates first.
 *   2. REMOTE project.status success becomes repository_status evidence.
 *   3. That evidence proves a read-only MissionVerificationGate.
 *   4. A FAILED project.status never becomes successful evidence, and the
 *      gate stays fail-closed.
 *   5. The runtime obtains evidence deterministically rather than relying
 *      on the model choosing project.status.
 */

import { describe, it, expect } from "vitest";
import {
  runAgentLoop,
  createDefaultRegistry,
  NodeShellExecutor,
  toolToEvidenceType,
  PROJECT_EVIDENCE_TOOL_ID,
} from "@litt/agent-core";
import type { ToolEntry, VerificationResult } from "@litt/agent-core";
import { RemoteModelProvider } from "../lib/remote-model-provider.js";
import type {
  RuntimeClient,
  RemoteModelStreamEvent,
  RemoteChatMessage,
  RemoteToolSchema,
} from "../lib/runtime-client.js";
import {
  MissionVerificationGate,
  createMissionEvidenceTracker,
} from "../lib/mission-verification.js";

// ─── A fake remote transport ───────────────────────────────────────
//
// Emits exactly what terminal-server relays over the authenticated
// Socket.IO channel: meta, prose deltas, native tool_call_chunk frames,
// then done. Nothing here streams a `tool_call` fence as a delta —
// that is the whole point: the fence is synthesized by the provider on
// the RETURNED content, and the loop has to pick it up from there.

interface RemoteTurn {
  prose?: string;
  toolCalls?: Array<{ name: string; args: string }>;
}

interface FakeClient {
  client: RuntimeClient;
  /** Tool schemas the CLI actually sent to the server. */
  sentTools: RemoteToolSchema[][];
}

function makeFakeRuntimeClient(turns: RemoteTurn[]): FakeClient {
  let call = 0;
  const sentTools: RemoteToolSchema[][] = [];

  const client = {
    is_connected: () => true,
    cancelModelStream: () => {},
    async streamModel(
      _requestId: string,
      model: string,
      _messages: RemoteChatMessage[],
      tools: RemoteToolSchema[],
      onEvent: (event: RemoteModelStreamEvent) => void,
    ) {
      sentTools.push(tools);
      const turn = turns[Math.min(call, turns.length - 1)] ?? {};
      call++;

      onEvent({ type: "meta", provider: "openai", model, profile: "smart" });
      if (turn.prose) onEvent({ type: "delta", text: turn.prose });
      turn.toolCalls?.forEach((tc, index) => {
        // Split the arguments across two frames, as a real SSE stream does.
        const mid = Math.ceil(tc.args.length / 2);
        onEvent({ type: "tool_call_chunk", index, name: tc.name, argsChunk: tc.args.slice(0, mid) });
        onEvent({ type: "tool_call_chunk", index, argsChunk: tc.args.slice(mid) });
      });
      onEvent({
        type: "done",
        model,
        usage: { total_tokens: 10 },
        timing: { ttftMs: 1, generationMs: 1, totalMs: 2 },
      });

      return { provider: "openai", model, usage: { total_tokens: 10 } };
    },
  } as unknown as RuntimeClient;

  return { client, sentTools };
}

function makeRemoteProvider(turns: RemoteTurn[]): { provider: RemoteModelProvider; fake: FakeClient } {
  const fake = makeFakeRuntimeClient(turns);
  const provider = new RemoteModelProvider({
    client: fake.client,
    model: "gpt-5.6-luna",
    providerHint: "openai",
    tools: createDefaultRegistry().list(),
  });
  return { provider, fake };
}

const INSPECT_PROMPT = "What branch am I on and is the working tree clean?";
const SHELL = new NodeShellExecutor(process.cwd());

/** A registry whose project.status always fails, with a real error. */
function makeFailingStatusRegistry(message: string) {
  const registry = createDefaultRegistry();
  const real = registry.get(PROJECT_EVIDENCE_TOOL_ID);
  expect(real).not.toBeNull();
  const failing: ToolEntry = {
    definition: real!.definition,
    metadata: real!.metadata,
    handler: async () => ({ status: "failed", success: false, message, data: {} }),
  };
  registry.register(failing);
  return registry;
}

/** A full gate that must never be consulted for a read-only inspection. */
const UNREACHABLE_FULL_GATE = {
  async verify(): Promise<VerificationResult> {
    throw new Error("the full typecheck/test/build gate must not run for a read-only inspection");
  },
};

// ─── 1. REMOTE tool_calls survive a narrating model ─────────────────

describe("REMOTE transport — native tool calls reach the agent loop", () => {
  it("sends the sanitized project_status schema to the server", async () => {
    const { provider, fake } = makeRemoteProvider([{ prose: "ok" }]);
    await provider.stream([{ role: "user", content: "hi" }], () => {});

    const names = fake.sentTools[0].map((t) => t.function.name);
    expect(names).toContain("project_status");
    // Dotted canonical ids are invalid OpenAI function names.
    expect(names.every((n) => /^[a-zA-Z0-9_-]+$/.test(n))).toBe(true);
  });

  it("executes a native tool call that arrived alongside streamed prose", async () => {
    // THE LIVE FAILURE: the model narrates AND calls the tool. The fence
    // block exists only on the provider's returned content, so a loop
    // that reads the streamed deltas alone sees a plain prose answer,
    // finds no evidence, and re-prompts until the round limit.
    const { provider } = makeRemoteProvider([
      { prose: "Let me check the repository status.", toolCalls: [{ name: "project_status", args: "{}" }] },
      { prose: "Reported from the verified status above." },
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model: provider,
      tools: createDefaultRegistry(),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 10,
    });

    const statusCalls = result.toolCalls.filter((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID);
    expect(statusCalls.length).toBeGreaterThan(0);
    expect(statusCalls[0].result.success).toBe(true);
    expect(result.content).not.toMatch(/could not obtain required project evidence/i);
  });

  it("maps the sanitized function name back to the canonical tool id", async () => {
    const { provider } = makeRemoteProvider([
      { toolCalls: [{ name: "project_status", args: "{}" }] },
    ]);
    const result = await provider.stream([{ role: "user", content: INSPECT_PROMPT }], () => {});
    expect(result.content).toContain('"tool": "project.status"');
  });
});

// ─── 2 + 3. Evidence classification and the read-only gate ──────────

describe("REMOTE project.status → repository_status → verified inspection", () => {
  it("classifies a successful project.status as repository_status evidence", () => {
    expect(toolToEvidenceType(PROJECT_EVIDENCE_TOOL_ID)).toBe("repository_status");
  });

  it("carries REMOTE evidence into the tracker and proves the read-only gate", async () => {
    const tracker = createMissionEvidenceTracker(
      new Set(["project.edit_file", "project.write_file", "project.run"]),
    );
    const gate = new MissionVerificationGate({
      fullGate: UNREACHABLE_FULL_GATE,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
    });

    const { provider } = makeRemoteProvider([
      { prose: "Checking.", toolCalls: [{ name: "project_status", args: "{}" }] },
      { prose: "The branch and working-tree state are as reported above." },
    ]);

    const evidenceTypes: string[] = [];
    const result = await runAgentLoop(INSPECT_PROMPT, {
      model: provider,
      tools: createDefaultRegistry(),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 10,
      verificationGate: gate,
      // Exactly how the controller feeds the tracker.
      emitter: (event) => {
        const data = event.data as { toolId?: string; success?: boolean; message?: string };
        if (event.subtype === "agent_tool_call") {
          tracker.recordToolCall(data.toolId ?? "");
        } else if (event.subtype === "agent_tool_result") {
          tracker.recordToolResult(data.toolId ?? "", data.success ?? false, data.message ?? "");
          if (data.success) evidenceTypes.push(toolToEvidenceType(data.toolId ?? ""));
        }
      },
    });

    expect(evidenceTypes).toContain("repository_status");
    expect(tracker.hasSuccessfulEvidence()).toBe(true);
    expect(tracker.hasFailedEvidence()).toBe(false);
    expect(result.verification?.proven).toBe(true);
    expect(result.termination).toBe("complete");
  });
});

// ─── 4. Fail-closed on a genuine inspection failure ─────────────────

describe("REMOTE repository evidence — fail closed", () => {
  it("a failed project.status never becomes successful evidence", async () => {
    const tracker = createMissionEvidenceTracker(new Set(["project.run"]));
    const { provider } = makeRemoteProvider([
      { prose: "Checking.", toolCalls: [{ name: "project_status", args: "{}" }] },
      { prose: "You are on main and the working tree is clean." },
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model: provider,
      tools: makeFailingStatusRegistry("git status failed: not a git repository"),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 10,
      emitter: (event) => {
        const data = event.data as { toolId?: string; success?: boolean; message?: string };
        if (event.subtype === "agent_tool_result") {
          tracker.recordToolResult(data.toolId ?? "", data.success ?? false, data.message ?? "");
        }
      },
    });

    expect(tracker.hasSuccessfulEvidence()).toBe(false);
    expect(tracker.hasFailedEvidence()).toBe(true);
    expect(result.termination).not.toBe("complete");
    // The real underlying error is surfaced, not a paraphrase.
    expect(result.content).toMatch(/not a git repository/);
  });

  it("keeps the read-only gate unproven when all evidence failed", async () => {
    const tracker = createMissionEvidenceTracker(new Set(["project.run"]));
    tracker.recordToolResult(PROJECT_EVIDENCE_TOOL_ID, false, "git status failed");

    const gate = new MissionVerificationGate({
      fullGate: UNREACHABLE_FULL_GATE,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
    });

    const verification = await gate.verify();
    expect(verification.proven).toBe(false);
    expect(verification.message).toMatch(/git status failed/);
  });
});

// ─── 5. The model does not have to choose the tool ──────────────────

describe("REMOTE inspection — deterministic evidence acquisition", () => {
  it("obtains repository_status when the model only ever returns prose", async () => {
    // The exact reported sequence: REMOTE, evidence required, the model
    // never emits an accepted tool call. Before the repair this burned
    // all ten rounds and ended verification_failed.
    const tracker = createMissionEvidenceTracker(new Set(["project.run"]));
    const gate = new MissionVerificationGate({
      fullGate: UNREACHABLE_FULL_GATE,
      isReadOnly: tracker.isReadOnly,
      hasSuccessfulEvidence: tracker.hasSuccessfulEvidence,
      hasFailedEvidence: tracker.hasFailedEvidence,
      evidenceSummary: tracker.summary,
      failedSummary: tracker.failedSummary,
    });

    const { provider } = makeRemoteProvider([
      { prose: "You are most likely on the main branch with a clean tree." },
    ]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model: provider,
      tools: createDefaultRegistry(),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 10,
      verificationGate: gate,
      emitter: (event) => {
        const data = event.data as { toolId?: string; success?: boolean; message?: string };
        if (event.subtype === "agent_tool_call") tracker.recordToolCall(data.toolId ?? "");
        if (event.subtype === "agent_tool_result") {
          tracker.recordToolResult(data.toolId ?? "", data.success ?? false, data.message ?? "");
        }
      },
    });

    expect(
      result.toolCalls.some((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID && tc.result.success),
    ).toBe(true);
    expect(tracker.hasSuccessfulEvidence()).toBe(true);
    expect(result.rounds).toBeLessThan(10);
    expect(result.termination).toBe("complete");
    expect(result.content).not.toMatch(/could not obtain required project evidence/i);
  });

  it("reports the real repository state, never a fabricated one", async () => {
    // The evidence the runtime collects must be the actual repository —
    // the same answer `git branch --show-current` gives.
    // On GitHub Actions, the checkout is in detached HEAD (no branch name),
    // so branch may be null. The key assertion is that the evidence is real:
    // root and name must be non-empty strings, and isGitRepo must be true.
    const { provider } = makeRemoteProvider([{ prose: "Probably clean." }]);

    const result = await runAgentLoop(INSPECT_PROMPT, {
      model: provider,
      tools: createDefaultRegistry(),
      shell: SHELL,
      cwd: process.cwd(),
      maxRounds: 10,
    });

    const status = result.toolCalls.find((tc) => tc.toolId === PROJECT_EVIDENCE_TOOL_ID);
    expect(status).toBeDefined();
    const data = status!.result.data as { branch?: string | null; root?: string; name?: string; isGitRepo?: boolean };
    // branch is null in detached HEAD (e.g. GitHub Actions PR checkout)
    expect(data.isGitRepo).toBe(true);
    expect(typeof data.root).toBe("string");
    expect(data.root!.length).toBeGreaterThan(0);
    expect(typeof data.name).toBe("string");
    expect(data.name!.length).toBeGreaterThan(0);
    if (data.branch !== null) {
      expect(typeof data.branch).toBe("string");
      expect(data.branch!.length).toBeGreaterThan(0);
    }
  });
});
