// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

/**
 * Round 11, Fix 2 — integration: the lion proof's fact pattern through
 * the REAL resume loop.
 *
 * Paused state mirrors the proof (2026-11-16, fcd7a3c5): the approved
 * image generation already succeeded and saved into the project
 * (priorToolCalls), a redundant image.saveAsset call failed on its
 * result id, no checkpoint exists (checkpoint creation failed, so the
 * workspace verification will be "unknown"), the quality gate is a
 * media-scope session whose required stages the system files — and
 * the continuation model call exhausts every route.
 *
 * Before the fix this settled run.failed with "all AI routes
 * unavailable" as the headline. Now it must settle completed with a
 * warning, keep the honest text, record every contributor, and emit a
 * finished event whose success agrees with the outcome.
 */

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { resumeAgentLoopV2, type ResumeInput } from "../agent-loop-v2";
import {
  AllRoutesFailedError,
  buildAssistantToolCallMessage,
  callLLMWithTools,
  type LLMMessage,
} from "../llm-tool-calling";

function makeTransport() {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    mkdir: vi.fn(async () => ({ created: true })),
    // Checkpoint creation fails (returns null) — the proof's Q2 state.
    createCheckpointBeforeMutation: vi.fn(async () => null),
    listFiles: vi.fn(async () => ({ entries: [] })),
  } as unknown as WorkspaceTransport;
}

function makePausedInput(): ResumeInput {
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "files.mkdir", toolCallId: "tc-1", inputs: { path: "public/assets/images" } }],
    "Saving the generated image.",
    undefined,
  );
  const pausedMessages: LLMMessage[] = [
    { role: "user", content: "Generate an image of a lion and save it to this project." },
    assistantMsg,
  ];
  return {
    pausedMessages,
    toolId: "files.mkdir",
    toolCallId: "tc-1",
    inputs: { path: "public/assets/images" },
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
      qualityLoop: {
        enabled: true,
        runId: "round11-proof",
        projectId: "p-test",
        userId: "u-test",
        userRequest: "Generate an image of a lion and save it to this project.",
        taskScope: "media",
      },
    },
    stepsUsedBeforePause: 3,
    hadInterveningMutation: true,
    priorToolCalls: [
      {
        toolId: "image.generate",
        success: true,
        summary:
          "Image generated and saved to project (public/assets/images/a-lion-mwjuqfd3.jpeg)",
        mutating: true,
        paths: ["public/assets/images/a-lion-mwjuqfd3.jpeg"],
      },
      {
        toolId: "image.saveAsset",
        success: false,
        summary:
          'Cannot save "pollinations_1794869122578": not a known result id and not a public URL. Generate first or pass the resultId.',
        mutating: true,
      },
    ],
  };
}

describe("resumeAgentLoopV2 — round-11 proof pattern settlement", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    // The continuation (wrap-up) call exhausts every route.
    vi.mocked(callLLMWithTools).mockRejectedValue(
      new AllRoutesFailedError(
        [
          {
            provider: "gemini",
            model: "gemini-2.5-flash",
            class: "rate_limited",
            httpStatus: 429,
            latencyMs: 1200,
            message: "quota exhausted",
          },
        ],
        [{ provider: "openrouter", reason: "model not in registry" }],
      ),
    );
  });

  it("settles completed-with-warning: deliverable landed, gate passed, only the wrap-up call failed", async () => {
    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());

    // The route failure is still a recorded fact…
    expect(result.modelFailed).toBeTruthy();
    // …but it is not the verdict.
    expect(result.runObservability?.outcome).toBe("completed");
    expect(result.completedWithWarning).toBeDefined();
    expect(result.finalText).toBe(result.completedWithWarning);
    expect(result.finalText).toMatch(/requested work is complete/i);
    expect(result.finalText).toMatch(/closing summary/i);
    expect(result.finalText).not.toMatch(/couldn't complete this request/i);
    expect(result.failedHonestly).toBeUndefined();
    expect(result.cancelled).toBe(false);
  });

  it("the quality gate passed (media scope) — the premise of the settlement", async () => {
    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());
    expect(result.qualityLoop?.verdict.ok).toBe(true);
  });

  it("records every failure contributor: the saveAsset defect, the unknown verification, the routes", async () => {
    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());
    const contributors = result.failureContributors ?? [];
    const toolFailure = contributors.find((c) => c.kind === "tool_failure");
    expect(toolFailure?.toolId).toBe("image.saveAsset");
    expect(toolFailure?.detail).toMatch(/not a known result id/);
    expect(contributors.some((c) => c.kind === "verification_unknown")).toBe(true);
    expect(contributors.some((c) => c.kind === "model_routes")).toBe(true);
  });

  it("the finished event's success agrees with the persisted outcome", async () => {
    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());
    const finished = result.events.find((e) => e.type === "finished");
    expect(finished).toBeDefined();
    expect((finished as { success?: boolean }).success).toBe(true);
    expect(result.runObservability?.outcome).toBe("completed");
  });

  it("control: same routes failure with NO landed deliverable still settles failed", async () => {
    const input = makePausedInput();
    input.priorToolCalls = [];
    input.hadInterveningMutation = false;
    // The approved call itself fails at the transport: nothing landed.
    const transport = makeTransport();
    (transport.mkdir as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("exec failed (500)"));
    const result = await resumeAgentLoopV2(input, transport);
    expect(result.runObservability?.outcome).toBe("failed");
    expect(result.completedWithWarning).toBeUndefined();
    const finished = result.events.find((e) => e.type === "finished");
    expect((finished as { success?: boolean }).success).toBe(false);
  });
});
