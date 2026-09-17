// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findRetryResendText } from "./retry-strategy";

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
