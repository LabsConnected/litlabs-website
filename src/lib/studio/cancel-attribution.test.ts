// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Regression tests — cancellation attribution (Repair R4, Diagnosis E3-S1/S6).
 *
 * The defect: every abort of a run's signal was recorded as "Cancelled by
 * user" — the approvals/messages settle sites keyed purely on
 * `signal.aborted` / the loop's `cancelled` flag, and the loop hard-coded
 * the user reason for ANY abort origin. A server shutdown (SIGTERM
 * cutover) abort therefore landed on the canonical record as a user
 * cancellation. Attribution must follow the abort's actual origin: the
 * registry's explicit-cancel aborts carry the user reason; the shutdown
 * routine aborts with its own reason; the helpers below are the single
 * place that distinction is read.
 */

import {
  USER_CANCEL_REASON,
  isUserCancelReason,
  cancelReasonFromAbortSignal,
  isUserCancelAbort,
} from "./cancel-attribution";

const SHUTDOWN_REASON = "Received SIGTERM — shutting down Studio executions";

describe("cancel attribution (R4/E3-S1)", () => {
  it("the user reason is exactly the loop's long-standing string", () => {
    expect(USER_CANCEL_REASON).toBe("Cancelled by user");
    expect(isUserCancelReason("Cancelled by user")).toBe(true);
  });

  it("non-user loop stop reasons are NOT user cancellations", () => {
    for (const reason of [
      "Max steps reached (50)",
      "Max output exceeded (50000 chars)",
      "Max runtime exceeded (600000ms)",
      "Repeated tool call detected: files.read called 3+ times with same inputs and no intervening mutation",
      "The model announced further work but produced no tool calls after retrying; stopping instead of claiming the build is complete.",
      SHUTDOWN_REASON,
      undefined,
      null,
      "",
    ]) {
      expect(isUserCancelReason(reason)).toBe(false);
    }
  });

  it("an abort carrying the user reason reads as a user cancellation", () => {
    const controller = new AbortController();
    controller.abort(new Error("Cancelled by user"));
    expect(isUserCancelAbort(controller.signal)).toBe(true);
    expect(cancelReasonFromAbortSignal(controller.signal)).toBe("Cancelled by user");
  });

  it("an abort carrying the shutdown reason is NOT a user cancellation and keeps its real reason", () => {
    const controller = new AbortController();
    controller.abort(new Error(SHUTDOWN_REASON));
    expect(isUserCancelAbort(controller.signal)).toBe(false);
    expect(cancelReasonFromAbortSignal(controller.signal)).toBe(SHUTDOWN_REASON);
  });

  it("a bare abort() (no explicit reason) keeps the historical user attribution", () => {
    // The only production aborters are the explicit-cancel registry path
    // (user reason) and shutdown (its own reason). A reason-less abort
    // has no non-user origin to attribute, so the historical reading —
    // user cancellation — stands.
    const controller = new AbortController();
    controller.abort();
    expect(isUserCancelAbort(controller.signal)).toBe(true);
    expect(cancelReasonFromAbortSignal(controller.signal)).toBe("Cancelled by user");
  });

  it("an un-aborted signal is not a cancellation of any kind", () => {
    const controller = new AbortController();
    expect(isUserCancelAbort(controller.signal)).toBe(false);
  });
});
