// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerExecution,
  unregisterExecution,
  getActiveExecution,
  requestExecutionCancellation,
  resetExecutionRegistryForTests,
} from "./execution-registry";

/**
 * Unit tests for the Studio execution registry — the mechanism that keeps
 * transport lifetime separate from execution lifetime and routes explicit
 * Stop requests to the correct run's AbortController.
 */

function makeEntry(overrides: Partial<Parameters<typeof registerExecution>[0]> = {}) {
  return {
    conversationId: "conv-1",
    userId: "user-1",
    clientRequestId: "req-1",
    assistantMessageId: `msg-${Math.random().toString(36).slice(2)}`,
    controller: new AbortController(),
    ...overrides,
  };
}

describe("execution-registry", () => {
  beforeEach(() => {
    resetExecutionRegistryForTests();
  });

  it("registers and unregisters an active execution", () => {
    const entry = makeEntry();
    const { key } = registerExecution(entry);
    expect(getActiveExecution("conv-1")?.assistantMessageId).toBe(entry.assistantMessageId);
    unregisterExecution("conv-1", key);
    expect(getActiveExecution("conv-1")).toBeNull();
  });

  it("aborts the execution controller on an explicit cancellation request", () => {
    const entry = makeEntry();
    registerExecution(entry);
    const result = requestExecutionCancellation("conv-1", "user-1", "req-1");
    expect(result.status).toBe("aborted");
    expect(entry.controller.signal.aborted).toBe(true);
  });

  it("does not abort another user's execution", () => {
    const entry = makeEntry();
    registerExecution(entry);
    const result = requestExecutionCancellation("conv-1", "user-2", "req-1");
    expect(result.status).toBe("forbidden");
    expect(entry.controller.signal.aborted).toBe(false);
  });

  it("does not abort a run when clientRequestId belongs to a different run", () => {
    const entry = makeEntry({ clientRequestId: "req-new" });
    registerExecution(entry);
    const result = requestExecutionCancellation("conv-1", "user-1", "req-stale");
    expect(result.status).toBe("not_found");
    expect(entry.controller.signal.aborted).toBe(false);
  });

  it("records a pending cancel that pre-aborts a run registering shortly after", () => {
    // Stop arrives while the POST is still in flight — no execution is
    // registered yet, so a stamp is recorded instead of reporting not_found.
    const result = requestExecutionCancellation("conv-1", "user-1", "req-1");
    expect(result.status).toBe("recorded");

    const entry = makeEntry();
    registerExecution(entry);
    expect(entry.controller.signal.aborted).toBe(true);
  });

  it("a pending cancel stamp does not abort a different user's run", () => {
    requestExecutionCancellation("conv-1", "user-2", "req-1");
    const entry = makeEntry({ userId: "user-1" });
    registerExecution(entry);
    expect(entry.controller.signal.aborted).toBe(false);
  });

  it("a pending cancel stamp with a different clientRequestId does not abort the run", () => {
    requestExecutionCancellation("conv-1", "user-1", "req-old");
    const entry = makeEntry({ clientRequestId: "req-new" });
    registerExecution(entry);
    expect(entry.controller.signal.aborted).toBe(false);
  });

  it("unregistration only removes the exact registration", () => {
    const first = makeEntry({ assistantMessageId: "msg-first" });
    const second = makeEntry({ assistantMessageId: "msg-second" });
    const { key: firstKey } = registerExecution(first);
    registerExecution(second);
    // The older run's cleanup must not remove the newer registration.
    unregisterExecution("conv-1", firstKey);
    expect(getActiveExecution("conv-1")?.assistantMessageId).toBe("msg-second");
  });

  it("a stale Stop for a finished run cannot cancel the next run", () => {
    // Run A registers and finishes.
    const runA = makeEntry({ clientRequestId: "request-A", assistantMessageId: "msg-A" });
    const { key: keyA } = registerExecution(runA);
    unregisterExecution("conv-1", keyA);
    expect(getActiveExecution("conv-1")).toBeNull();

    // A late Stop for run A arrives after it unregistered — recorded as a
    // pending stamp keyed to request-A, not a wildcard.
    const result = requestExecutionCancellation("conv-1", "user-1", "request-A");
    expect(result.status).toBe("recorded");

    // Run B registers with a different request id — the stale stamp must
    // NOT pre-abort it.
    const runB = makeEntry({ clientRequestId: "request-B", assistantMessageId: "msg-B" });
    registerExecution(runB);
    expect(runB.controller.signal.aborted).toBe(false);
    expect(getActiveExecution("conv-1")?.assistantMessageId).toBe("msg-B");

    // An explicit cancel for run B still works.
    const cancelB = requestExecutionCancellation("conv-1", "user-1", "request-B");
    expect(cancelB.status).toBe("aborted");
    expect(runB.controller.signal.aborted).toBe(true);
  });
});
