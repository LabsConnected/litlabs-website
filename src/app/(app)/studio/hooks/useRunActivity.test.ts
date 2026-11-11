import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useRunActivity } from "./useRunActivity";
import type { ActionRunStatus } from "@/lib/action-runtime/types";

// Stable auth object: an unstable getToken identity would re-fire the
// hook's fetch effect every render.
vi.mock("@/hooks/useClerkAuth", () => {
  const auth = { getToken: async (): Promise<string | null> => null };
  return { useClerkAuth: () => auth };
});

const runState = vi.hoisted(() => ({
  status: "working" as ActionRunStatus,
}));

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function spyOnFetch() {
  return vi.spyOn(globalThis, "fetch");
}

let fetchSpy: ReturnType<typeof spyOnFetch>;

function runFetches(): number {
  return fetchSpy.mock.calls.filter((c) => String(c[0]).startsWith("/api/action-runs/")).length;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  runState.status = "working";
  fetchSpy = spyOnFetch().mockImplementation(async () =>
    response({ run: { id: "run-1", status: runState.status }, events: [] }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useRunActivity — polling follows the run, not the chat turn", () => {
  it.each(["paused", "working", "waiting_for_user", "queued", "starting"] as const)(
    "keeps polling while the run is non-terminal (busy=false, status=%s)",
    async (status) => {
      runState.status = status;
      renderHook(() => useRunActivity("run-1", false));
      await flush();
      expect(runFetches()).toBe(1);

      await advance(2500);
      expect(runFetches()).toBe(2);
      await advance(5000);
      expect(runFetches()).toBe(4);
    },
  );

  it("keeps polling after the chat turn ends while the run is parked at a gate", async () => {
    const { rerender } = renderHook(
      ({ busy }: { busy: boolean }) => useRunActivity("run-1", busy),
      { initialProps: { busy: true } },
    );
    await flush();
    expect(runFetches()).toBe(1);
    await advance(2500);
    expect(runFetches()).toBe(2);

    // The turn ends as awaiting_approval: chat-busy drops, the run is
    // parked server-side, and the resume will later append more events.
    runState.status = "paused";
    rerender({ busy: false });
    await flush();
    const atPark = runFetches();

    await advance(2500);
    expect(runFetches()).toBe(atPark + 1);
    await advance(2500);
    expect(runFetches()).toBe(atPark + 2);
  });

  it("does not poll once the run is already terminal", async () => {
    runState.status = "completed";
    renderHook(() => useRunActivity("run-1", false));
    await flush();
    expect(runFetches()).toBe(1);

    await advance(10_000);
    expect(runFetches()).toBe(1);
  });

  it("stops polling after the run turns terminal, with one trailing fetch", async () => {
    renderHook(() => useRunActivity("run-1", false));
    await flush();
    expect(runFetches()).toBe(1);
    await advance(2500);
    expect(runFetches()).toBe(2);

    // The next poll observes the terminal row…
    runState.status = "completed";
    await advance(2500);
    expect(runFetches()).toBe(3);
    // …one trailing fetch picks up late-persisted events…
    await advance(3000);
    expect(runFetches()).toBe(4);
    // …then polling stops for good.
    await advance(10_000);
    expect(runFetches()).toBe(4);
  });
});
