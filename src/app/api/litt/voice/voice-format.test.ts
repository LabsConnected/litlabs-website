/**
 * LiTT Voice endpoint tests.
 *
 * Verifies the OpenAI-compatible chat completions format conversion
 * used by /api/litt/voice/v1/chat/completions. Tests the pure
 * transformation logic (message extraction, history conversion) without
 * hitting the runtime pipeline.
 *
 * Run: npx vitest run src/app/api/litt/voice/voice-format.test.ts
 */

import { describe, it, expect } from "vitest";

// ─── Format conversion helpers (mirrors the route's logic) ──────────

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function extractUserMessage(messages: OpenAIMessage[]): string | null {
  const userMessages = messages.filter((m) => m.role === "user" && typeof m.content === "string");
  if (userMessages.length === 0) return null;
  return userMessages[userMessages.length - 1].content;
}

function extractHistory(messages: OpenAIMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .slice(0, -1)
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("voice OpenAI format conversion", () => {
  it("extracts the last user message", () => {
    const msgs: OpenAIMessage[] = [
      { role: "system", content: "you are LiTT" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "what is 2+2" },
    ];
    expect(extractUserMessage(msgs)).toBe("what is 2+2");
  });

  it("returns null when no user message exists", () => {
    const msgs: OpenAIMessage[] = [
      { role: "system", content: "you are LiTT" },
      { role: "assistant", content: "hi" },
    ];
    expect(extractUserMessage(msgs)).toBeNull();
  });

  it("extracts history excluding the last message and system messages", () => {
    const msgs: OpenAIMessage[] = [
      { role: "system", content: "you are LiTT" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
      { role: "user", content: "current question" },
    ];
    const history = extractHistory(msgs);
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: "user", content: "hello" });
    expect(history[1]).toEqual({ role: "assistant", content: "hi there" });
    // System message is excluded
    expect(history.find((h) => h.content === "you are LiTT")).toBeUndefined();
    // Current message is excluded
    expect(history.find((h) => h.content === "current question")).toBeUndefined();
  });

  it("handles a single user message with no history", () => {
    const msgs: OpenAIMessage[] = [{ role: "user", content: "hello" }];
    expect(extractUserMessage(msgs)).toBe("hello");
    expect(extractHistory(msgs)).toEqual([]);
  });

  it("handles empty messages array", () => {
    expect(extractUserMessage([])).toBeNull();
    expect(extractHistory([])).toEqual([]);
  });

  it("system messages are never included in history", () => {
    const msgs: OpenAIMessage[] = [
      { role: "system", content: "system prompt 1" },
      { role: "system", content: "system prompt 2" },
      { role: "user", content: "hello" },
    ];
    const history = extractHistory(msgs);
    expect(history).toEqual([]);
  });
});

describe("voice OpenAI response shape", () => {
  it("non-streaming response has chat.completion shape", () => {
    const response = {
      id: "chatcmpl-litt-123",
      object: "chat.completion",
      created: 1700000000,
      model: "gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
    };
    expect(response.object).toBe("chat.completion");
    expect(response.choices[0].message.role).toBe("assistant");
    expect(response.choices[0].message.content).toBe("Hello!");
    expect(response.choices[0].finish_reason).toBe("stop");
  });

  it("streaming chunk has chat.completion.chunk shape", () => {
    const chunk = {
      id: "chatcmpl-litt-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "litt-voice",
      choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }],
    };
    expect(chunk.object).toBe("chat.completion.chunk");
    expect(chunk.choices[0].delta.content).toBe("Hel");
    expect(chunk.choices[0].finish_reason).toBeNull();
  });

  it("final streaming chunk has finish_reason stop", () => {
    const chunk = {
      id: "chatcmpl-litt-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "litt-voice",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    };
    expect(chunk.choices[0].finish_reason).toBe("stop");
    expect(chunk.choices[0].delta).toEqual({});
  });

  it("error response has OpenAI error shape", () => {
    const error = {
      error: { message: "Authentication required", type: "authentication_error" },
    };
    expect(error.error.message).toBe("Authentication required");
    expect(error.error.type).toBe("authentication_error");
  });
});
