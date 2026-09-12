import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "./workspace-transport";

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "./agent-loop-v2";
import { callLLMWithTools } from "./llm-tool-calling";

describe("runAgentLoopV2 — provider exhaustion", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockRejectedValue(
      new Error("All tool-calling models failed. Attempts: gemini-2.5-flash(timeout, 60000ms)"),
    );
  });

  it("emits model_failed + finished and returns deterministically when every provider fails", async () => {
    const fakeTransport = {
      workspaceId: "ws-test",
      userId: "u-test",
      workspaceRoot: "/tmp/test",
      projectId: "p-test",
    } as unknown as WorkspaceTransport;

    const result = await runAgentLoopV2(
      "build a tiny landing page",
      fakeTransport,
      {
        model: "gemini-2.5-flash",
        systemPrompt: "You are LiTT.",
        executionMode: "act",
        enableBuildFix: false,
      },
    );

    expect(result.modelFailed).toBeTruthy();
    expect(result.cancelled).toBe(false);
    expect(result.events.some((e) => e.type === "phase" && e.phase === "call_llm")).toBe(true);
    expect(result.events.some((e) => e.type === "status")).toBe(true);
    expect(result.events.some((e) => e.type === "model_failed")).toBe(true);
    expect(result.events.some((e) => e.type === "finished")).toBe(true);
    expect(result.events.some((e) => e.type === "cancelled")).toBe(false);
  });
});
