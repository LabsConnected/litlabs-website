// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isFailedWorkspaceTurnMessage } from "./route";

/**
 * Unit tests for the honest-Retry guard on the /regenerate endpoint.
 *
 * The endpoint is chat-only (generateText — no agent loop, no tools, no
 * approvals). Regenerating the terminal message of a FAILED workspace run
 * would silently downgrade Retry to a chat reply while the mission stays
 * Idle, so it is refused with 409 WORKSPACE_RETRY_UNSUPPORTED instead.
 */

const FAILED_RUN = {
  id: "run-123",
  runStatus: "failed" as const,
  runCompletedAt: "2026-09-17T13:09:00.000Z",
  resolvedAt: "2026-09-17T13:09:00.000Z",
};

describe("isFailedWorkspaceTurnMessage", () => {
  it("links via the explicit resume:<runId> clientRequestId stamp", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        {
          status: "failed",
          clientRequestId: "resume:run-123",
          updatedAt: "2026-09-17T12:00:00.000Z",
        },
        FAILED_RUN,
      ),
    ).toBe(true);
  });

  it("links via the update-in-place writeback timestamp (message failed at run completion)", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        {
          status: "failed",
          clientRequestId: null,
          updatedAt: "2026-09-17T13:09:00.500Z",
        },
        FAILED_RUN,
      ),
    ).toBe(true);
  });

  it("does not link a message that failed long before the run", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        {
          status: "failed",
          clientRequestId: "chat-only-attempt",
          updatedAt: "2026-09-17T12:00:00.000Z",
        },
        FAILED_RUN,
      ),
    ).toBe(false);
  });

  it("does not link when the message is not failed", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        {
          status: "completed",
          clientRequestId: "resume:run-123",
          updatedAt: "2026-09-17T13:09:00.500Z",
        },
        FAILED_RUN,
      ),
    ).toBe(false);
  });

  it("does not link when the latest run did not fail", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        { status: "failed", clientRequestId: "resume:run-123" },
        { ...FAILED_RUN, runStatus: "completed" },
      ),
    ).toBe(false);
  });

  it("does not link when there is no paused run", () => {
    expect(
      isFailedWorkspaceTurnMessage(
        { status: "failed", clientRequestId: null, updatedAt: "2026-09-17T13:09:00.500Z" },
        null,
      ),
    ).toBe(false);
  });

  it("still permits regenerating a failed chat-only turn (no linked run)", () => {
    // A failed message with a normal chat clientRequestId and a timestamp
    // that does not line up with the failed run's completion stays
    // regenerable — the 409 guard only fires on genuine workspace turns.
    expect(
      isFailedWorkspaceTurnMessage(
        {
          status: "failed",
          clientRequestId: "req_abc123",
          updatedAt: "2026-09-17T10:00:00.000Z",
        },
        FAILED_RUN,
      ),
    ).toBe(false);
  });
});
