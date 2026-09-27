import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useWorktabBadges } from "./useWorktabBadges";
import { useExecutionStore } from "../stores/useExecutionStore";
import type { Worktab } from "./useServerWorktabs";

function seedTabs(): Worktab[] {
  const tabs: Worktab[] = [
    {
      id: "tab-a",
      title: "Homepage",
      conversationId: "conv-a",
      surface: "studio/preview",
      selection: null,
      createdAt: 1,
    },
    {
      id: "tab-b",
      title: "Logo",
      conversationId: null,
      surface: "studio/code",
      selection: null,
      createdAt: 2,
    },
  ];
  return tabs;
}

describe("useWorktabBadges", () => {
  beforeEach(() => {
    useExecutionStore.getState().reset();
    vi.unstubAllGlobals();
  });

  it("reports working from a live per-task execution phase", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ projection: null }),
      }),
    );
    const tabs = seedTabs();
    useExecutionStore.getState().setActiveTaskId("tab-a");
    useExecutionStore.getState().setTaskPhase("tab-a", "editing");

    const { result } = renderHook(() => useWorktabBadges(tabs));
    await waitFor(() => {
      expect(result.current["tab-a"]).toBe("working");
    });
    // Tab B has no conversation and no phase — honest idle.
    expect(result.current["tab-b"]).toBe("idle");
  });

  it("reports ready only when the projection confirms completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ projection: { displayState: "completed" } }),
      }),
    );
    const tabs = seedTabs();
    useExecutionStore.getState().setTaskPhase("tab-a", "done");

    const { result } = renderHook(() => useWorktabBadges(tabs));
    await waitFor(() => {
      expect(result.current["tab-a"]).toBe("ready");
    });
  });

  it("stays idle on done when the projection is unavailable (never optimistic)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const tabs = seedTabs();
    useExecutionStore.getState().setTaskPhase("tab-a", "done");

    const { result } = renderHook(() => useWorktabBadges(tabs));
    await waitFor(() => {
      expect(result.current["tab-a"]).toBe("idle");
    });
  });

  it("reports needs-approval from an awaiting projection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ projection: { displayState: "awaiting_approval" } }),
      }),
    );
    const tabs = seedTabs();

    const { result } = renderHook(() => useWorktabBadges(tabs));
    await waitFor(() => {
      expect(result.current["tab-a"]).toBe("needs-approval");
    });
  });
});
