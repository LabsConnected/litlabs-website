// @vitest-environment node
/**
 * Regression: quote mismatch on one approval card (gap map
 * ART-20261020-011 §4.5; observed on staging run 32e3a25f: card face
 * "Estimated resume cost: 9" vs Activity "Estimated cost: 8" — two
 * figures inside ONE reason string, from two estimators).
 *
 * Construction of the defect:
 *  1. The loop's pause sites appended `Estimated cost:
 *     ${cfg.billingEstimateBits}` — the stale INITIAL-run estimate.
 *  2. The messages route then appends `resumeQuoteDisclosure(
 *     pausedMessages)` — "Estimated resume cost: N" where N =
 *     computeResumeQuoteBits(pausedMessages), the figure the approvals
 *     route actually reserves (approvals route: "the reservation below
 *     holds exactly the amount the user approved").
 *
 * The fix removes the loop's append, so the persisted reason carries
 * exactly ONE cost figure: the binding resume quote.
 *
 * These tests drive the real loop pause, then apply the real route
 * persistence step verbatim (messages/route.ts: reason +
 * resumeQuoteDisclosure(pausedMessages)) and inspect the persisted
 * string the card renders. The reserved-amount equality is asserted
 * against the approvals route's own formula on the same messages after
 * a JSON round-trip (the DB persistence the route performs), whose
 * serialized length — the estimate's only input — is invariant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { runAgentLoopV2, resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { callLLMWithTools, buildAssistantToolCallMessage, type LLMMessage } from "./llm-tool-calling";
import type { WorkspaceTransport } from "./workspace-transport";
import { computeResumeQuoteBits, resumeQuoteDisclosure } from "@/lib/agent-billing";

/** The stale initial-run estimate, as the messages route computes and
 *  injects it (route: estimatedCost → v2Config.billingEstimateBits). */
const STALE_INITIAL_ESTIMATE = 8;

const transport = {
  workspaceId: "ws-test",
  userId: "u-test",
  workspaceRoot: "/tmp/test",
  projectId: "p-test",
  mkdir: vi.fn(async () => ({ created: true })),
  writeFile: vi.fn(async () => ({ saved: true })),
  createCheckpointBeforeMutation: vi.fn(async () => null),
} as unknown as WorkspaceTransport;

/** Every "Estimated … cost: N LiTTBits" figure in a reason string. */
function costFigures(reason: string): number[] {
  return [...reason.matchAll(/Estimated (?:resume )?cost: (\d+) LiTTBits/g)].map(
    (m) => Number(m[1]),
  );
}

/**
 * The messages route's pause-persistence step, verbatim in shape:
 * the stored approval reason is the loop's reason plus the resume
 * quote disclosure computed from the frozen pausedMessages.
 */
function persistedReason(
  pendingApproval: { reason: string; pausedMessages: readonly unknown[] },
): { stored: string; reserved: number } {
  const stored =
    pendingApproval.reason + resumeQuoteDisclosure(pendingApproval.pausedMessages);
  // The approvals route reserves computeResumeQuoteBits over the paused
  // messages as recovered from the DB (a JSON round-trip).
  const roundTripped = JSON.parse(
    JSON.stringify(pendingApproval.pausedMessages),
  ) as unknown[];
  return { stored, reserved: computeResumeQuoteBits(roundTripped) };
}

function expectSingleBindingFigure(
  pendingApproval: { reason: string; pausedMessages: readonly unknown[] } | undefined,
) {
  expect(pendingApproval).toBeDefined();
  const { stored, reserved } = persistedReason(pendingApproval!);
  // Precondition: the two estimators genuinely disagree in this
  // scenario, so a single-figure result cannot be vacuous.
  expect(reserved).not.toBe(STALE_INITIAL_ESTIMATE);
  const figures = costFigures(stored);
  expect(figures).toEqual([reserved]);
  expect(stored).not.toContain(`Estimated cost: ${STALE_INITIAL_ESTIMATE} LiTTBits`);
  expect(stored).toContain(`Estimated resume cost: ${reserved} LiTTBits`);
}

describe("approval quote consistency — initial loop pause site", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValueOnce({
      text: "",
      toolCalls: [
        {
          toolCallId: "tc-quote-1",
          toolId: "files.write",
          inputs: {
            projectId: "p-test",
            path: "index.html",
            content: "<html><title>Harbor Coffee</title></html>",
          },
        },
      ],
      finishReason: "tool_calls",
      model: "test-model",
    });
  });

  it("the persisted approval reason carries exactly one cost figure — the binding resume quote", async () => {
    const result = await runAgentLoopV2("build the Harbor Coffee site", transport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
      billingEstimateBits: STALE_INITIAL_ESTIMATE,
    });
    expect(result.pendingApproval?.toolId).toBe("files.write");
    expectSingleBindingFigure(result.pendingApproval);
  });
});

describe("approval quote consistency — resume loop pause site", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    // Continuation turn: the model calls another gated mutation, which
    // pauses at the resume site (~L3083) with the stale estimate set.
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "",
      toolCalls: [
        {
          toolCallId: "tc-quote-2",
          toolId: "files.write",
          inputs: {
            projectId: "p-test",
            path: "about.html",
            content: "<html><title>About Harbor Coffee</title></html>",
          },
        },
      ],
      finishReason: "tool_calls",
      model: "test-model",
    });
  });

  it("a nested pause on resume also carries exactly one cost figure", async () => {
    const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
      [{ toolId: "files.mkdir", toolCallId: "tc-quote-0", inputs: { path: "site" } }],
      "Creating the site directory.",
      undefined,
    );
    const input: ResumeInput = {
      pausedMessages: [
        { role: "user", content: "Build the Harbor Coffee site" },
        assistantMsg,
      ],
      toolId: "files.mkdir",
      toolCallId: "tc-quote-0",
      inputs: { path: "site" },
      decision: "approved",
      config: {
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
        billingEstimateBits: STALE_INITIAL_ESTIMATE,
      },
      stepsUsedBeforePause: 1,
      hadInterveningMutation: false,
    };
    const result = await resumeAgentLoopV2(input, transport);
    expect(result.pendingApproval?.toolId).toBe("files.write");
    expectSingleBindingFigure(result.pendingApproval);
  });
});
