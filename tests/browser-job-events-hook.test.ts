// @vitest-environment jsdom
/**
 * Tests for useBrowserJobEvents — the SSE consumer hook.
 *
 * Since jsdom doesn't have a real EventSource, we mock it to simulate
 * the SSE protocol: onopen, addEventListener for typed events, and onerror.
 *
 * Tests verify:
 *   - Returns empty events when jobId is null
 *   - Connects to the correct SSE URL
 *   - Receives and stores events from the stream
 *   - Deduplicates events by ID
 *   - Closes connection on terminal events (job.completed, job.failed)
 *   - Closes connection on unmount
 *   - Reconnects with exponential backoff on error
 *   - Resets state when jobId changes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrowserJobEvents } from "@/app/(app)/studio/hooks/useBrowserJobEvents";

// ─── EventSource Mock ───────────────────────────────────────────

interface MockEventSource {
  url: string;
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  listeners: Map<string, ((ev: MessageEvent) => void)[]>;
  close: ReturnType<typeof vi.fn>;
  _simulateOpen: () => void;
  _simulateEvent: (type: string, data: unknown) => void;
  _simulateError: () => void;
}

let mockESInstances: MockEventSource[] = [];
let mockESConstructor: ReturnType<typeof vi.fn>;

function createMockEventSource(url: string): MockEventSource {
  const listeners = new Map<string, ((ev: MessageEvent) => void)[]>();
  const es: MockEventSource = {
    url,
    readyState: 0,
    onopen: null,
    onerror: null,
    onmessage: null,
    listeners,
    addEventListener: vi.fn((type: string, handler: (ev: MessageEvent) => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler);
    }),
    close: vi.fn(() => {
      es.readyState = 2;
    }),
    _simulateOpen() {
      es.readyState = 1;
      es.onopen?.();
    },
    _simulateEvent(type: string, data: unknown) {
      const handlers = listeners.get(type) ?? [];
      const event = new MessageEvent(type, { data: JSON.stringify(data) });
      for (const handler of handlers) handler(event);
    },
    _simulateError() {
      es.readyState = 2;
      es.onerror?.();
    },
  };
  mockESInstances.push(es);
  return es;
}

beforeEach(() => {
  mockESInstances = [];
  mockESConstructor = vi.fn((url: string) => createMockEventSource(url));
  vi.stubGlobal("EventSource", mockESConstructor);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ─── Helper ─────────────────────────────────────────────────────

function makeEvent(id: string, type: string, message: string, step: number | null = null) {
  return {
    id,
    jobId: "job-1",
    type,
    step,
    message,
    metadata: {},
    createdAt: "2026-08-10T12:00:00Z",
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe("useBrowserJobEvents", () => {
  it("returns empty events and not connected when jobId is null", () => {
    const { result } = renderHook(() => useBrowserJobEvents(null));
    expect(result.current.events).toEqual([]);
    expect(result.current.connected).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("creates EventSource with the correct URL", () => {
    renderHook(() => useBrowserJobEvents("job-123"));
    expect(mockESConstructor).toHaveBeenCalledWith("/api/browser/jobs/job-123/events");
  });

  it("includes since cursor in URL on reconnect", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useBrowserJobEvents("job-abc"));
    const es = mockESInstances[0];
    act(() => {
      es._simulateOpen();
      es._simulateEvent("job.started", makeEvent("e1", "job.started", "Started"));
      es._simulateError(); // trigger reconnect
    });

    // The reconnect URL should include ?since=e1
    // Wait for the reconnect timer (1s initial backoff)
    act(() => vi.advanceTimersByTime(2000));

    const lastCall = mockESConstructor.mock.calls[mockESConstructor.mock.calls.length - 1];
    expect(lastCall[0]).toContain("since=e1");
    vi.useRealTimers();
  });

  it("stores received events", () => {
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    act(() => {
      es._simulateOpen();
      es._simulateEvent("job.started", makeEvent("e1", "job.started", "Started"));
      es._simulateEvent("step.started", makeEvent("e2", "step.started", "Step 0", 0));
    });

    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).toBe("e1");
    expect(result.current.events[1].id).toBe("e2");
    expect(result.current.connected).toBe(true);
  });

  it("deduplicates events by ID", () => {
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    act(() => {
      es._simulateOpen();
      es._simulateEvent("job.started", makeEvent("e1", "job.started", "Started"));
      es._simulateEvent("job.started", makeEvent("e1", "job.started", "Started")); // duplicate
    });

    expect(result.current.events).toHaveLength(1);
  });

  it("closes connection on job.completed terminal event", () => {
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    act(() => {
      es._simulateOpen();
      es._simulateEvent("job.completed", makeEvent("e1", "job.completed", "Done"));
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
    expect(result.current.events[0].type).toBe("job.completed");
  });

  it("closes connection on job.failed terminal event", () => {
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    act(() => {
      es._simulateOpen();
      es._simulateEvent("job.failed", makeEvent("e1", "job.failed", "Crashed"));
    });

    expect(es.close).toHaveBeenCalled();
    expect(result.current.connected).toBe(false);
  });

  it("closes EventSource on unmount", () => {
    const { unmount } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    act(() => {
      unmount();
    });
    expect(es.close).toHaveBeenCalled();
  });

  it("resets events when jobId changes", () => {
    const { result, rerender } = renderHook(
      ({ jobId }) => useBrowserJobEvents(jobId),
      { initialProps: { jobId: "job-1" as string | null } },
    );
    const es1 = mockESInstances[0];
    act(() => {
      es1._simulateOpen();
      es1._simulateEvent("job.started", makeEvent("e1", "job.started", "Started job-1"));
    });
    expect(result.current.events).toHaveLength(1);

    act(() => {
      rerender({ jobId: "job-2" });
    });
    // Events should be reset
    expect(result.current.events).toEqual([]);
    // New EventSource should be created for the new job
    const lastCall = mockESConstructor.mock.calls[mockESConstructor.mock.calls.length - 1];
    expect(lastCall[0]).toContain("job-2");
  });

  it("sets error when EventSource is not available", () => {
    vi.unstubAllGlobals();
    // EventSource is now undefined
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    expect(result.current.error).toBe("EventSource not supported");
    expect(result.current.events).toEqual([]);
  });

  it("listens for all expected event types", () => {
    renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];

    const expectedTypes = [
      "job.started",
      "step.started",
      "observation",
      "action",
      "verification",
      "step.completed",
      "retry",
      "approval.required",
      "job.completed",
      "job.failed",
    ];

    for (const type of expectedTypes) {
      expect(es.listeners.has(type)).toBe(true);
    }
  });

  it("listens for stream.end event", () => {
    renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];
    expect(es.listeners.has("stream.end")).toBe(true);

    act(() => {
      es._simulateOpen();
      es._simulateEvent("stream.end", { reason: "job_terminal" });
    });
    expect(es.close).toHaveBeenCalled();
  });

  it("sets connected=true on open and resets on error", () => {
    const { result } = renderHook(() => useBrowserJobEvents("job-1"));
    const es = mockESInstances[0];

    act(() => es._simulateOpen());
    expect(result.current.connected).toBe(true);

    act(() => es._simulateError());
    expect(result.current.connected).toBe(false);
  });

  it("reconnects after error with exponential backoff", () => {
    vi.useFakeTimers();
    renderHook(() => useBrowserJobEvents("job-1"));
    const es1 = mockESInstances[0];

    act(() => {
      es1._simulateOpen();
      es1._simulateError();
    });

    // reconnectDelay starts at 1000, gets doubled to 2000 on first error
    // So first reconnect happens after 2000ms
    expect(mockESConstructor).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(2100));
    expect(mockESConstructor).toHaveBeenCalledTimes(2);

    const es2 = mockESInstances[1];
    act(() => es2._simulateError());

    // Second error doubles to 4000ms
    act(() => vi.advanceTimersByTime(4100));
    expect(mockESConstructor).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });
});
