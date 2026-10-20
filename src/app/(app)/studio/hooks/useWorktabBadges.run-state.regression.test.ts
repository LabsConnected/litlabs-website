import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useWorktabBadges } from "./useWorktabBadges";
import { useExecutionStore } from "../stores/useExecutionStore";
import type { Worktab } from "./useServerWorktabs";

/**
 * Regression test — worktab badge polling follows the SERVER, not the
 * local store (Repair R4, Diagnosis E3-S3).
 *
 * The defect: the 20s re-poll decided liveness from the LOCAL execution
 * phase only. After a reload the in-memory store is empty (phase
 * "idle"), so the interval cleared itself at its first tick — the tab
 * froze on whatever the single mount fetch saw ("Run in progress")
 * even as the server run settled terminal a minute later. Liveness
 * must key off the canonical projection's state: keep polling while
 * the projection is non-terminal, and land the terminal badge when it
 * settles.
 */

function seedTabs(): Worktab[] {
  return [
    {
      id: "tab-a",
      title: "Homepage",
      conversationId: "conv-a",
      surface: "studio/preview",
      selection: null,
      createdAt: 1,
    },
  ];
}

describe("useWorktabBadges — projection-driven liveness (R4/E3-S3)", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps polling while the PROJECTION is live (local phase idle after reload) and lands the terminal badge", async () => {
    vi.useFakeTimers();
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        // First read: the run is live on the server. Every later read:
        // it settled FAILED while the tab sat untouched.
        const displayState = fetchCount === 1 ? "running" : "failed";
        return {
          ok: true,
          json: () => Promise.resolve({ projection: { displayState } }),
        };
      }),
    );
    const tabs = seedTabs();
    // Local store is empty — the post-reload state that used to kill
    // the poll at its first tick.
    expect(useExecutionStore.getState().phaseForTask("tab-a")).toBe("idle");

    const { result } = renderHook(() => useWorktabBadges(tabs));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current["tab-a"]).toBe("working");
    expect(fetchCount).toBe(1);

    // One poll interval later the badge must reflect the server's
    // terminal truth. Before the fix the interval had already cleared
    // itself (local phase idle) — fetchCount stayed 1 and the tab
    // showed "Run in progress" forever.
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetchCount).toBeGreaterThanOrEqual(2);
    expect(result.current["tab-a"]).toBe("failed");
  });
});
