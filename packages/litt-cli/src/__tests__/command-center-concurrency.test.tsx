import React from "react";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { describe, expect, it } from "vitest";
import { RuntimeStore, type RuntimeEvent } from "@litt/agent-core";

import { ControllerOperationGeneration } from "../ink/controller.js";
import { useCockpitStore, type CockpitStore } from "../ink/cockpit-store.js";
import { useEventBridge } from "../ink/event-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { WorkstreamStore } from "../ink/workstream-store.js";
import type {
  ConnectionListener,
  ConnectionState,
  LifecycleEvent,
  LifecycleListener,
  RuntimeClient,
} from "../lib/runtime-client.js";

/**
 * Minimal remote-source double. Only implements the surface useEventBridge
 * actually calls (onLifecycle/onConnectionChange/onState/is_connected/
 * getState) — enough to drive the "remote" side of the dual-source
 * generation watermark independently of the real Socket.IO client.
 */
class FakeRemoteClient {
  private lifecycleListeners = new Set<LifecycleListener>();
  private connectionListeners = new Set<ConnectionListener>();
  connected = true;

  onLifecycle(listener: LifecycleListener): () => void {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }
  onConnectionChange(listener: ConnectionListener): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  onState(): () => void {
    return () => {};
  }
  is_connected(): boolean {
    return this.connected;
  }
  getState(): null {
    return null;
  }

  fireLifecycle(event: LifecycleEvent): void {
    for (const listener of this.lifecycleListeners) listener(event);
  }
  fireConnection(state: ConnectionState): void {
    this.connected = state === "connected";
    for (const listener of this.connectionListeners) listener(state);
  }
}

function remoteMissionEvent(
  type: "mission.created" | "mission.restored",
  missionId: string,
  missionGeneration: number,
  goal: string,
): LifecycleEvent {
  return { type, runId: `run-${missionId}`, ts: Date.now(), data: { missionId, missionGeneration, goal } };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

function missionEvent(
  subtype: "mission:created" | "mission:completed" | "mission:failed",
  runId: string,
  missionId: string,
  missionGeneration: number,
  extra: Record<string, unknown> = {},
): RuntimeEvent {
  return {
    type: "litt_event",
    subtype,
    runId,
    ts: Date.now(),
    data: { missionId, missionGeneration, ...extra },
  } as RuntimeEvent;
}

async function mountEventBridge() {
  const sessionBridge = new SessionEventBridge();
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number };
  stdout.columns = 100;
  stdout.rows = 20;
  stdout.on("data", () => {});
  let snapshot = "";

  function Harness(): React.ReactElement {
    const store = useCockpitStore();
    useEventBridge(null, store, sessionBridge);
    snapshot = `${store.state.workstream.objective ?? "none"}:${store.state.workstream.overallStatus}`;
    return <Text>{snapshot}</Text>;
  }

  const instance = render(<Harness />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });
  await tick();

  return {
    emit(event: RuntimeEvent) {
      sessionBridge.onEvent(event);
    },
    async frame() {
      await tick();
      return snapshot;
    },
    cleanup() {
      instance.unmount();
      stdout.end();
    },
  };
}

/** Mounts useEventBridge with BOTH a local sessionBridge and a remote
 *  client, mirroring production (CockpitApp subscribes both sources to
 *  the same hook instance — see app.tsx). */
async function mountDualSourceEventBridge() {
  const sessionBridge = new SessionEventBridge();
  const remote = new FakeRemoteClient();
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number };
  stdout.columns = 100;
  stdout.rows = 20;
  stdout.on("data", () => {});
  let store: CockpitStore | null = null;

  function Harness(): React.ReactElement {
    const s = useCockpitStore();
    useEventBridge(remote as unknown as RuntimeClient, s, sessionBridge);
    store = s;
    return <Text>{s.state.canonicalMission?.id ?? "none"}</Text>;
  }

  const instance = render(<Harness />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });
  await tick();

  return {
    emitLocal(event: RuntimeEvent) {
      sessionBridge.onEvent(event);
    },
    emitRemote(event: LifecycleEvent) {
      remote.fireLifecycle(event);
    },
    connection(state: ConnectionState) {
      remote.fireConnection(state);
    },
    async canonicalMissionId() {
      await tick();
      return store!.state.canonicalMission?.id ?? null;
    },
    cleanup() {
      instance.unmount();
      stdout.end();
    },
  };
}

describe("event bridge mission identity", () => {
  it("runtime source assigns increasing mission generations that survive transport", async () => {
    const events: RuntimeEvent[] = [];
    const runtime = new RuntimeStore((event) => events.push(event));
    const missionA = await runtime.createMission({ goal: "Mission A" });
    await runtime.clearMission(missionA.id);
    await runtime.createMission({ goal: "Mission B" });

    const created = events.filter((event) => event.subtype === "mission:created");
    expect(created.map((event) => event.data.missionGeneration)).toEqual([1, 2]);
  });

  it("ignores Mission A terminal events after Mission B becomes active, then completes B", async () => {
    const bridge = await mountEventBridge();
    try {
      bridge.emit(missionEvent("mission:created", "run-a", "mission-a", 1, { goal: "Mission A" }));
      bridge.emit(missionEvent("mission:created", "run-b", "mission-b", 2, { goal: "Mission B" }));
      expect(await bridge.frame()).toContain("Mission B:running");

      bridge.emit(missionEvent("mission:created", "run-a", "mission-a", 1, { goal: "Mission A" }));
      expect(await bridge.frame()).toContain("Mission B:running");

      bridge.emit(missionEvent("mission:completed", "run-a", "mission-a", 1));
      expect(await bridge.frame()).toContain("Mission B:running");

      bridge.emit(missionEvent("mission:failed", "run-a", "mission-a", 1, { failureReason: "late" }));
      expect(await bridge.frame()).toContain("Mission B:running");

      bridge.emit(missionEvent("mission:completed", "run-b", "mission-b", 2));
      expect(await bridge.frame()).toContain("Mission B:complete");
    } finally {
      bridge.cleanup();
    }
  });

  it("applies failure from the active Mission B", async () => {
    const bridge = await mountEventBridge();
    try {
      bridge.emit(missionEvent("mission:created", "run-a", "mission-a", 1, { goal: "Mission A" }));
      bridge.emit(missionEvent("mission:created", "run-b", "mission-b", 2, { goal: "Mission B" }));
      bridge.emit(missionEvent("mission:failed", "run-b", "mission-b", 2, { failureReason: "current failure" }));
      expect(await bridge.frame()).toContain("Mission B:failed");
    } finally {
      bridge.cleanup();
    }
  });

  it("ignores duplicate B creation, accepts subsequent C, and resets ordering with a new mounted session", async () => {
    const bridge = await mountEventBridge();
    try {
      bridge.emit(missionEvent("mission:created", "run-b", "mission-b", 2, { goal: "Mission B" }));
      bridge.emit(missionEvent("mission:created", "run-b", "mission-b", 2, { goal: "Duplicate B" }));
      expect(await bridge.frame()).toContain("Mission B:running");

      bridge.emit(missionEvent("mission:created", "run-c", "mission-c", 3, { goal: "Mission C" }));
      expect(await bridge.frame()).toContain("Mission C:running");
    } finally {
      bridge.cleanup();
    }

    const nextSession = await mountEventBridge();
    try {
      nextSession.emit(missionEvent("mission:created", "run-new", "mission-new", 1, { goal: "New Session Mission" }));
      expect(await nextSession.frame()).toContain("New Session Mission:running");
    } finally {
      nextSession.cleanup();
    }
  });
});

describe("mission generation ordering across independent RuntimeStore sources", () => {
  it("does not reject a legitimate remote mission because the local source already used a higher-or-equal generation", async () => {
    const bridge = await mountDualSourceEventBridge();
    try {
      // Local RuntimeStore's FIRST mission — generation 1 in its own lineage.
      bridge.emitLocal({
        type: "litt_event",
        subtype: "mission:created",
        runId: "run-local-1",
        ts: Date.now(),
        data: { missionId: "mission-local-1", missionGeneration: 1, goal: "Local Mission" },
      } as RuntimeEvent);
      expect(await bridge.canonicalMissionId()).toBe("mission-local-1");

      // Remote RuntimeStore's FIRST mission — ALSO generation 1 in its own,
      // independent lineage. Before the per-source fix this collided with
      // the local watermark (1 <= 1) and was silently dropped.
      bridge.emitRemote(remoteMissionEvent("mission.created", "mission-remote-1", 1, "Remote Mission"));
      expect(await bridge.canonicalMissionId()).toBe("mission-remote-1");
    } finally {
      bridge.cleanup();
    }
  });

  it("accepts a new remote mission after the terminal-server restarts, even though the restarted store's generation counter is lower than the pre-restart watermark", async () => {
    const bridge = await mountDualSourceEventBridge();
    try {
      // Remote store has been running a while — several missions deep.
      bridge.emitRemote(remoteMissionEvent("mission.created", "mission-remote-old", 5, "Pre-restart Mission"));
      expect(await bridge.canonicalMissionId()).toBe("mission-remote-old");

      // Terminal-server restarts: socket drops and reconnects. The server's
      // RuntimeStore is a fresh instance — its generation counter restarts
      // from 0/1. The reconnected store's first mission must still surface.
      bridge.connection("reconnecting");
      bridge.connection("connected");
      bridge.emitRemote(remoteMissionEvent("mission.created", "mission-remote-new", 1, "Post-restart Mission"));
      expect(await bridge.canonicalMissionId()).toBe("mission-remote-new");
    } finally {
      bridge.cleanup();
    }
  });

  it("still ignores a stale duplicate remote mission.created within the same (non-reconnected) remote lineage", async () => {
    const bridge = await mountDualSourceEventBridge();
    try {
      bridge.emitRemote(remoteMissionEvent("mission.created", "mission-remote-b", 2, "Remote Mission B"));
      expect(await bridge.canonicalMissionId()).toBe("mission-remote-b");

      // Delayed duplicate/earlier-generation remote event, no reconnect in between.
      bridge.emitRemote(remoteMissionEvent("mission.created", "mission-remote-a", 1, "Stale Remote Mission A"));
      expect(await bridge.canonicalMissionId()).toBe("mission-remote-b");
    } finally {
      bridge.cleanup();
    }
  });
});

describe("controller operation generation", () => {
  it("prevents late Chat A settlement from changing Mission B", () => {
    const generation = new ControllerOperationGeneration();
    const chatA = generation.begin();
    const missionB = generation.begin();
    const workstream = new WorkstreamStore();
    workstream.setObjective("Mission B");

    expect(generation.runIfCurrent(chatA, () => workstream.setComplete())).toBe(false);
    expect(workstream.snapshot().overallStatus).toBe("running");

    expect(generation.runIfCurrent(missionB, () => workstream.setComplete())).toBe(true);
    expect(workstream.snapshot().overallStatus).toBe("complete");
  });
});
