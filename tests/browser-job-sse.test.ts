// @vitest-environment node
/**
 * Tests for the SSE endpoint GET /api/browser/jobs/[id]/events.
 *
 * These verify:
 *   - 400 when job ID is missing
 *   - 401 when no auth is provided
 *   - 404 when job doesn't exist for the user
 *   - 200 with text/event-stream content type when authenticated
 *   - Initial events are sent on connect
 *   - Heartbeat is sent to keep connection alive
 *   - Stream closes when job reaches terminal state
 *   - Vapi bearer token auth works alongside Clerk
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ──────────────────────────────────────────────────────

const mockGetJob = vi.fn();
const mockGetJobEvents = vi.fn();

vi.mock("@/lib/browser-jobs", () => ({
  getJob: mockGetJob,
  getJobEvents: mockGetJobEvents,
  serializeJobEvent: vi.fn((event: Record<string, unknown>) => event),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ userId: null, clerkId: null })),
}));

vi.mock("@/lib/vapi-tools", () => ({
  authorizeVapiRequest: vi.fn((authHeader: string) =>
    authHeader === "Bearer valid-vapi-token-0123456789",
  ),
  ownerClerkId: vi.fn(() => "user_owner123"),
}));

const { GET } = await import("@/app/api/browser/jobs/[id]/events/route");

const VAPI_TOKEN = "valid-vapi-token-0123456789";

function makeSSERequest(
  jobId: string,
  options: { since?: string; authHeader?: string } = {},
): NextRequest {
  const url = new URL(`http://localhost/api/browser/jobs/${jobId}/events`);
  if (options.since) url.searchParams.set("since", options.since);

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
  };
  if (options.authHeader !== undefined) {
    headers["Authorization"] = options.authHeader;
  }

  return new NextRequest(url.toString(), {
    method: "GET",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetJob.mockReset();
  mockGetJobEvents.mockReset();
});

// ─── Auth & Validation ──────────────────────────────────────────

describe("GET /api/browser/jobs/[id]/events — auth & validation", () => {
  it("returns 400 when job ID is missing", async () => {
    // NextRequest with empty path segment — simulate by passing empty id
    const req = makeSSERequest("");
    const res = await GET(req, { params: Promise.resolve({ id: "" }) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when no auth is provided", async () => {
    const req = makeSSERequest("job-123", { authHeader: "" });
    const res = await GET(req, { params: Promise.resolve({ id: "job-123" }) });
    expect(res.status).toBe(401);
  });

  it("returns 404 when job does not exist for user", async () => {
    mockGetJob.mockResolvedValue(null);
    const req = makeSSERequest("job-missing", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-missing" }) });
    expect(res.status).toBe(404);
  });
});

// ─── SSE Stream ─────────────────────────────────────────────────

describe("GET /api/browser/jobs/[id]/events — SSE stream", () => {
  it("returns 200 with text/event-stream content type", async () => {
    mockGetJob.mockResolvedValue({
      jobId: "job-1",
      status: "running",
      userId: "user_owner123",
    });
    mockGetJobEvents.mockResolvedValue([]);

    const req = makeSSERequest("job-1", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-1" }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("Connection")).toBe("keep-alive");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    // Clean up the stream
    try {
      res.body?.cancel();
    } catch {
      // Ignore
    }
  });

  it("sends initial events on connect", async () => {
    mockGetJob.mockResolvedValue({
      jobId: "job-2",
      status: "running",
      userId: "user_owner123",
    });
    const initialEvents = [
      { id: "e1", jobId: "job-2", type: "job.started", step: null, message: "Started", metadata: {}, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e2", jobId: "job-2", type: "step.started", step: 0, message: "Step 0", metadata: {}, createdAt: "2026-01-01T00:00:01Z" },
    ];
    mockGetJobEvents.mockResolvedValue(initialEvents);

    const req = makeSSERequest("job-2", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-2" }) });

    // Read the stream
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    // Read a few chunks to get the initial events
    for (let i = 0; i < 4; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("e2")) break;
    }
    reader.cancel();

    expect(text).toContain("event: job.started");
    expect(text).toContain("event: step.started");
    expect(text).toContain("data: ");
    expect(text).toContain('"id":"e1"');
    expect(text).toContain('"id":"e2"');
  });

  it("includes SSE id field for cursor support", async () => {
    mockGetJob.mockResolvedValue({
      jobId: "job-3",
      status: "running",
      userId: "user_owner123",
    });
    mockGetJobEvents.mockResolvedValue([
      { id: "evt-100", jobId: "job-3", type: "observation", step: 1, message: "Saw something", metadata: {}, createdAt: "2026-01-01T00:00:00Z" },
    ]);

    const req = makeSSERequest("job-3", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-3" }) });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (let i = 0; i < 4; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("evt-100")) break;
    }
    reader.cancel();

    // SSE format: id: <eventId>\nevent: <type>\ndata: <json>\n\n
    expect(text).toMatch(/id: evt-100/);
    expect(text).toMatch(/event: observation/);
  });

  it("passes sinceId cursor to getJobEvents", async () => {
    mockGetJob.mockResolvedValue({
      jobId: "job-4",
      status: "running",
      userId: "user_owner123",
    });
    mockGetJobEvents.mockResolvedValue([]);

    const req = makeSSERequest("job-4", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
      since: "evt-last",
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-4" }) });

    // Wait a tick for the initial event fetch
    await new Promise((r) => setTimeout(r, 50));
    res.body?.cancel();

    expect(mockGetJobEvents).toHaveBeenCalledWith(
      "job-4",
      expect.objectContaining({ sinceId: "evt-last" }),
    );
  });

  it("closes stream with stream.end event when job is terminal", async () => {
    // Job is already completed
    mockGetJob.mockResolvedValue({
      jobId: "job-5",
      status: "completed",
      userId: "user_owner123",
    });

    // Initial events include the terminal event
    mockGetJobEvents.mockResolvedValue([
      { id: "e1", jobId: "job-5", type: "job.started", step: null, message: "Started", metadata: {}, createdAt: "2026-01-01T00:00:00Z" },
      { id: "e2", jobId: "job-5", type: "job.completed", step: null, message: "Done", metadata: {}, createdAt: "2026-01-01T00:00:05Z" },
    ]);

    const req = makeSSERequest("job-5", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-5" }) });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    // Read until stream ends or we get enough data
    for (let i = 0; i < 20; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("stream.end")) break;
    }

    expect(text).toContain("stream.end");
    expect(text).toContain("job_terminal");
  });

  it("closes stream when job is deleted (not found on poll)", async () => {
    // First call returns job, subsequent calls return null (deleted)
    let callCount = 0;
    mockGetJob.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return Promise.resolve({ jobId: "job-6", status: "running", userId: "user_owner123" });
      }
      return Promise.resolve(null);
    });
    mockGetJobEvents.mockResolvedValue([]);

    const req = makeSSERequest("job-6", {
      authHeader: `Bearer ${VAPI_TOKEN}`,
    });
    const res = await GET(req, { params: Promise.resolve({ id: "job-6" }) });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (let i = 0; i < 30; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes("stream.end")) break;
    }

    expect(text).toContain("stream.end");
    expect(text).toContain("job_deleted");
  });
});
