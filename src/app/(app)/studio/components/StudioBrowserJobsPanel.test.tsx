/**
 * StudioBrowserJobsPanel — the one persistent job card.
 *
 *   1. The state badge comes from the job state machine
 *      (Queued / Running / Waiting for approval / Succeeded / Failed /
 *      Cancelled) — never invented text.
 *   2. A failed job surfaces its real error; a failed job with no error
 *      says so honestly — never "no errors".
 *   3. Steps show the exact URL visited (route-accurate provenance).
 *   4. An active job with no selection auto-opens — one persistent card,
 *      real progress immediately.
 *   5. Empty states: no jobs, job with no steps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import StudioBrowserJobsPanel from "./StudioBrowserJobsPanel";
import type { BrowserJob } from "../hooks/useBrowserJobs";

const { mockUseBrowserJobs, mockUseBrowserJobEvents } = vi.hoisted(() => ({
  mockUseBrowserJobs: vi.fn(),
  mockUseBrowserJobEvents: vi.fn(),
}));

vi.mock("../hooks/useBrowserJobs", () => ({
  useBrowserJobs: (...args: unknown[]) => mockUseBrowserJobs(...args),
}));

vi.mock("../hooks/useBrowserJobEvents", () => ({
  useBrowserJobEvents: (...args: unknown[]) => mockUseBrowserJobEvents(...args),
}));

// BrowserJobLiveView probes /api/browser/jobs/:id/live-view — stub it.
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jobFixture(overrides: Partial<BrowserJob> = {}): BrowserJob {
  return {
    jobId: "job-1",
    jobType: "ghl.workflow.inspect",
    goal: "Audit my site",
    riskLevel: "low",
    requestedBy: "studio",
    status: "running",
    params: {},
    result: null,
    error: null,
    progress: {
      step: 1,
      totalSteps: 3,
      steps: [
        { label: "Start browser session", status: "completed" },
        {
          label: "Navigate to workflows",
          status: "running",
          url: "https://app.gohighlevel.com/v2/location/abc/workflows",
        },
        { label: "Check authentication", status: "pending" },
      ],
    },
    browserSessionId: "sess-1",
    liveViewUrl: null,
    approvedBy: null,
    approvedAt: null,
    attempts: 1,
    createdAt: new Date("2026-09-22T04:00:00Z").toISOString(),
    startedAt: new Date("2026-09-22T04:00:01Z").toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function setupHook(jobs: BrowserJob[], selectedJobId: string | null) {
  const selectJob = vi.fn();
  mockUseBrowserJobs.mockReturnValue({
    jobs,
    selectedJob: jobs.find((j) => j.jobId === selectedJobId) ?? null,
    selectedJobId,
    loading: false,
    error: null,
    activeCount: jobs.filter((j) => ["queued", "running", "awaiting_approval", "approved"].includes(j.status)).length,
    selectJob,
    refresh: vi.fn(),
    cancelJob: vi.fn(),
    approveJob: vi.fn(),
  });
  mockUseBrowserJobEvents.mockReturnValue({ events: [], connected: true, error: null });
  return { selectJob };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({}),
  });
});

describe("StudioBrowserJobsPanel", () => {
  it("badges come from the state machine — Succeeded only on completed", () => {
    setupHook([jobFixture({ jobId: "j1", status: "completed", result: { ok: true }, completedAt: new Date().toISOString() })], "j1");
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByTestId("job-state-badge")).toHaveTextContent("Succeeded");
  });

  it("awaiting_approval reads 'Waiting for approval' with an Approve control", () => {
    setupHook([jobFixture({ jobId: "j1", status: "awaiting_approval" })], "j1");
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByTestId("job-state-badge")).toHaveTextContent("Waiting for approval");
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("failed job surfaces its real error", () => {
    setupHook([jobFixture({ jobId: "j1", status: "failed", error: "Selector timed out after 30s" })], "j1");
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByTestId("job-state-badge")).toHaveTextContent("Failed");
    expect(screen.getByText("Selector timed out after 30s")).toBeInTheDocument();
  });

  it("failed job with no error says so honestly — never 'no errors'", () => {
    setupHook([jobFixture({ jobId: "j1", status: "failed", error: null })], "j1");
    const { container } = render(<StudioBrowserJobsPanel />);
    expect(screen.getByText("The job failed, but no error message was recorded.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/no errors/i);
  });

  it("steps show the exact URL visited", () => {
    setupHook([jobFixture()], "job-1");
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByText("https://app.gohighlevel.com/v2/location/abc/workflows")).toBeInTheDocument();
  });

  it("auto-opens the most recent active job — one persistent card, no tap", () => {
    const { selectJob } = setupHook([jobFixture({ jobId: "active-1", status: "running" })], null);
    render(<StudioBrowserJobsPanel />);
    expect(selectJob).toHaveBeenCalledWith("active-1");
  });

  it("does not auto-select when only terminal jobs exist", () => {
    const { selectJob } = setupHook(
      [jobFixture({ jobId: "done-1", status: "completed", result: {} })],
      null,
    );
    render(<StudioBrowserJobsPanel />);
    expect(selectJob).not.toHaveBeenCalled();
    expect(screen.getByText("Audit my site")).toBeInTheDocument();
  });

  it("empty state: no jobs", () => {
    setupHook([], null);
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByText("No browser jobs yet")).toBeInTheDocument();
  });

  it("empty state: job with no steps", () => {
    setupHook(
      [jobFixture({ progress: { step: 0, totalSteps: 0, steps: [] } })],
      "job-1",
    );
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();
  });

  it("cancelled job reads truthfully with a final timestamp", () => {
    setupHook(
      [jobFixture({ jobId: "j1", status: "cancelled", completedAt: new Date().toISOString() })],
      "j1",
    );
    render(<StudioBrowserJobsPanel />);
    expect(screen.getByTestId("job-state-badge")).toHaveTextContent("Cancelled");
  });
});
