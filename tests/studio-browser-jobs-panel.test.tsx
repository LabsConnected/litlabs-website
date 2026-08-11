// @vitest-environment jsdom
/**
 * StudioBrowserJobsPanel tests.
 *
 * Tests the panel's rendering with mocked fetch responses.
 * Uses real timers to avoid async/fake-timer conflicts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import StudioBrowserJobsPanel from "@/app/studio/components/StudioBrowserJobsPanel";

// ─── Mock data ─────────────────────────────────────────────────

const runningJob = {
  jobId: "job-running",
  jobType: "ghl.workflow.inspect",
  goal: "Inspect GHL workflow",
  riskLevel: "low",
  requestedBy: "studio",
  status: "running",
  params: { workflowName: "Test Workflow" },
  result: null,
  error: null,
  progress: {
    step: 2,
    totalSteps: 5,
    steps: [
      { label: "Start session", status: "completed" },
      { label: "Navigate", status: "completed" },
      { label: "Check auth", status: "running" },
      { label: "Find workflow", status: "pending" },
      { label: "Extract nodes", status: "pending" },
    ],
  },
  browserSessionId: "sess-1",
  liveViewUrl: "https://browserbase.com/view/abc123",
  approvedBy: null,
  approvedAt: null,
  attempts: 1,
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  completedAt: null,
};

const completedJob = {
  jobId: "job-done",
  jobType: "ghl.workflow.list",
  goal: null,
  riskLevel: "low",
  requestedBy: "vapi",
  status: "completed",
  params: {},
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

    // Cancel (DELETE) or Approve (POST) on per-job endpoint
    if (init?.method === "DELETE") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ job: { ...(jobs[0] as Record<string, unknown>), status: "cancelled" } }),
      } as Response;
    }
    if (init?.method === "POST") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ job: { ...(jobs[0] as Record<string, unknown>), status: "approved" } }),
      } as Response;
    }

    // Per-job endpoint: /api/browser/jobs/<id>
    const match = urlStr.match(/\/api\/browser\/jobs\/([^/?]+)$/);
    if (match) {
      const job = (jobs as Record<string, unknown>[]).find((j) => j.jobId === match[1]);
      if (!job) return { ok: false, status: 404, json: async () => ({ error: "Not found" }) } as Response;
      return { ok: true, status: 200, json: async () => ({ job }) } as Response;
    }

    // List endpoint
    if (urlStr.includes("/api/browser/jobs")) {
      return { ok: true, status: 200, json: async () => ({ jobs }) } as Response;
    }

    return { ok: false, status: 404, json: async () => ({ error: "Not found" }) } as Response;
  });
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
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByText("Browser Agent")).toBeDefined();
  });

  it("renders job list after fetch", async () => {
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });
  });

  it("shows active count badge when jobs are running", async () => {
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("1 active")).toBeDefined();
    });
  });

  it("shows empty state when no jobs exist", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([]));
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("No browser jobs yet")).toBeDefined();
    });
  });

  it("shows job detail with steps when a job is clicked", async () => {
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });

    fireEvent.click(screen.getByText("Inspect GHL workflow"));

    await waitFor(() => {
      expect(screen.getByText("Start session")).toBeDefined();
      expect(screen.getByText("Check auth")).toBeDefined();
    });
  });

  it("renders live view iframe when liveViewUrl is present", async () => {
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Inspect GHL workflow")).toBeDefined();
    });

    // The running job auto-selects, so the iframe should appear
    await waitFor(() => {
      const iframe = screen.getByTitle("Browserbase live view");
      expect(iframe).toBeDefined();
      expect(iframe.getAttribute("src")).toBe("https://browserbase.com/view/abc123");
    });
  });

  it("shows error state when fetch returns 401", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    }) as Response));
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeDefined();
    });
  });

  it("shows approve button for awaiting_approval jobs", async () => {
    const approvalJob = {
      ...runningJob,
      jobId: "job-approval",
      status: "awaiting_approval",
      riskLevel: "high",
      progress: { step: 1, totalSteps: 3, steps: [{ label: "Start", status: "completed" }] },
    };
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([approvalJob]));
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Approve")).toBeDefined();
    });
  });

  it("shows cancel button for queued jobs", async () => {
    const queuedJob = {
      ...runningJob,
      jobId: "job-queued",
      status: "queued",
      progress: { step: 0, totalSteps: 5, steps: [] },
    };
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", makeFetchMock([queuedJob]));
    render(<StudioBrowserJobsPanel />);
    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeDefined();
    });
  });
});
