// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

/**
 * Round 14 — a saved generated image renders inline in chat.
 *
 * The image handler's markdown payload is deliberately stripped by
 * maybeAutoInsertGeneratedImage whenever the project save succeeds
 * (the model must never re-emit it), which also removed the only
 * inline-render channel: the 2026-11-17 lion proof's image saved,
 * the gate passed, and chat showed nothing. The registry now
 * preserves a UI-only chatImage payload on the result, and the loop
 * appends the render markdown to the settled final text itself.
 * This test drives the resume path (the lion run was a resume): an
 * approved image.generate whose result carries chatImage must land
 * in the run's finalText as markdown — written by the loop, not
 * the model (the mocked model text contains no markdown).
 */

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await (importOriginal() as Promise<Record<string, unknown>>)),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await (original() as Promise<Record<string, unknown>>)),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { resumeAgentLoopV2, type ResumeInput } from "../agent-loop-v2";
import {
  buildAssistantToolCallMessage,
  callLLMWithTools,
  type LLMMessage,
} from "../llm-tool-calling";
import { toolRegistry } from "../tool-registry";

const IMAGE_URL = "https://cdn.example.com/lion.png";

function makeTransport() {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async () => null),
    stat: vi.fn(async () => ({ kind: "unknown" })),
  } as unknown as WorkspaceTransport;
}

function makePausedInput(): ResumeInput {
  const inputs = { prompt: "A lion, golden light" };
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [{ toolId: "image.generate", toolCallId: "tc-img-1", inputs }],
    "Generating the lion.",
    undefined,
  );
  return {
    pausedMessages: [
      { role: "user", content: "Make me an image of a lion" },
      assistantMsg,
    ],
    toolId: "image.generate",
    toolCallId: "tc-img-1",
    inputs,
    decision: "approved",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: 1,
    hadInterveningMutation: false,
  };
}

describe("chat image inline render (round 14)", () => {
  let executeSpy: MockInstance<typeof toolRegistry.execute>;

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    executeSpy = vi.spyOn(toolRegistry, "execute");
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  it("the settled final text carries the generated image as markdown, appended by the loop", async () => {
    executeSpy.mockImplementation(async (toolId: string) => {
      expect(toolId).toBe("image.generate");
      return {
        ok: true,
        result: {
          success: true,
          downloadUrl: IMAGE_URL,
          title: "A lion, golden light",
          savedToProject: true,
          projectPath: "public/assets/images/lion.png",
          sitePath: "/assets/images/lion.png",
          // The registry's round-14 UI-only payload.
          chatImage: { url: IMAGE_URL, prompt: "A lion, golden light" },
        },
      } as never;
    });
    // The model's closing text contains NO image markdown — if the
    // markdown appears in the outcome, the loop put it there.
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Here is your lion.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    } as never);

    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());

    expect(result.finalText).toContain("Here is your lion.");
    expect(result.finalText).toContain(`![A lion, golden light](${IMAGE_URL})`);
    // Exactly once.
    expect(result.finalText.split(IMAGE_URL)).toHaveLength(2);
  });

  it("no chatImage payload → no markdown is fabricated", async () => {
    executeSpy.mockImplementation(async () => ({
      ok: true,
      result: {
        success: true,
        downloadUrl: IMAGE_URL,
        savedToProject: true,
        sitePath: "/assets/images/lion.png",
      },
    }) as never);
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Here is your lion.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    } as never);

    const result = await resumeAgentLoopV2(makePausedInput(), makeTransport());

    expect(result.finalText).toContain("Here is your lion.");
    expect(result.finalText).not.toContain("![");
  });
});
