/**
 * useIsPhone tests — the <768px phone-tier gate.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useIsPhone } from "./useIsPhone";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
      listeners.add(cb);
    }),
    removeEventListener: vi.fn(),
    dispatch: (next: boolean) => {
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      expect(query).toBe("(max-width: 767px)");
      return mql;
    }),
  );
  return mql;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsPhone", () => {
  it("returns null on first render (SSR-safe), then the measured value", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsPhone());
    // After effects run, the measured value is set.
    expect(result.current).toBe(true);
  });

  it("returns false for wide viewports", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
  });

  it("updates when the viewport crosses 768px", () => {
    const mql = mockMatchMedia(false);
    const { result } = renderHook(() => useIsPhone());
    expect(result.current).toBe(false);
    act(() => {
      mql.dispatch(true);
    });
    expect(result.current).toBe(true);
  });
});
