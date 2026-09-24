import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActionRunByBrowserSession: vi.fn(),
  recordActionEventActivity: vi.fn(),
  transitionActionRunEventActivity: vi.fn(),
}));

vi.mock("./run-store", () => mocks);

import {
  BROWSER_SESSION_IDLE_TIMEOUT_CODE,
  reconcileSweptBrowserSession,
} from "./browser-sweep";

const run = {
  id: "run-one",
  userId: "user-one",
  projectId: null,
  conversationId: "conversation-one",
  kind: "browser" as const,
  status: "working" as const,
  createdAt: "2026-09-23T00:00:00.000Z",
  startedAt: "2026-09-23T00:00:01.000Z",
  updatedAt: "2026-09-23T00:00:01.000Z",
  completedAt: null,
  currentActivity: "Working in the browser",
  browserSessionId: "session-one",
  cancellationRequestedAt: null,
  approvalReference: null,
  failureCode: null,
  failureMessage: null,
};

const session = { id: "session-one", userId: "user-one" };

describe("reconcileSweptBrowserSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActionRunByBrowserSession.mockResolvedValue(run);
  });

  it("does nothing when the session is attached to no run", async () => {
    mocks.getActionRunByBrowserSession.mockResolvedValue(null);

    await expect(reconcileSweptBrowserSession(session)).resolves.toBe("no_run");
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
    expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed", "cancelled"] as const)(
    "preserves a %s run — resources close, lifecycle is immutable",
    async (status) => {
      mocks.getActionRunByBrowserSession.mockResolvedValue({ ...run, status });

      await expect(reconcileSweptBrowserSession(session)).resolves.toBe("terminal_preserved");
      expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
      expect(mocks.recordActionEventActivity).not.toHaveBeenCalled();
    },
  );

  it("deliberately fails a browser-kind run that lost its only resource", async () => {
    mocks.transitionActionRunEventActivity.mockResolvedValue({ ...run, status: "failed" });

    await expect(reconcileSweptBrowserSession(session)).resolves.toBe("run_failed");
    expect(mocks.transitionActionRunEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-one",
      userId: "user-one",
      status: "failed",
      eventType: "browser.session.completed",
      payload: { browserSessionId: "session-one", reason: "idle_timeout" },
      patch: {
        failureCode: BROWSER_SESSION_IDLE_TIMEOUT_CODE,
        failureMessage: "The browser session expired after being idle.",
      },
    }));
  });

  it("records resource loss on a composite parent without touching its lifecycle", async () => {
    mocks.getActionRunByBrowserSession.mockResolvedValue({ ...run, kind: "composite" });
    mocks.recordActionEventActivity.mockResolvedValue(run);

    await expect(reconcileSweptBrowserSession(session)).resolves.toBe("event_recorded");
    expect(mocks.recordActionEventActivity).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-one",
      userId: "user-one",
      type: "browser.session.completed",
      payload: { browserSessionId: "session-one", reason: "idle_timeout" },
    }));
    // The parent owns its lifecycle — no status transition, and certainly
    // never an automatic completed.
    expect(mocks.transitionActionRunEventActivity).not.toHaveBeenCalled();
  });

  it("never transitions any run to completed", async () => {
    mocks.getActionRunByBrowserSession.mockResolvedValue({ ...run, kind: "composite" });
    await reconcileSweptBrowserSession(session);
    for (const [input] of mocks.transitionActionRunEventActivity.mock.calls) {
      expect((input as { status: string }).status).not.toBe("completed");
    }
  });

  it("scopes the run lookup to the session owner", async () => {
    await reconcileSweptBrowserSession({ id: "session-x", userId: "user-two" });
    expect(mocks.getActionRunByBrowserSession).toHaveBeenCalledWith("user-two", "session-x");
  });
});
