/**
 * Unit tests for the canonical LiTT run contract.
 *
 * Tests:
 * - Event schema validation (Zod)
 * - Sequence ordering
 * - Message idempotency
 * - Canvas block idempotency
 * - Retry version linkage
 * - Cancellation state
 * - Kernel decision persistence
 */

import { describe, it, expect } from "vitest";
import {
  LiTTRunEventSchema,
  CanonicalMessageSchema,
  CanvasTranscriptBlockSchema,
  RunStatusSchema,
  CreateRunRequestSchema,
  KernelDecisionSummarySchema,
  formatSSEEvent,
  parseRunEvent,
  type LiTTRunEvent,
  type CanonicalMessage,
} from "@/lib/litt/run-contract";

// ─── Helpers ─────────────────────────────────────────────────────

const RUN_ID = "a0000000-0000-1000-8000-000000000001";
const CONV_ID = "a0000000-0000-1000-8000-000000000002";
const MSG_ID = "a0000000-0000-1000-8000-000000000003";
const BLOCK_ID = "a0000000-0000-1000-8000-000000000004";
const CANVAS_ID = "a0000000-0000-1000-8000-000000000005";

function makeMessage(overrides: Partial<CanonicalMessage> = {}): CanonicalMessage {
  return {
    id: MSG_ID,
    conversationId: CONV_ID,
    runId: RUN_ID,
    role: "user",
    content: "Hello",
    status: "complete",
    inputMode: "text",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

function makeBaseEvent(type: string, sequence: number): Record<string, unknown> {
  return {
    runId: RUN_ID,
    sequence,
    timestamp: "2026-07-28T00:00:00.000Z",
    type,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe("LiTTRunEvent schema validation", () => {
  it("validates run.created event", () => {
    const event = makeBaseEvent("run.created", 1);
    event.conversationId = CONV_ID;
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "run.created",
      runId: RUN_ID,
      sequence: 1,
    });
  });

  it("validates kernel.decision.created event", () => {
    const event = makeBaseEvent("kernel.decision.created", 2);
    event.decision = { mode: "think" };
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "kernel.decision.created",
    });
  });

  it("validates message.user.created event", () => {
    const event = makeBaseEvent("message.user.created", 3);
    event.message = makeMessage();
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "message.user.created",
    });
  });

  it("validates canvas.block.created event", () => {
    const event = makeBaseEvent("canvas.block.created", 4);
    event.block = {
      id: BLOCK_ID,
      canvasId: CANVAS_ID,
      messageId: MSG_ID,
      speaker: "user",
      content: "Hello",
      status: "complete",
      position: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "canvas.block.created",
    });
  });

  it("validates message.assistant.started event", () => {
    const event = makeBaseEvent("message.assistant.started", 5);
    event.message = makeMessage({ role: "assistant", status: "streaming" });
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "message.assistant.started",
    });
  });

  it("validates message.assistant.delta event", () => {
    const event = makeBaseEvent("message.assistant.delta", 6);
    event.messageId = MSG_ID;
    event.delta = "Hello";
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "message.assistant.delta",
      delta: "Hello",
    });
  });

  it("validates canvas.block.updated event", () => {
    const event = makeBaseEvent("canvas.block.updated", 7);
    event.blockId = BLOCK_ID;
    event.content = "Updated content";
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "canvas.block.updated",
      content: "Updated content",
    });
  });

  it("validates message.assistant.completed event", () => {
    const event = makeBaseEvent("message.assistant.completed", 8);
    event.message = makeMessage({ role: "assistant", status: "complete" });
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "message.assistant.completed",
    });
  });

  it("validates run.completed event", () => {
    const event = makeBaseEvent("run.completed", 9);
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "run.completed",
    });
  });

  it("validates run.failed event", () => {
    const event = makeBaseEvent("run.failed", 10);
    event.error = { code: "PROVIDER_FAILED", message: "Error", retryable: true };
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "run.failed",
      error: { code: "PROVIDER_FAILED" },
    });
  });

  it("validates run.cancelled event", () => {
    const event = makeBaseEvent("run.cancelled", 11);
    expect(LiTTRunEventSchema.parse(event)).toMatchObject({
      type: "run.cancelled",
    });
  });

  it("rejects unknown event type", () => {
    const event = makeBaseEvent("unknown.event", 1);
    expect(() => LiTTRunEventSchema.parse(event)).toThrow();
  });

  it("rejects negative sequence", () => {
    const event = makeBaseEvent("run.created", -1);
    event.conversationId = CONV_ID;
    expect(() => LiTTRunEventSchema.parse(event)).toThrow();
  });

  it("rejects zero sequence", () => {
    const event = makeBaseEvent("run.created", 0);
    event.conversationId = CONV_ID;
    expect(() => LiTTRunEventSchema.parse(event)).toThrow();
  });
});

describe("Sequence ordering", () => {
  it("events with increasing sequence are valid", () => {
    const events: LiTTRunEvent[] = [];
    for (let i = 1; i <= 5; i++) {
      const event = makeBaseEvent("run.completed", i);
      events.push(LiTTRunEventSchema.parse(event) as LiTTRunEvent);
    }
    expect(events).toHaveLength(5);
    expect(events[0].sequence).toBe(1);
    expect(events[4].sequence).toBe(5);
  });

  it("formatSSEEvent produces correct SSE format", () => {
    const event = LiTTRunEventSchema.parse(
      makeBaseEvent("run.completed", 1),
    ) as LiTTRunEvent;
    const sse = formatSSEEvent(event);
    expect(sse).toContain("event: run.completed");
    expect(sse).toContain("data: ");
    expect(sse.endsWith("\n\n")).toBe(true);
  });
});

describe("Message idempotency", () => {
  it("CanonicalMessage with same id is the same message", () => {
    const msg1 = makeMessage();
    const msg2 = makeMessage();
    expect(msg1.id).toBe(msg2.id);
    expect(CanonicalMessageSchema.parse(msg1)).toEqual(
      CanonicalMessageSchema.parse(msg2),
    );
  });

  it("rejects invalid message status", () => {
    const msg = makeMessage({ status: "invalid" as CanonicalMessage["status"] });
    expect(() => CanonicalMessageSchema.parse(msg)).toThrow();
  });

  it("rejects invalid input mode", () => {
    const msg = makeMessage({ inputMode: "invalid" as CanonicalMessage["inputMode"] });
    expect(() => CanonicalMessageSchema.parse(msg)).toThrow();
  });
});

describe("Canvas block idempotency", () => {
  it("CanvasTranscriptBlock with same id is the same block", () => {
    const block = {
      id: BLOCK_ID,
      canvasId: CANVAS_ID,
      messageId: MSG_ID,
      speaker: "user" as const,
      content: "Hello",
      status: "complete" as const,
      position: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    const parsed1 = CanvasTranscriptBlockSchema.parse(block);
    const parsed2 = CanvasTranscriptBlockSchema.parse(block);
    expect(parsed1).toEqual(parsed2);
  });

  it("rejects invalid speaker", () => {
    const block = {
      id: BLOCK_ID,
      canvasId: CANVAS_ID,
      messageId: MSG_ID,
      speaker: "invalid",
      content: "Hello",
      status: "complete",
      position: 0,
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
    };
    expect(() => CanvasTranscriptBlockSchema.parse(block)).toThrow();
  });
});

describe("Retry version linkage", () => {
  it("CreateRunRequest validates without conversationId (new conversation)", () => {
    const req = { message: "Hello" };
    const parsed = CreateRunRequestSchema.parse(req);
    expect(parsed.message).toBe("Hello");
    expect(parsed.conversationId).toBeUndefined();
  });

  it("CreateRunRequest validates with conversationId (retry in same conversation)", () => {
    const req = { message: "Hello", conversationId: CONV_ID };
    const parsed = CreateRunRequestSchema.parse(req);
    expect(parsed.conversationId).toBe(CONV_ID);
  });

  it("rejects empty message", () => {
    const req = { message: "" };
    expect(() => CreateRunRequestSchema.parse(req)).toThrow();
  });

  it("rejects message over 8000 chars", () => {
    const req = { message: "x".repeat(8001) };
    expect(() => CreateRunRequestSchema.parse(req)).toThrow();
  });
});

describe("Cancellation state", () => {
  it("RunStatus accepts cancelled", () => {
    expect(RunStatusSchema.parse("cancelled")).toBe("cancelled");
  });

  it("RunStatus accepts all valid states", () => {
    const validStates = ["pending", "running", "streaming", "completed", "failed", "cancelled"];
    for (const s of validStates) {
      expect(RunStatusSchema.parse(s)).toBe(s);
    }
  });

  it("RunStatus rejects invalid state", () => {
    expect(() => RunStatusSchema.parse("invalid")).toThrow();
  });
});

describe("Kernel decision persistence", () => {
  it("KernelDecisionSummary validates with all required fields", () => {
    const summary = {
      mode: "think",
      requiresProject: false,
      capabilityIds: [],
      skillIds: [],
      modelProfileId: "default",
      risk: "low",
      approvalRequired: false,
      assumptions: [],
      unknowns: [],
    };
    const parsed = KernelDecisionSummarySchema.parse(summary);
    expect(parsed.mode).toBe("think");
    expect(parsed.risk).toBe("low");
  });

  it("KernelDecisionSummary rejects missing mode", () => {
    const summary = {
      requiresProject: false,
      capabilityIds: [],
      skillIds: [],
      modelProfileId: "default",
      risk: "low",
      approvalRequired: false,
      assumptions: [],
      unknowns: [],
    };
    expect(() => KernelDecisionSummarySchema.parse(summary)).toThrow();
  });
});

describe("parseRunEvent helper", () => {
  it("parses a valid event from DB row format", () => {
    const event = parseRunEvent(
      "run.completed",
      { type: "run.completed" },
      RUN_ID,
      1,
      "2026-07-28T00:00:00.000Z",
    );
    expect(event.type).toBe("run.completed");
    expect(event.sequence).toBe(1);
  });
});
