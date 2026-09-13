/**
 * Render-loop regression test — proves the "Maximum update depth exceeded"
 * root cause is fixed and cannot recur.
 *
 * Root cause: useCockpitStore() returns a new {state, actions} object
 * every render. Before the fix, useEventBridge and useCockpitController
 * had `store` in their effect/callback dependency arrays, so:
 *   render → new store object → effect re-runs → setState → re-render
 *   → new store object → effect re-runs → ... (infinite loop)
 *
 * The fix: both hooks use a `useRef(store)` updated every render, and
 * callbacks read from `storeRef.current` at call time. Effects depend
 * on stable values (client, sessionBridge) instead of `store`.
 *
 * This test verifies the invariant by:
 *   1. Mounting a component that uses useCockpitStore + useEventBridge
 *   2. Using a mock SessionEventBridge that counts subscribe() calls
 *   3. Triggering re-renders by toggling unrelated state
 *   4. Asserting the subscription count stays at 1 (no re-subscribe loop)
 *
 * If the regression returns, the subscription count will grow with each
 * re-render, and the test will fail.
 */
import React, { useState, useEffect } from "react";
import { render } from "ink";
import { describe, it, expect, afterEach } from "vitest";
import { useCockpitStore } from "../ink/cockpit-store.js";
import { useEventBridge } from "../ink/event-bridge.js";
import type { SessionEventBridge } from "../ink/session-event-bridge.js";
import type { LifecycleEvent } from "../lib/runtime-client.js";

/** Mock SessionEventBridge — counts subscribe() calls to detect loops. */
function createMockSessionBridge(): SessionEventBridge & { subscribeCount: number } {
  let subscribeCount = 0;
  const subscribers = new Set<(event: LifecycleEvent) => void>();
  return {
    get subscribeCount() { return subscribeCount; },
    subscribe(cb: (event: LifecycleEvent) => void): () => void {
      subscribeCount++;
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    emit(_event: LifecycleEvent): void { /* no-op */ },
    close(): void { /* no-op */ },
  } as unknown as SessionEventBridge & { subscribeCount: number };
}

/** Test component — uses the real hooks with a mock session bridge. */
function TestComponent({ bridge }: { bridge: SessionEventBridge }): React.ReactElement {
  const store = useCockpitStore();
  useEventBridge(null, store, bridge);
  // Trigger re-renders by toggling unrelated state. Before the fix,
  // each re-render caused useEventBridge's effect to re-run (because
  // `store` was in its deps), which re-subscribed and called setState
  // (setLocalRuntime("ready"), setConnected(true)), causing another
  // re-render → infinite loop.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTick((t) => t + 1), 50);
    return () => clearTimeout(t);
  }, []);
  // Re-render every 10ms a few times to simulate rapid state changes
  useEffect(() => {
    if (tick >= 5) return;
    const t = setTimeout(() => setTick((t) => t + 1), 10);
    return () => clearTimeout(t);
  }, [tick]);

  return React.createElement("ink-text", null, `tick=${tick}`);
}

describe("render-loop regression — event-bridge subscription stability", () => {
  let instances: Array<{ unmount: () => void }> = [];

  afterEach(() => {
    for (const inst of instances) inst.unmount();
    instances = [];
  });

  it("useEventBridge does not re-subscribe when store identity changes but state doesn't", async () => {
    const bridge = createMockSessionBridge();
    const { unmount } = render(React.createElement(TestComponent, { bridge }));
    instances.push({ unmount });

    // Wait for the component to settle (tick reaches 5 + buffer)
    await new Promise((r) => setTimeout(r, 200));

    // The subscription effect should have run exactly ONCE (on mount).
    // If `store` is in the effect deps, it re-subscribes every render
    // and this count grows to 5+.
    expect(bridge.subscribeCount).toBe(1);

    unmount();
  });

  it("useEventBridge does not cause Maximum update depth exceeded", async () => {
    const bridge = createMockSessionBridge();

    // If the render loop is present, render() will throw
    // "Maximum update depth exceeded" within ~50ms. If it renders
    // without error for 200ms, the loop is absent.
    expect(() => {
      const { unmount } = render(React.createElement(TestComponent, { bridge }));
      instances.push({ unmount });
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 200));
  });
});
