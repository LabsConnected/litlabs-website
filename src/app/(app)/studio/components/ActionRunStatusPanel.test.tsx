import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { ActionRunStatusPanel } from "./ActionRunStatusPanel";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ActionRunStatusPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the canonical runtime projection, pending approval, and verified live URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({
      projection: {
        run: {
          id: "run-12345678",
          status: "waiting_for_user",
          updatedAt: "2026-09-23T00:00:02.000Z",
          cancellationRequestedAt: null,
        },
        displayState: "awaiting_approval",
        currentActivity: "Waiting for deploy approval",
        pendingApprovals: [{ id: "paused-one", toolId: "project.deploy", reason: "Sensitive action" }],
        capabilities: {
          agent: { status: "completed" },
          files: { status: "completed" },
          terminal: { status: "completed" },
          browser: { status: "not_started" },
          preview: { status: "ready" },
          approval: { status: "running" },
          deployment: {
            status: "completed",
            deploymentId: "dep-123",
            publicUrl: "https://site.example.com",
            verified: true,
            error: null,
          },
          verification: { status: "completed" },
        },
        timeline: [
          { id: "e1", type: "tool.completed", createdAt: "2026-09-23T00:00:01.000Z", payload: { toolId: "files.write" } },
          { id: "e2", type: "preview.ready", createdAt: "2026-09-23T00:00:02.000Z", payload: {} },
        ],
        failure: null,
      },
    }));

    render(<ActionRunStatusPanel conversationId="conversation-one" busy={false} />);

    const panel = await screen.findByTestId("action-run-status-panel");
    expect(panel.textContent).toContain("Runtime · Needs approval");
    expect(panel.textContent).toContain("Waiting for deploy approval");
    expect(panel.textContent).toContain("Approval needed: project.deploy");
    expect(panel.textContent).toContain("Preview · ready");
    expect(panel.textContent).toContain("Live URL verified · https://site.example.com");
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/studio/conversations/conversation-one/action-run",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );
  });

  it("never fetches action-run for an optimistic pending_* conversation id", async () => {
    // Regression: optimistic send placeholders have no server row — the
    // lookup was a guaranteed 404 on every mount and busy-change.
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { rerender } = render(
      <ActionRunStatusPanel conversationId="pending_req_123_abc" busy={false} />,
    );
    rerender(
      <ActionRunStatusPanel conversationId="pending_req_123_abc" busy={true} />,
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("action-run-status-panel")).toBeNull();
  });
});

const ACTIVE_PROJECTION_BODY = {
  projection: {
    run: {
      id: "run-429-test",
      status: "waiting_for_user",
      updatedAt: "2026-09-23T00:00:02.000Z",
      cancellationRequestedAt: null,
    },
    displayState: "awaiting_approval",
    currentActivity: "Waiting for deploy approval",
    pendingApprovals: [{ id: "paused-one", toolId: "project.deploy", reason: "Sensitive action" }],
    capabilities: {
      deployment: {
        status: "not_started",
        deploymentId: null,
        publicUrl: null,
        verified: false,
        error: null,
      },
    },
    timeline: [],
    failure: null,
  },
};

function rateLimitedResponse(): Response {
  return new Response(JSON.stringify({ error: "Rate limit exceeded", retryAfter: 10 }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": "10" },
  });
}

describe("ActionRunStatusPanel 429 handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("on 429 keeps the last projection, never flags unavailable, and backs off per Retry-After", async () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(response(ACTIVE_PROJECTION_BODY))
        .mockResolvedValueOnce(rateLimitedResponse())
        .mockResolvedValue(response(ACTIVE_PROJECTION_BODY));

      render(<ActionRunStatusPanel conversationId="conversation-429" busy={false} />);
      await act(async () => {});
      expect(screen.getByTestId("action-run-status-panel").textContent).toContain("Needs approval");
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Normal 2s poll fires and is answered 429.
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // The last good projection stays on screen; no unavailable banner.
      expect(screen.getByTestId("action-run-status-panel").textContent).toContain("Needs approval");
      expect(screen.queryByText(/temporarily unavailable/)).toBeNull();

      // Backed off: the next 2s tick must NOT refire.
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Retry-After (10s from the 429) is honored.
      await act(async () => { vi.advanceTimersByTime(8000); });
      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Success restores the normal 2s cadence.
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a 429 on the very first load does not show the unavailable banner", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(rateLimitedResponse());
    render(<ActionRunStatusPanel conversationId="conversation-429-first" busy={false} />);
    await act(async () => {});
    expect(fetchSpy).toHaveBeenCalled();
    expect(screen.queryByText(/temporarily unavailable/)).toBeNull();
  });
});
