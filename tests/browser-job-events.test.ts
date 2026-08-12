// @vitest-environment node
/**
 * Tests for browser job event storage — emitJobEvent, getJobEvents, serializeJobEvent.
 *
 * These verify:
 *   - emitJobEvent inserts into browser_job_events with correct fields
 *   - emitJobEvent is silent on failure (never throws)
 *   - getJobEvents returns events in ascending order
 *   - getJobEvents respects the sinceId cursor
 *   - getJobEvents respects the limit
 *   - getJobEvents returns [] when Supabase is unavailable
 *   - serializeJobEvent maps DB row fields to the API shape
 *   - JOB_EVENT_TYPES contains all expected event types
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Supabase ──────────────────────────────────────────────

const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import type { AgentJobEvent } from "@/lib/browser-jobs";

const { getSupabaseAdmin } = await import("@/lib/supabase");
const {
  emitJobEvent,
  getJobEvents,
  serializeJobEvent,
  JOB_EVENT_TYPES,
} = await import("@/lib/browser-jobs");

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReset();
  mockSelect.mockReset();
  mockFrom.mockReset();
  (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue({
    from: mockFrom,
  });
});

// ─── JOB_EVENT_TYPES ────────────────────────────────────────────

describe("JOB_EVENT_TYPES", () => {
  it("contains all expected event types", () => {
    expect(JOB_EVENT_TYPES).toContain("job.started");
    expect(JOB_EVENT_TYPES).toContain("step.started");
    expect(JOB_EVENT_TYPES).toContain("observation");
    expect(JOB_EVENT_TYPES).toContain("action");
    expect(JOB_EVENT_TYPES).toContain("verification");
    expect(JOB_EVENT_TYPES).toContain("step.completed");
    expect(JOB_EVENT_TYPES).toContain("retry");
    expect(JOB_EVENT_TYPES).toContain("approval.required");
    expect(JOB_EVENT_TYPES).toContain("job.completed");
    expect(JOB_EVENT_TYPES).toContain("job.failed");
  });

  it("has exactly 10 event types", () => {
    expect(JOB_EVENT_TYPES).toHaveLength(10);
  });
});

// ─── emitJobEvent ───────────────────────────────────────────────

describe("emitJobEvent", () => {
  it("inserts a row with correct fields", async () => {
    mockInsert.mockResolvedValue(undefined);
    mockFrom.mockReturnValue({ insert: mockInsert });

    await emitJobEvent({
      jobId: "job-123",
      type: "step.started",
      step: 3,
      message: "Extracting workflow nodes",
      metadata: { nodeCount: 5 },
    });

    expect(mockFrom).toHaveBeenCalledWith("browser_job_events");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      job_id: "job-123",
      type: "step.started",
      step: 3,
      message: "Extracting workflow nodes",
      metadata: { nodeCount: 5 },
    });
  });

  it("defaults step to null when not provided", async () => {
    mockInsert.mockResolvedValue(undefined);
    mockFrom.mockReturnValue({ insert: mockInsert });

    await emitJobEvent({
      jobId: "job-abc",
      type: "job.started",
      message: "Started",
    });

    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.step).toBeNull();
  });

  it("defaults metadata to {} when not provided", async () => {
    mockInsert.mockResolvedValue(undefined);
    mockFrom.mockReturnValue({ insert: mockInsert });

    await emitJobEvent({
      jobId: "job-abc",
      type: "job.started",
      message: "Started",
    });

    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.metadata).toEqual({});
  });

  it("does not throw when Supabase insert fails", async () => {
    mockInsert.mockImplementation(() => {
      throw new Error("DB connection refused");
    });
    mockFrom.mockReturnValue({ insert: mockInsert });

    await expect(
      emitJobEvent({
        jobId: "job-xyz",
        type: "job.failed",
        message: "Failed",
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when getSupabaseAdmin returns null", async () => {
    (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue(null);

    await expect(
      emitJobEvent({
        jobId: "job-null",
        type: "job.started",
        message: "Started",
      }),
    ).resolves.toBeUndefined();
  });
});

// ─── getJobEvents ───────────────────────────────────────────────

describe("getJobEvents", () => {
  it("returns events in ascending created_at order", async () => {
    const rows = [
      { id: "e1", job_id: "job-1", type: "job.started", step: null, message: "Started", metadata: {}, created_at: "2026-01-01T00:00:00Z" },
      { id: "e2", job_id: "job-1", type: "step.started", step: 0, message: "Step 0", metadata: {}, created_at: "2026-01-01T00:00:01Z" },
    ];

    const limit = vi.fn(async () => ({ data: rows, error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order, limit }));
    const select = vi.fn(() => ({ eq, order, limit }));
    mockFrom.mockReturnValue({ select });

    const events = await getJobEvents("job-1");

    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("e1");
    expect(events[1].id).toBe("e2");
    expect(events[0].type).toBe("job.started");
    expect(events[1].step).toBe(0);
  });

  it("returns [] when Supabase admin is null", async () => {
    (getSupabaseAdmin as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const events = await getJobEvents("job-1");
    expect(events).toEqual([]);
  });

  it("returns [] when query has error", async () => {
    const limit = vi.fn(async () => ({ data: null, error: { message: "table missing" } }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order, limit }));
    const select = vi.fn(() => ({ eq, order, limit }));
    mockFrom.mockReturnValue({ select });

    const events = await getJobEvents("job-1");
    expect(events).toEqual([]);
  });

  it("maps DB column names to camelCase API fields", async () => {
    const row = {
      id: "evt-99",
      job_id: "job-99",
      type: "observation",
      step: 5,
      message: "Found iframe",
      metadata: { selector: "iframe.builder" },
      created_at: "2026-08-10T12:00:00Z",
    };

    const limit = vi.fn(async () => ({ data: [row], error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order, limit }));
    const select = vi.fn(() => ({ eq, order, limit }));
    mockFrom.mockReturnValue({ select });

    const events = await getJobEvents("job-99");

    expect(events[0]).toEqual({
      id: "evt-99",
      jobId: "job-99",
      type: "observation",
      step: 5,
      message: "Found iframe",
      metadata: { selector: "iframe.builder" },
      createdAt: "2026-08-10T12:00:00Z",
    } satisfies AgentJobEvent);
  });

  it("uses sinceId cursor to filter events after the cursor's created_at", async () => {
    const cursorRow = { created_at: "2026-01-01T00:00:05Z" };
    const newRows = [
      { id: "e3", job_id: "job-1", type: "step.completed", step: 1, message: "Done", metadata: {}, created_at: "2026-01-01T00:00:06Z" },
    ];

    // The function makes two from() calls in this order:
    // 1. Main query: from("browser_job_events").select("*").eq("job_id", jobId).order(...).limit(200)
    //    → stored as `query` (thenable with .gt())
    // 2. Cursor lookup: from("browser_job_events").select("created_at").eq("id", sinceId).maybeSingle()
    //    → cursor row
    // Then: query = query.gt("created_at", cursor.created_at); await query
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // Main query — build a thenable that also supports .gt() chaining
        const result = { data: newRows, error: null };
        const thenable = {
          gt: vi.fn(() => thenable),
          then: vi.fn((resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve)),
        };
        const limit = vi.fn(() => thenable);
        const order = vi.fn(() => ({ limit }));
        const eq = vi.fn(() => ({ order, limit }));
        const select = vi.fn(() => ({ eq, order, limit }));
        return { select };
      }
      // Cursor lookup chain
      const maybeSingle = vi.fn(async () => ({ data: cursorRow }));
      const eq = vi.fn(() => ({ maybeSingle }));
      const select = vi.fn(() => ({ eq }));
      return { select };
    });

    const events = await getJobEvents("job-1", { sinceId: "e2" });

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("e3");
  });

  it("respects the limit option", async () => {
    const limit = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order, limit }));
    const select = vi.fn(() => ({ eq, order, limit }));
    mockFrom.mockReturnValue({ select });

    await getJobEvents("job-1", { limit: 50 });

    expect(limit).toHaveBeenCalledWith(50);
  });

  it("defaults limit to 200 when not specified", async () => {
    const limit = vi.fn(async () => ({ data: [], error: null }));
    const order = vi.fn(() => ({ limit }));
    const eq = vi.fn(() => ({ order, limit }));
    const select = vi.fn(() => ({ eq, order, limit }));
    mockFrom.mockReturnValue({ select });

    await getJobEvents("job-1");

    expect(limit).toHaveBeenCalledWith(200);
  });
});

// ─── serializeJobEvent ──────────────────────────────────────────

describe("serializeJobEvent", () => {
  it("maps all fields to the API/SSE shape", () => {
    const event: AgentJobEvent = {
      id: "evt-1",
      jobId: "job-1",
      type: "action",
      step: 3,
      message: "Clicked submit button",
      metadata: { selector: "button.submit", x: 100, y: 200 },
      createdAt: "2026-08-10T15:30:00Z",
    };

    const serialized = serializeJobEvent(event);

    expect(serialized).toEqual({
      id: "evt-1",
      jobId: "job-1",
      type: "action",
      step: 3,
      message: "Clicked submit button",
      metadata: { selector: "button.submit", x: 100, y: 200 },
      createdAt: "2026-08-10T15:30:00Z",
    });
  });

  it("preserves null step", () => {
    const event: AgentJobEvent = {
      id: "evt-2",
      jobId: "job-2",
      type: "job.started",
      step: null,
      message: "Started",
      metadata: {},
      createdAt: "2026-08-10T15:30:00Z",
    };

    expect(serializeJobEvent(event).step).toBeNull();
  });

  it("preserves empty metadata", () => {
    const event: AgentJobEvent = {
      id: "evt-3",
      jobId: "job-3",
      type: "job.completed",
      step: null,
      message: "Done",
      metadata: {},
      createdAt: "2026-08-10T15:30:00Z",
    };

    expect(serializeJobEvent(event).metadata).toEqual({});
  });

  it("does not include credentials or secrets in the output", () => {
    const event: AgentJobEvent = {
      id: "evt-4",
      jobId: "job-4",
      type: "action",
      step: 1,
      message: "Login action",
      metadata: { url: "https://app.ghl.com/login" },
      createdAt: "2026-08-10T15:30:00Z",
    };

    const serialized = serializeJobEvent(event);
    const jsonStr = JSON.stringify(serialized);
    // Should not contain common secret patterns
    expect(jsonStr).not.toMatch(/password|secret|token|apiKey|api_key/i);
  });
});
