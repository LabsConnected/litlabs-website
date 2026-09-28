import { describe, expect, it } from "vitest";
import { consumeSseChunk, parseSseBody, toProgressEvent, type ConversationStreamEvent } from "./sse";

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("consumeSseChunk", () => {
  it("parses the conversation stream event types the messages route emits", () => {
    const body = [
      frame({ type: "phase", phase: "call_llm", step: 1 }),
      frame({ type: "tool_execution", toolId: "files.read", summary: "Read page.tsx" }),
      frame({ type: "tool_execution", toolId: "files.write", success: true, summary: "Updated page.tsx", durationMs: 12 }),
      frame({ type: "approval_required", toolId: "project.deploy", reason: "Deploys production" }),
      frame({ type: "pending_approval", toolId: "project.deploy", reason: "Deploys production", pausedRunId: "pause-1" }),
      frame({ type: "checkpoint", label: "before deploy", gitSha: "abc" }),
      frame({ type: "build_start", check: "typecheck" }),
      frame({ type: "build_result", check: "typecheck", passed: true }),
      frame({ type: "workspace_change", status: "changed", files: ["a.ts"], additions: 1, deletions: 0 }),
      frame({ type: "repair_attempt", attempt: 1, maxAttempts: 3 }),
      frame({ type: "preview_start" }),
      frame({ type: "preview_status", status: "booting", healthy: false }),
      frame({ type: "preview_result", success: true, previewUrl: "https://preview.example" }),
      frame({ type: "deploy_start", environment: "production", provider: "vercel" }),
      frame({ type: "deploy_status", status: "building", deploymentId: "dpl_1" }),
      frame({ type: "deploy_result", success: true, productionUrl: "https://app.example" }),
      frame({ type: "deploy_verify", url: "https://app.example", success: true, detail: "200" }),
      frame({ type: "model_routing", model: "gpt", provider: "openai", fallbackFrom: "auto", category: "chat", latencyMs: 40 }),
      frame({ type: "step_timing", step: 1, stepDurationMs: 10, elapsedMs: 10 }),
      frame({ type: "model_response", provider: "openai", model: "gpt", finishReason: "stop", contentType: "text", contentLength: 4, messageKeys: ["content"], toolCalls: [] }),
      frame({ type: "model_failed", model: "gpt", category: "rate_limit", message: "slow down" }),
      frame({ type: "reasoning", summary: "Checking the layout" }),
      frame({ type: "reasoning", text: "token" }),
      frame({ type: "status", summary: "Still working" }),
      frame({ type: "quality_verdict", passed: false, missing: ["hero"], reason: "thin", designPasses: 1 }),
      frame({ type: "text", text: "Hello" }),
      frame({ type: "finished", totalSteps: 2, totalDurationMs: 30, success: true }),
      frame({ type: "cancelled", reason: "Stopped by user" }),
      frame({ type: "error", message: "provider down", code: "PROVIDER", partialText: "Hel" }),
      frame({ type: "done", revision: 4, assistantMessage: { id: "a1" } }),
      "data: [DONE]\n\n",
    ].join("");

    const parsed = parseSseBody(body);
    expect(parsed.done).toBe(true);
    expect(parsed.malformed).toBe(0);
    expect(parsed.rest).toBe("");
    expect(parsed.events.map((event) => event.type)).toEqual([
      "phase",
      "tool_execution",
      "tool_execution",
      "approval_required",
      "pending_approval",
      "checkpoint",
      "build_start",
      "build_result",
      "workspace_change",
      "repair_attempt",
      "preview_start",
      "preview_status",
      "preview_result",
      "deploy_start",
      "deploy_status",
      "deploy_result",
      "deploy_verify",
      "model_routing",
      "step_timing",
      "model_response",
      "model_failed",
      "reasoning",
      "reasoning",
      "status",
      "quality_verdict",
      "text",
      "finished",
      "cancelled",
      "error",
      "done",
    ]);

    const toolStart = parsed.events[1];
    expect(toolStart).toMatchObject({ type: "tool_execution", toolId: "files.read" });
    const pending = parsed.events[4];
    expect(pending).toMatchObject({ type: "pending_approval", pausedRunId: "pause-1" });
  });

  it("keeps an incomplete line for the next chunk and ignores malformed JSON", () => {
    const first = consumeSseChunk("", 'data: {"type":"text","text":"Hi"}\n\ndata: {"type":');
    expect(first.events).toEqual([{ type: "text", text: "Hi" }]);
    expect(first.rest).toBe('data: {"type":');

    const second = consumeSseChunk(first.rest, '"text","text":"!"}\n\ndata: {not json}\n\ndata: [DONE]\n');
    expect(second.events).toEqual([{ type: "text", text: "!" }]);
    expect(second.malformed).toBe(1);
    expect(second.done).toBe(true);
  });

  it("ignores comments, blank lines, and unknown event types", () => {
    const parsed = parseSseBody(": keep-alive\n\ndata: {\"type\":\"not-a-real-event\"}\n\n");
    expect(parsed.events).toEqual([]);
    expect(parsed.malformed).toBe(0);
  });
});

describe("toProgressEvent", () => {
  it("maps tool_execution onto tool_start and tool_result", () => {
    expect(toProgressEvent({ type: "tool_execution", toolId: "files.read", summary: "Read" })).toEqual({
      type: "tool_start",
      toolId: "files.read",
      summary: "Read",
    });
    expect(toProgressEvent({
      type: "tool_execution",
      toolId: "files.write",
      success: false,
      summary: "Failed",
      durationMs: 8,
    })).toEqual({
      type: "tool_result",
      toolId: "files.write",
      success: false,
      summary: "Failed",
      durationMs: 8,
    });
  });

  it("maps both reasoning shapes onto a progress reasoning event", () => {
    expect(toProgressEvent({ type: "reasoning", summary: "Looking" })).toEqual({
      type: "reasoning",
      summary: "Looking",
    });
    expect(toProgressEvent({ type: "reasoning", text: "token" })).toEqual({
      type: "reasoning",
      summary: "token",
    });
  });

  it("leaves transcript-only events unmapped", () => {
    const transcript: ConversationStreamEvent[] = [
      { type: "text", text: "Hi" },
      { type: "pending_approval", toolId: "deploy", pausedRunId: "p1" },
      { type: "done", revision: 2 },
      { type: "error", message: "nope" },
      { type: "actions", actions: [] },
    ];
    for (const event of transcript) {
      expect(toProgressEvent(event)).toBeNull();
    }
  });

  it("passes real progress events through", () => {
    const phase = toProgressEvent({ type: "phase", phase: "execute", step: 2 });
    expect(phase).toEqual({ type: "phase", phase: "execute", step: 2 });
    const finished = toProgressEvent({ type: "finished", totalSteps: 1, totalDurationMs: 5, success: true });
    expect(finished).toMatchObject({ type: "finished", success: true });
  });
});
