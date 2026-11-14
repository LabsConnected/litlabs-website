import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetToken = vi.hoisted(() => vi.fn().mockResolvedValue("fresh-clerk-jwt"));

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => {
    const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    return {
      connected: false,
      on: vi.fn((event: string, cb: (...a: unknown[]) => void) => {
        (handlers[event] = handlers[event] ?? []).push(cb);
      }),
      off: vi.fn(),
      disconnect: vi.fn(),
    };
  }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: mockGetToken }),
}));

import { io as mockIo } from "socket.io-client";
import {
  computeRelayBackoffDelayMs,
  useLiTTRuntime,
} from "./useLiTTRuntime";

function freshSnapshot() {
  return {
    phase: "ready",
    project: null,
    branch: null,
    model: null,
    profile: null,
    gitChanges: 0,
    online: true,
    pingMs: 12,
    contextTokens: 0,
    heartbeat: {
      seq: 1,
      lastHeartbeatAt: Date.now(),
      failures: 0,
      maxFailures: 3,
      intervalMs: 15000,
      latencyMs: 5,
    },
    activeCommand: null,
    lastResult: null,
    updatedAt: Date.now(),
  };
}

describe("useLiTTRuntime relay transport (default)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(mockIo).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects via same-origin /api/runtime-feed and reports fresh", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ snapshot: freshSnapshot() }),
    });

    const { result, unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runtime-feed",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { Authorization: "Bearer fresh-clerk-jwt" },
      }),
    );
    // No direct socket.io connection for the default relay path
    expect(mockIo).not.toHaveBeenCalled();
    expect(result.current.state?.phase).toBe("ready");
    expect(result.current.freshness).toBe("fresh");
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("reports unreachable (honest feed-down state) when the relay fails", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { result, unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    await waitFor(() => expect(result.current.connected).toBe(false));
    // Give the failed poll a chance to land
    await waitFor(() =>
      expect(result.current.error).toMatch(/network down/),
    );
    expect(result.current.freshness).toBe("unreachable");
    expect(mockIo).not.toHaveBeenCalled();
    unmount();
  });

  it("reports unreachable when the relay returns an honest 503", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: "TERMINAL_UNREACHABLE" }),
    });

    const { result, unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    await waitFor(() =>
      expect(result.current.error).toBe("TERMINAL_UNREACHABLE"),
    );
    expect(result.current.connected).toBe(false);
    expect(result.current.freshness).toBe("unreachable");
    unmount();
  });
});

describe("computeRelayBackoffDelayMs", () => {
  it("keeps the base interval below the failure threshold", () => {
    expect(computeRelayBackoffDelayMs(5000, 0)).toBe(5000);
    expect(computeRelayBackoffDelayMs(5000, 1)).toBe(5000);
    expect(computeRelayBackoffDelayMs(5000, 2)).toBe(5000);
  });

  it("stretches 5s -> 30s -> 60s cap after consecutive failures", () => {
    expect(computeRelayBackoffDelayMs(5000, 3)).toBe(30_000);
    expect(computeRelayBackoffDelayMs(5000, 4)).toBe(60_000);
    expect(computeRelayBackoffDelayMs(5000, 25)).toBe(60_000);
  });
});

describe("useLiTTRuntime relay backoff", () => {
  const fetchMock = vi.fn();
  let hidden = false;
  let hiddenSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    hiddenSpy = vi
      .spyOn(document, "hidden", "get")
      .mockImplementation(() => hidden);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(mockIo).mockClear();
  });

  afterEach(() => {
    hiddenSpy?.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function advance(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("stretches the poll interval after consecutive failures", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    const { result, unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    // Immediate poll on subscribe: failure #1, next tick stays at base 50ms.
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/network down/);
    expect(result.current.freshness).toBe("unreachable");

    await advance(50); // failure #2, still base
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(50); // failure #3, backoff engages: next delay 6x = 300ms
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // A tick at the old base interval must NOT fire a request anymore.
    await advance(50);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await advance(250); // 300ms after failure #3: failure #4 fires
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Beyond the threshold the delay is 12x = 600ms.
    await advance(300);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(300);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    unmount();
  });

  it("resets to the base interval on the first success", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ snapshot: freshSnapshot() }),
      });

    const { result, unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    await advance(0); // failure #1
    await advance(50); // failure #2
    await advance(50); // failure #3 -> backed off to 300ms
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await advance(50);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await advance(250); // backed-off tick: success, backoff resets
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.current.connected).toBe(true);
    expect(result.current.error).toBeNull();

    // Next poll is back on the base 50ms interval, not the backed-off one.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ snapshot: freshSnapshot() }),
    });
    await advance(50);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    unmount();
  });

  it("skips poll ticks while the tab is hidden and resumes when visible", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ snapshot: freshSnapshot() }),
    });

    const { unmount } = renderHook(() =>
      useLiTTRuntime({ pollIntervalMs: 50 }),
    );

    await advance(0); // immediate poll
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = true;
    await advance(50); // tick fires but is skipped: no request
    await advance(50); // still hidden: still no request
    expect(fetchMock).toHaveBeenCalledTimes(1);

    hidden = false;
    await advance(50); // visible again: polling resumes
    expect(fetchMock).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe("useLiTTRuntime socket transport (explicit opt-in)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    vi.mocked(mockIo).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses direct Socket.IO when an explicit url is passed (dev harness)", () => {
    const { unmount } = renderHook(() =>
      useLiTTRuntime({ url: "http://127.0.0.1:4001", token: null }),
    );
    expect(mockIo).toHaveBeenCalledWith(
      "http://127.0.0.1:4001",
      expect.objectContaining({ transports: ["websocket"] }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });
});
