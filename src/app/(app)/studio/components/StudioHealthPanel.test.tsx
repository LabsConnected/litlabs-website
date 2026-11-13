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
// The runtime state is fixture-driven so the banner tests below can
// settle it into gated / failed states.
const READY_RUNTIME = {
  phase: "ready",
  sourceKind: "blank",
  sourceStatus: null,
  versionControl: "none",
  branch: null,
  repository: null,
  error: null,
} as Record<string, unknown>;

vi.mock("../hooks/useProjectRuntime", () => ({
  useProjectRuntime: () => ({
    state: fixtures.runtime,
  }),
}));

const fixtures = vi.hoisted(() => ({
  legacyApprovals: [] as Array<Record<string, unknown>>,
  projection: null as Record<string, unknown> | null,
  runtime: null as unknown,
}));
fixtures.runtime = READY_RUNTIME;

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
  fixtures.runtime = READY_RUNTIME;
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

describe("StudioHealthPanel runtime banner — repo gate (B2)", () => {
  it("presents the gate as a product state: gate label, honest message, NO recovery actions", async () => {
    setupFetch();
    fixtures.runtime = {
      phase: "workspace_not_provisioned",
      sourceKind: "github",
      sourceStatus: "unavailable",
      versionControl: "none",
      branch: "main",
      repository: "owner/repo",
      error: {
        code: "HOST_EXECUTION_DISABLED",
        message:
          "Opening a GitHub repo as a live workspace needs a secure sandbox, which the hosted service doesn't have yet. Your project's files and builds aren't affected — only the live workspace and preview are paused.",
      },
    };

    render(<StudioHealthPanel mode="checks" projectId="proj-1" />);

    expect(await screen.findByText("Repo-backed workspaces aren't available on the hosted service yet")).toBeInTheDocument();
    expect(screen.getByText(/needs a secure sandbox/)).toBeInTheDocument();
    // Phase-based recovery actions would all be refused by the same
    // policy — none may be offered for the gate.
    expect(screen.queryByText("Provision workspace")).toBeNull();
    expect(screen.queryByText("Retry workspace")).toBeNull();
    expect(screen.queryByText("Workspace not provisioned")).toBeNull();
  });

  it("keeps the failure banner WITH recovery actions for a genuine provisioning failure", async () => {
    setupFetch();
    fixtures.runtime = {
      phase: "workspace_not_provisioned",
      sourceKind: "blank",
      sourceStatus: "error",
      versionControl: "none",
      branch: null,
      repository: null,
      error: { code: "WORKSPACE_PROVISIONING_FAILED", message: "Workspace preparation failed. Retry to try again." },
    };

    render(<StudioHealthPanel mode="checks" projectId="proj-1" />);

    expect(await screen.findByText("Workspace not provisioned")).toBeInTheDocument();
    expect(screen.getByText("Provision workspace")).toBeInTheDocument();
  });
});
