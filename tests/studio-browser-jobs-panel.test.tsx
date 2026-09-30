// @vitest-environment jsdom
/**
 * StudioBrowserJobsPanel tests.
 *
 * Tests the panel's rendering with mocked fetch responses.
 * Uses real timers to avoid async/fake-timer conflicts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import StudioBrowserJobsPanel from "@/app/(app)/studio/components/StudioBrowserJobsPanel";

// ─── Mock data ─────────────────────────────────────────────────

const runningJob = {
  jobId: "action-run-running",
  jobType: "studio.browser",
  goal: "Inspect GHL workflow",
  riskLevel: "low",
  requestedBy: "studio",
  status: "running",
  params: { projectId: "project-a", conversationId: "conversation-a", actionRunId: "action-run-running", browserSessionId: "session-a" },
  result: null,
  error: null,
  progress: { step: 0, totalSteps: 0, steps: [] },
  browserSessionId: "session-a",
  liveViewUrl: null,
  approvedBy: null,
  approvedAt: null,
  attempts: 1,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
};

const completedJob = {
  jobId: "action-run-done",
  jobType: "studio.browser",
  goal: null,
  riskLevel: "low",
  requestedBy: "studio",
  status: "completed",
  params: { projectId: "project-a", conversationId: "conversation-a", actionRunId: "action-run-done", browserSessionId: null },
  result: { workflows: [] },
  error: null,
  progress: { step: 3, totalSteps: 3, steps: [] },
  browserSessionId: null,
  liveViewUrl: null,
  approvedBy: null,
  approvedAt: null,
  attempts: 1,
  createdAt: new Date(Date.now() - 60000).toISOString(),
  startedAt: new Date(Date.now() - 60000).toISOString(),
  completedAt: new Date(Date.now() - 30000).toISOString(),
};

function makeFetchMock(jobs: unknown[] = [runningJob, completedJob]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const urlStr = String(url);

    // Canonical Studio cancellation is an ActionRun operation.
    if (urlStr.includes("/api/action-runs/") && urlStr.endsWith("/cancel")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    }
    // Canonical approvals stay on the conversation approval surface; this
    // legacy endpoint is intentionally not used for Studio ActionRuns.
    if (init?.method === "POST" && urlStr.includes("/api/browser/jobs/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ job: { ...(jobs[0] as Record<string, unknown>), status: "approved" } }),
      } as Response;
    }

    // Canonical list/detail endpoint.
    if (urlStr.includes("/api/studio/browser")) {
      const runId = new URL(`http://localhost${urlStr}`).searchParams.get("runId");
      const job = runId
        ? (jobs as Record<string, unknown>[]).find((item) => item.jobId === runId)
        : undefined;
      return { ok: true, status: 200, json: async () => (runId ? { job } : { jobs }) } as Response;
    }

    // Canonical ActionRun activity endpoint.
    if (urlStr.match(/\/api\/action-runs\/([^/?]+)$/)) {
      return { ok: true, status: 200, json: async () => ({ run: { status: "working" }, events: [] }) } as Response;
    }

    // Legacy per-job endpoint remains available for legacy Vapi/cron coverage.
    const match = urlStr.match(/\/api\/browser\/jobs\/([^/?]+)$/);
    if (match) {
      const job = (jobs as Record<string, unknown>[]).find((j) => j.jobId === match[1]);
      if (!job) return { ok: false, status: 404, json: async () => ({ error: "Not found" }) } as Response;
      return { ok: true, status: 200, json: async () => ({ job }) } as Response;
    }

    // Live-view probe (Phase 6): owner-checked availability rule.
    // The panel only iframes the embed URL when the probe says live.
    if (urlStr.includes("/live-view")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          available: true,
          reason: "live",
          embedUrl: "https://debug.browserbase.com/sessions/abc123?fullscreen=1&navbar=false",
          openUrl: "https://www.browserbase.com/sessions/abc123",
          sessionStatus: "active",
        }),
      } as Response;
    }

    return { ok: false, status: 404, json: async () => ({ error: "Not found" }) } as Response;
  });
}

function renderPanel(overrides: { projectId?: string | null; conversationId?: string | null } = {}) {
  return render(
    <StudioBrowserJobsPanel
      projectId={overrides.projectId === undefined ? "project-a" : overrides.projectId}
      conversationId={overrides.conversationId === undefined ? "conversation-a" : overrides.conversationId}
    />,
  );
}

// ─── Tests ─────────────────────────────────────────────────────

describe("StudioBrowserJobsPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", makeFetchMock());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders header and loading state initially", () => {
    renderPanel();
    expect(screen.getByText("Browser Agent")).toBeDefined();
  });

  it("renders job list after fetch", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });
  });

  it("shows active count badge when jobs are running", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("1 active")).toBeDefined();
    });
  });

  it("shows empty state when no jobs exist", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([]));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("No browser jobs yet")).toBeDefined();
    });
  });

  it("shows the canonical empty step state before ActionRun events arrive", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Inspect GHL workflow"));

    await waitFor(() => expect(screen.getByText("No steps yet — they appear here as the job starts working.")).toBeDefined());
  });

  it("renders live view iframe when the owner-checked live-view probe is live", async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });

    // The running job auto-selects. Phase 6: the iframe embeds the
    // probe's embed URL (never the raw job liveViewUrl) and carries
    // the LIVE badge.
    await waitFor(() => {
      const wrap = screen.getByTestId("live-view-iframe-wrap");
      const iframe = wrap.querySelector("iframe");
      expect(iframe).toBeDefined();
      expect(iframe?.getAttribute("src")).toBe(
        "https://debug.browserbase.com/sessions/abc123?fullscreen=1&navbar=false",
      );
    });
    expect(screen.getByTestId("live-view-live-badge")).toBeDefined();
  });

  it("shows the honest snapshot fallback when the live view is unavailable", async () => {
    vi.unstubAllGlobals();
    const base = makeFetchMock();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("/live-view")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              available: false,
              reason: "session_closed",
              embedUrl: null,
              openUrl: "https://www.browserbase.com/sessions/abc123",
              sessionStatus: "closed",
            }),
          } as Response;
        }
        return (base as (u: string, i?: RequestInit) => Promise<Response>)(url, init);
      }),
    );
    renderPanel();
    await waitFor(() => {
      expect(screen.getByTestId("live-view-fallback")).toBeDefined();
    });
    // No iframe, no LIVE badge: the fallback never pretends to be live.
    expect(screen.queryByTestId("live-view-iframe-wrap")).toBeNull();
    expect(screen.queryByTestId("live-view-live-badge")).toBeNull();
  });

  it("shows error state when fetch returns 401", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    }) as Response));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeDefined();
    });
  });

  it("does not offer legacy Approve for canonical ActionRun approval", async () => {
    const approvalJob = {
      ...runningJob,
      jobId: "action-run-approval",
      status: "awaiting_approval",
      params: { ...runningJob.params, actionRunId: "action-run-approval" },
    };
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([approvalJob]));
    renderPanel();
    await waitFor(() => {
      expect(screen.queryByText("Approve")).toBeNull();
    });
    expect(screen.getByText(/Waiting for approval/i)).toBeDefined();
  });

  it("shows cancel button for queued jobs", async () => {
    const queuedJob = {
      ...runningJob,
      jobId: "action-run-queued",
      status: "queued",
      params: { ...runningJob.params, actionRunId: "action-run-queued" },
    };
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([queuedJob]));
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeDefined();
    });
  });

  it("uses the canonical ActionRun cancellation endpoint", async () => {
    const queuedJob = { ...runningJob, status: "queued", jobId: "action-run-queued-cancel" };
    const fetchMock = makeFetchMock([queuedJob]);
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();
    await waitFor(() => expect(screen.getByText("Cancel")).toBeDefined());
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/action-runs/action-run-queued-cancel/cancel",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/api/browser/jobs/") && init?.method === "POST")).toBe(false);
  });

  it("shows a fresh project's honest empty state", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([]));
    renderPanel({ projectId: "fresh-project", conversationId: "fresh-conversation" });
    await waitFor(() => expect(screen.getByText("No browser jobs yet")).toBeDefined());
    expect(screen.queryByText("Inspect GHL workflow")).toBeNull();
  });
});
