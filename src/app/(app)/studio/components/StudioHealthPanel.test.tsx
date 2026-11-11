import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import StudioHealthPanel from "./StudioHealthPanel";

// Stable auth object — see StudioActivityPanel.test.tsx.
vi.mock("@/hooks/useClerkAuth", () => {
  const auth = { getToken: async (): Promise<string | null> => null };
  return { useClerkAuth: () => auth };
});

// The runtime hook is context-driven in production; the approvals surface
// only needs a settled "ready" runtime so no recovery banner renders.
vi.mock("../hooks/useProjectRuntime", () => ({
  useProjectRuntime: () => ({
    state: {
      phase: "ready",
      sourceKind: "blank",
      sourceStatus: null,
      versionControl: "none",
      branch: null,
      repository: null,
      error: null,
    },
  }),
}));

const fixtures = vi.hoisted(() => ({
  legacyApprovals: [] as Array<Record<string, unknown>>,
  projection: null as Record<string, unknown> | null,
}));

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function spyOnFetch() {
  return vi.spyOn(globalThis, "fetch");
}

let fetchSpy: ReturnType<typeof spyOnFetch>;

function setupFetch() {
  fetchSpy = spyOnFetch().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/action-run")) return response({ projection: fixtures.projection });
    if (url.includes("/checks")) {
      return response({
        checks: [],
        changedFiles: [],
        pendingApprovals: fixtures.legacyApprovals,
        checkpoints: [],
      });
    }
    return response({}, 404);
  });
}

function actionRunFetches(): number {
  return fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/action-run")).length;
}

beforeEach(() => {
  vi.restoreAllMocks();
  fixtures.legacyApprovals = [];
  fixtures.projection = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StudioHealthPanel approvals — run gates come from the action-run projection", () => {
  it("shows a V2 paused-run gate even when the legacy approvals queue is empty", async () => {
    setupFetch();
    fixtures.projection = {
      displayState: "awaiting_approval",
      pendingApprovals: [{ id: "paused-1", toolId: "image.stock", reason: "Fetch stock photos for the hero" }],
    };

    render(<StudioHealthPanel mode="approvals" projectId="proj-1" conversationId="conv-1" />);

    expect(await screen.findByText("image.stock")).toBeInTheDocument();
    expect(screen.getByText(/Fetch stock photos for the hero/)).toBeInTheDocument();
    expect(screen.queryByText("No pending approvals.")).not.toBeInTheDocument();
  });

  it("still renders legacy mission approvals with their decision buttons", async () => {
    setupFetch();
    fixtures.legacyApprovals = [{ id: "legacy-1", actionType: "Deploy to production", riskLevel: "high" }];
    fixtures.projection = null;

    render(<StudioHealthPanel mode="approvals" projectId="proj-1" conversationId="conv-1" />);

    expect(await screen.findByText("Deploy to production")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
  });

  it("shows the empty state only when both approval stores are empty", async () => {
    setupFetch();
    fixtures.projection = { displayState: "completed", pendingApprovals: [] };

    render(<StudioHealthPanel mode="approvals" projectId="proj-1" conversationId="conv-1" />);

    expect(await screen.findByText("No pending approvals.")).toBeInTheDocument();
  });

  it("keeps refreshing the projection while a gate is pending", async () => {
    vi.useFakeTimers();
    setupFetch();
    fixtures.projection = {
      displayState: "awaiting_approval",
      pendingApprovals: [{ id: "paused-1", toolId: "image.stock", reason: "Fetch stock photos" }],
    };

    render(<StudioHealthPanel mode="approvals" projectId="proj-1" conversationId="conv-1" />);
    await act(async () => {});
    const atMount = actionRunFetches();
    expect(atMount).toBeGreaterThanOrEqual(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(actionRunFetches()).toBeGreaterThan(atMount);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(actionRunFetches()).toBeGreaterThan(atMount + 1);
  });
});
