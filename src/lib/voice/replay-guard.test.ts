import { describe, it, expect, vi } from "vitest";
import { createReplayGuard } from "./replay-guard";

describe("createReplayGuard", () => {
  it("allows a fresh requestId with a current timestamp", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000)).toEqual({ ok: true });
  });

  it("rejects a timestamp older than the window (stale)", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000 - 5001)).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a timestamp further in the future than the window", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000 + 5001)).toEqual({ ok: false, reason: "future_timestamp" });
  });

  it("rejects a second use of the same requestId within the window (replay)", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000)).toEqual({ ok: true });
    expect(guard.check("req-1", 1_000_000)).toEqual({ ok: false, reason: "replayed_request_id" });
  });

  it("allows the same requestId again once it has fully expired out of the window", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000)).toEqual({ ok: true });
    now.mockReturnValue(1_000_000 + 5001 + 5001); // well past expiry + stale-window for the new timestamp too
    expect(guard.check("req-1", 1_000_000 + 5001 + 5001)).toEqual({ ok: true });
  });

  it("rejects a non-finite timestamp (NaN/Infinity) instead of silently passing it through", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", Number.NaN)).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(guard.check("req-2", Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("tracks two different requestIds independently", () => {
    const now = vi.fn().mockReturnValue(1_000_000);
    const guard = createReplayGuard({ now, windowMs: 5000 });
    expect(guard.check("req-1", 1_000_000)).toEqual({ ok: true });
    expect(guard.check("req-2", 1_000_000)).toEqual({ ok: true });
  });
});
