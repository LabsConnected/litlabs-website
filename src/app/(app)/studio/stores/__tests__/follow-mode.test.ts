/**
 * Follow LiTT mode + follow-aware navigation tests — Station Control
 * Bridge, chunk D.
 *
 * Covers:
 *  - useFollowModeStore persists the mode toggle under the exact
 *    contract key "littree:studio:follow-litt" (contract §2.2).
 *  - navigateToStation with mode "on" calls the registered workspace
 *    stage setter with the mapped stage.
 *  - navigateToStation with mode "off" does NOT call the setter and
 *    fires a "LiTT is working in X / [Show me]" notification; the
 *    [Show me] action performs the deferred switch.
 *  - Stations with no surface (and unknown station ids) never throw.
 *  - buildUiStationContext: emitEvent appends to the activity store with
 *    the contract { timestamp, station, summary, phase } fields, and
 *    reportLiveState emits in all paths (contract §19.2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOLLOW_MODE_STORAGE_KEY,
  useFollowModeStore,
} from "../useFollowModeStore";
import {
  clearWorkspaceNavigator,
  FOLLOW_NOTIFICATION_EVENT,
  navigateToStation,
  registerWorkspaceNavigator,
  STATION_STAGE_MAP,
  subscribeFollowNotifications,
  type FollowNotification,
  type StationId,
} from "../../lib/follow-navigation";
import { buildUiStationContext } from "../../lib/station-context";
import { useActivityStore } from "../useActivityStore";

beforeEach(() => {
  clearWorkspaceNavigator();
  useFollowModeStore.getState().setMode("on");
  useActivityStore.getState().clearAll();
});

describe("useFollowModeStore", () => {
  it("defaults to on", () => {
    expect(useFollowModeStore.getState().mode).toBe("on");
  });

  it("persists the mode toggle under the exact contract storage key", () => {
    useFollowModeStore.getState().setMode("off");
    expect(useFollowModeStore.getState().mode).toBe("off");

    const raw = window.localStorage.getItem(FOLLOW_MODE_STORAGE_KEY);
    expect(FOLLOW_MODE_STORAGE_KEY).toBe("littree:studio:follow-litt");
    expect(raw).not.toBeNull();
    expect(raw).toContain('"mode":"off"');

    useFollowModeStore.getState().setMode("on");
    expect(useFollowModeStore.getState().mode).toBe("on");
    expect(window.localStorage.getItem(FOLLOW_MODE_STORAGE_KEY)).toContain(
      '"mode":"on"',
    );
  });
});

describe("navigateToStation", () => {
  it("with follow on, calls the registered setter with the mapped stage", () => {
    const setter = vi.fn();
    const unregister = registerWorkspaceNavigator(setter);
    try {
      navigateToStation("code");
      expect(setter).toHaveBeenCalledTimes(1);
      expect(setter).toHaveBeenCalledWith("code");

      navigateToStation("image");
      expect(setter).toHaveBeenCalledWith("media");

      navigateToStation("preview");
      expect(setter).toHaveBeenCalledWith("preview");
    } finally {
      unregister();
    }
  });

  it("with follow off, does NOT call the setter and fires the [Show me] notification", () => {
    const setter = vi.fn();
    const unregister = registerWorkspaceNavigator(setter);
    useFollowModeStore.getState().setMode("off");

    const seen: FollowNotification[] = [];
    const unsubscribe = subscribeFollowNotifications((n) => seen.push(n));
    try {
      navigateToStation("code", "Editing src/app/page.tsx");

      // No auto-navigation while follow is off.
      expect(setter).not.toHaveBeenCalled();

      // One notification: "LiTT is working in Code / Editing src/app/page.tsx / [Show me]".
      expect(seen).toHaveLength(1);
      expect(seen[0].station).toBe("code");
      expect(seen[0].title).toBe("LiTT is working in Code");
      expect(seen[0].detail).toBe("Editing src/app/page.tsx");
      expect(typeof seen[0].showMe).toBe("function");

      // Clicking [Show me] performs the deferred switch.
      seen[0].showMe();
      expect(setter).toHaveBeenCalledTimes(1);
      expect(setter).toHaveBeenCalledWith("code");
    } finally {
      unsubscribe();
      unregister();
    }
  });

  it("with follow off, also dispatches a window event for shell rendering", () => {
    useFollowModeStore.getState().setMode("off");
    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener(FOLLOW_NOTIFICATION_EVENT, handler);
    try {
      navigateToStation("browser");
      // browser has no workspace stage — no notification expected.
      expect(events).toHaveLength(0);

      navigateToStation("preview");
      expect(events).toHaveLength(1);
      const detail = (events[0] as CustomEvent).detail as { station: string; title: string };
      expect(detail.station).toBe("preview");
      expect(detail.title).toBe("LiTT is working in Preview");
    } finally {
      window.removeEventListener(FOLLOW_NOTIFICATION_EVENT, handler);
    }
  });

  it("stations with no surface never throw and never navigate", () => {
    const setter = vi.fn();
    registerWorkspaceNavigator(setter);
    const seen: FollowNotification[] = [];
    subscribeFollowNotifications((n) => seen.push(n));

    const noSurface: StationId[] = [
      "browser",
      "terminal",
      "design",
      "game",
      "environment",
      "checks",
      "memory",
      "voice",
      "camera",
    ];
    for (const station of noSurface) {
      expect(STATION_STAGE_MAP[station]).toBeNull();
      expect(() => navigateToStation(station)).not.toThrow();
    }
    expect(setter).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("unknown station ids never throw", () => {
    const setter = vi.fn();
    registerWorkspaceNavigator(setter);
    expect(() =>
      navigateToStation("not-a-station" as unknown as StationId),
    ).not.toThrow();
    expect(setter).not.toHaveBeenCalled();
  });

  it("is a presentation no-op when no navigator is registered (headless, §19.2)", () => {
    // No navigator registered here — must not throw.
    expect(() => navigateToStation("code")).not.toThrow();
  });
});

describe("buildUiStationContext", () => {
  const ctx = () =>
    buildUiStationContext({
      projectId: "proj-1",
      conversationId: "conv-1",
      userId: "user-1",
    });

  it("emitEvent appends to the activity store with { timestamp, station, summary, phase }", () => {
    const c = ctx();
    c.emitEvent({
      kind: "action_started",
      station: "browser",
      summary: "Opened Stripe documentation",
      actionId: "browser.navigate",
    });

    const events = useActivityStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].station).toBe("browser");
    expect(events[0].summary).toBe("Opened Stripe documentation");
    expect(events[0].phase).toBe("browsing");
    expect(typeof events[0].timestamp).toBe("number");
  });

  it("maps stations to phases per the contract table", () => {
    const c = ctx();
    c.emitEvent({ kind: "action_started", station: "image", summary: "Generating" });
    c.emitEvent({ kind: "action_started", station: "terminal", summary: "pnpm type-check" });
    c.emitEvent({ kind: "action_started", station: "deploy", summary: "Deploying" });
    c.emitEvent({ kind: "action_started", station: "preview", summary: "Restarted application" });
    c.emitEvent({ kind: "action_started", station: "code", summary: "Editing file" });

    const phases = useActivityStore.getState().events.map((e) => e.phase);
    expect(phases).toEqual(["creating", "running", "deploying", "verifying", "editing"]);
  });

  it("maps approval_required → awaiting_approval and action_failed → failed", () => {
    const c = ctx();
    c.emitEvent({ kind: "approval_required", station: "files", summary: "Approval needed" });
    c.emitEvent({ kind: "action_failed", station: "checks", summary: "Typecheck failed" });

    const events = useActivityStore.getState().events;
    expect(events[0].phase).toBe("awaiting_approval");
    expect(events[1].phase).toBe("failed");
    expect(events[1].status).toBe("error");
  });

  it("action_completed keeps the prior phase or falls back to verifying", () => {
    const c = ctx();
    c.emitEvent({
      kind: "action_completed",
      station: "terminal",
      summary: "Command finished",
      phase: "running",
    });
    c.emitEvent({ kind: "action_completed", station: "image", summary: "Saved asset" });

    const events = useActivityStore.getState().events;
    expect(events[0].phase).toBe("running");
    expect(events[1].phase).toBe("verifying");
    expect(events[1].status).toBe("success");
  });

  it("reportLiveState emits in all paths (§19.2 is not a no-op)", () => {
    const c = ctx();
    // No navigator registered, follow off — must still emit.
    useFollowModeStore.getState().setMode("off");

    c.reportLiveState({ station: "browser", phase: "browsing" });
    c.reportLiveState({ station: "code", phase: "editing", summary: "Custom summary" });

    const events = useActivityStore.getState().events;
    expect(events).toHaveLength(2);
    expect(events[0].station).toBe("browser");
    expect(events[0].phase).toBe("browsing");
    expect(events[1].summary).toBe("Custom summary");
  });

  it("exposes the explicit actor identity (§19.3)", () => {
    const c = ctx();
    expect(c.actorUserId).toBe("user-1");
    expect(c.projectId).toBe("proj-1");
    expect(c.conversationId).toBe("conv-1");
  });

  it("navigateToStation delegates to the follow-aware navigator", () => {
    const setter = vi.fn();
    registerWorkspaceNavigator(setter);
    const c = ctx();
    c.navigateToStation("code");
    expect(setter).toHaveBeenCalledWith("code");
  });
});
