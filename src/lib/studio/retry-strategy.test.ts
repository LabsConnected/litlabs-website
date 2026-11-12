// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findRetryResendText, resolveCanonicalRetryTarget } from "./retry-strategy";

/**
 * Unit tests for the client's honest-Retry decision.
 *
 * A failed turn means the work never completed. The chat-only regenerate API
 * cannot re-run workspace operations — the mission would stay Idle while a
 * fresh chat reply appears. So Retry on a failed assistant message re-sends
 * the parent user message through the normal send pipeline (V2 agent loop,
 * approvals, streaming) instead of calling the regenerate API.
 */

const MESSAGES = [
  { id: "u1", role: "user", content: "Generate an image of a lighthouse" },
  { id: "a1", role: "assistant", content: "Failed to generate.", parentMessageId: "u1" },
];

describe("findRetryResendText", () => {
  it("returns the parent user text for a failed turn", () => {
    expect(
      findRetryResendText(
        { status: "failed", parentMessageId: "u1" },
        MESSAGES,
      ),
    ).toBe("Generate an image of a lighthouse");
  });

  it("returns null for a completed turn (regenerate API is fine there)", () => {
    expect(
      findRetryResendText(
        { status: "completed", parentMessageId: "u1" },
        MESSAGES,
      ),
    ).toBeNull();
  });

  it("returns null when the failed message has no parent message", () => {
    expect(
      findRetryResendText({ status: "failed", parentMessageId: null }, MESSAGES),
    ).toBeNull();
  });

  it("returns null when the parent message cannot be found", () => {
    expect(
      findRetryResendText({ status: "failed", parentMessageId: "missing" }, MESSAGES),
    ).toBeNull();
  });

  it("returns null when the parent user message is blank", () => {
    expect(
      findRetryResendText({ status: "failed", parentMessageId: "u1" }, [
        { id: "u1", role: "user", content: "   " },
        { id: "a1", role: "assistant", content: "Failed." },
      ]),
    ).toBeNull();
  });

  it("ignores a parent that is not a user message", () => {
    expect(
      findRetryResendText({ status: "failed", parentMessageId: "a1" }, MESSAGES),
    ).toBeNull();
  });
});

describe("resolveCanonicalRetryTarget", () => {
  const CANONICAL = [
    { id: "u1", role: "user", content: "Inspect the preview page", status: "completed", parentMessageId: null, clientRequestId: "req-1" },
    { id: "a1", role: "assistant", content: "Failed.", status: "failed", parentMessageId: "u1", clientRequestId: "req-1" },
    { id: "u2", role: "user", content: "Thanks", status: "completed", parentMessageId: null, clientRequestId: "req-2" },
    { id: "a2", role: "assistant", content: "You're welcome.", status: "completed", parentMessageId: "u2", clientRequestId: "req-2" },
  ];

  it("matches by exact id", () => {
    expect(resolveCanonicalRetryTarget({ id: "a1" }, CANONICAL)?.id).toBe("a1");
  });

  it("matches by clientRequestId when the store id is an optimistic one", () => {
    expect(
      resolveCanonicalRetryTarget({ id: "optimistic_a1", clientRequestId: "req-1" }, CANONICAL)?.id,
    ).toBe("a1");
  });

  it("falls back to the only failed assistant message when no id matches", () => {
    expect(
      resolveCanonicalRetryTarget({ id: "local_assistant_123", status: "failed" }, CANONICAL)?.id,
    ).toBe("a1");
  });

  it("does not adopt a failed turn for a target that is not itself failed", () => {
    expect(
      resolveCanonicalRetryTarget({ id: "local_assistant_123", status: "streaming" }, CANONICAL),
    ).toBeNull();
  });

  it("never guesses among several failed assistant messages", () => {
    const two = [
      ...CANONICAL,
      { id: "a3", role: "assistant", content: "Also failed.", status: "failed", parentMessageId: "u2", clientRequestId: "req-3" },
    ];
    expect(resolveCanonicalRetryTarget({ id: "local_assistant_123", status: "failed" }, two)).toBeNull();
  });

  it("returns null when the canonical list has no failed assistant message", () => {
    const none = CANONICAL.filter((m) => m.id !== "a1");
    expect(resolveCanonicalRetryTarget({ id: "gone", status: "failed" }, none)).toBeNull();
  });

  it("does not match a user message by id", () => {
    expect(resolveCanonicalRetryTarget({ id: "u1" }, CANONICAL)).toBeNull();
  });
});
