import { renderHook, waitFor } from "@testing-library/react";
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
import { useLiTTRuntime } from "./useLiTTRuntime";

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
