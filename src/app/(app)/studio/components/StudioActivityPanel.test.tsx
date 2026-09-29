import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { StudioActivityPanel } from "./StudioActivityPanel";
import type { ActionEvent } from "@/lib/action-runtime/types";

// Stable across renders: an unstable getToken identity would re-fire the
// panel's fetch effect every render (infinite loop).
const { mockGetToken, authImpl } = vi.hoisted(() => {
  const mockGetToken = async (): Promise<string | null> => null;
  return {
    mockGetToken,
    authImpl: { current: (): { getToken: () => Promise<string | null> } => ({ getToken: mockGetToken }) },
  };
});
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => authImpl.current(),
}));

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function actionEvent(partial: Partial<ActionEvent> & { id: string; type: ActionEvent["type"] }): ActionEvent {
  return {
    sequence: "1",
    runId: "run-1",
    userId: "user-1",
    createdAt: "2026-09-28T12:00:00.000Z",
    payload: {},
    ...partial,
  };
}

const baseProps = {
  busy: false,
  modelLabel: "LiTT",
  projectName: "Demo project",
  terminalStatus: "ready",
};

function mockFetchFor(events: ActionEvent[] | null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/action-runs/")) {
      if (events === null) return response({ error: "x" }, 500);
      return response({ run: { id: "run-1", status: "completed" }, events });
    }
    if (url.startsWith("/api/conversations")) return response({ conversations: [] });
    if (url.startsWith("/api/deployments")) return response({ deployments: [] });
    return response({}, 404);
  });
}

describe("StudioActivityPanel — persisted run events as the Activity truth", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders persisted run events from the API shape, not chat messages", async () => {
    mockFetchFor([
      actionEvent({ id: "e1", type: "tool.completed", payload: { toolId: "files.write", label: "Wrote index.html", durationMs: 120 } }),
      actionEvent({ id: "e2", type: "agent.status", payload: { kind: "checkpoint", label: "Checkpoint: Pre-launch", gitSha: "abc12345" } }),
      actionEvent({ id: "e3", type: "agent.status", payload: { kind: "build_result", check: "typecheck", passed: true, label: "Check passed: typecheck" } }),
    ]);

    render(<StudioActivityPanel runId="run-1" {...baseProps} />);

    // Persisted events render with their server-written labels…
    expect(await screen.findByText("Wrote index.html")).toBeInTheDocument();
    expect(await screen.findByText("Checkpoint: Pre-launch")).toBeInTheDocument();
    expect(await screen.findByText("Check passed: typecheck")).toBeInTheDocument();
    // …the old chat-duplication UI is gone…
    expect(screen.queryByText("No conversation activity yet")).not.toBeInTheDocument();
    // …and the kept chrome still renders.
    expect(screen.getByText("Demo project")).toBeInTheDocument();
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(screen.getByText("3 run events")).toBeInTheDocument();
  });

  it("renders the run-events empty state when the run produced no events", async () => {
    mockFetchFor([]);

    render(<StudioActivityPanel runId="run-1" {...baseProps} />);

    expect(await screen.findByText(/No run activity yet/)).toBeInTheDocument();
    // An empty event list renders as empty — never fabricated activity.
    expect(screen.queryByText("No conversation activity yet")).not.toBeInTheDocument();
  });

  it("renders the no-run state when there is no run id", async () => {
    const fetchSpy = mockFetchFor([]);

    render(<StudioActivityPanel runId={null} {...baseProps} />);

    expect(await screen.findByText(/No task run yet/)).toBeInTheDocument();
    // No run → no fetch to the events API.
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("/api/action-runs/"), expect.anything());
  });

  it("renders an honest error state when the events API fails", async () => {
    mockFetchFor(null);

    render(<StudioActivityPanel runId="run-1" {...baseProps} />);

    expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
  });
});

describe("useRunActivity — fetch stability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    authImpl.current = () => ({ getToken: mockGetToken });
  });

  it("does not refetch in a loop when getToken identity is unstable", async () => {
    // A fresh getToken closure on every render must not re-fire the fetch
    // effect (regression: this used to infinite-loop the panel).
    authImpl.current = () => ({ getToken: async () => null });
    const fetchSpy = mockFetchFor([]);

    render(<StudioActivityPanel runId="run-1" {...baseProps} />);
    expect(await screen.findByText(/No run activity yet/)).toBeInTheDocument();

    // Let any runaway effect fire.
    await new Promise((r) => setTimeout(r, 500));
    const runFetches = fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("/api/action-runs/"));
    expect(runFetches.length).toBeLessThanOrEqual(2);
  });
});
