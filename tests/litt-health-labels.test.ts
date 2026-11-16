// @vitest-environment jsdom
/**
 * Tests for useLittHealth — the AppShell LiTT status pill.
 *
 * Larry's Studio finish spec (2026-11-14): specific states instead of
 * vague READY. The pill must name the actual health verdict the
 * /api/health poll derived — Verified when every subsystem check
 * passed, Degraded when the endpoint reports degraded checks, Offline
 * when the runtime cannot be reached — and never "LiTT Ready".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLittHealth } from "@/hooks/useLittHealth";

function mockFetchJson(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  }));
}

describe("useLittHealth labels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts as Checking… before the first poll answers", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { result, unmount } = renderHook(() => useLittHealth());
    expect(result.current.status).toBe("unknown");
    expect(result.current.label).toBe("LiTT Checking…");
    unmount();
  });

  it("reports Verified when /api/health answers ok", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ status: "ok" }));
    const { result, unmount } = renderHook(() => useLittHealth());
    await act(async () => {});
    expect(result.current.status).toBe("verified");
    expect(result.current.label).toBe("LiTT Verified");
    unmount();
  });

  it("reports Degraded when /api/health answers degraded", async () => {
    vi.stubGlobal("fetch", mockFetchJson({ status: "degraded" }));
    const { result, unmount } = renderHook(() => useLittHealth());
    await act(async () => {});
    expect(result.current.status).toBe("degraded");
    expect(result.current.label).toBe("LiTT Degraded");
    unmount();
  });

  it("reports Offline when the health check cannot reach the runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const { result, unmount } = renderHook(() => useLittHealth());
    await act(async () => {});
    expect(result.current.status).toBe("offline");
    expect(result.current.label).toBe("LiTT Offline");
    unmount();
  });

  it("never produces a vague Ready label", async () => {
    for (const body of [{ status: "ok" }, { status: "degraded" }]) {
      vi.stubGlobal("fetch", mockFetchJson(body));
      const { result, unmount } = renderHook(() => useLittHealth());
      await act(async () => {});
      expect(result.current.label).not.toMatch(/ready/i);
      unmount();
    }
  });
});
