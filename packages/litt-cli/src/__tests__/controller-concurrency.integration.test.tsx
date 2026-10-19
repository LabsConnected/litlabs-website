import React from "react";
import { PassThrough } from "node:stream";
import { render, Text } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionRequest, RuntimeEvent } from "@litt/agent-core";

const agentLoop = vi.hoisted(() => {
  const calls: Array<{
    resolve: (value: {
      content: string;
      termination: "complete";
      durationMs: number;
      toolResults: never[];
    }) => void;
  }> = [];
  return { calls };
});

vi.mock("@litt/agent-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@litt/agent-core")>();
  return {
    ...actual,
    runAgentLoop: vi.fn(() => new Promise((resolve) => {
      agentLoop.calls.push({ resolve: resolve as typeof agentLoop.calls[number]["resolve"] });
    })),
  };
});

import { ApprovalBridge } from "../ink/approval-bridge.js";
import { useCockpitController } from "../ink/controller.js";
import { useCockpitStore, type CockpitStore } from "../ink/cockpit-store.js";
import { useEventBridge } from "../ink/event-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import type { ModelRuntime, RoutedModel } from "../lib/model-runtime.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("condition not reached");
}

describe("mounted cockpit controller operation generation", () => {
  const previousTarget = process.env.LITT_TARGET_OVERRIDE;

  beforeEach(() => {
    agentLoop.calls.length = 0;
    process.env.LITT_TARGET_OVERRIDE = "remote";
  });

  afterEach(() => {
    if (previousTarget === undefined) delete process.env.LITT_TARGET_OVERRIDE;
    else process.env.LITT_TARGET_OVERRIDE = previousTarget;
  });

  it("a late Chat A cannot overwrite accepted Mission B, which can still complete", async () => {
    const sessionBridge = new SessionEventBridge();
    const approvalBridge = new ApprovalBridge();
    const session = createRuntimeSession({
      cwd: process.cwd(),
      mode: "act",
      onEvent: sessionBridge.onEvent,
      onStream: sessionBridge.onStream,
    });
    const routed: RoutedModel = {
      id: "test-model",
      label: "Test Model",
      servedBy: "openai",
      provider: "openai",
      reason: "test",
      fallbackReason: null,
      appliedPolicy: "auto",
      openRouterModelId: "openai/test-model",
      providerModelId: "test-model",
    };
    const modelRuntime = {
      refreshAsync: vi.fn(),
      route: vi.fn(() => routed),
      brainLabel: vi.fn(() => "Test Model"),
      registry: {},
    } as unknown as ModelRuntime;
    const client = { is_connected: () => true } as RuntimeClient;
    const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number };
    stdout.columns = 100;
    stdout.rows = 20;
    stdout.on("data", () => {});

    let controller: ReturnType<typeof useCockpitController> | null = null;
    let cockpitStore: CockpitStore | null = null;
    function Harness(): React.ReactElement {
      const store = useCockpitStore();
      useEventBridge(null, store, sessionBridge);
      cockpitStore = store;
      controller = useCockpitController({
        session,
        store,
        approvalBridge,
        sessionBridge,
        modelRuntime,
        client,
        signedIn: true,
      });
      return <Text>{store.state.workstream.overallStatus}</Text>;
    }

    const instance = render(<Harness />, {
      stdout: stdout as unknown as NodeJS.WriteStream,
      patchConsole: false,
    });

    try {
      await tick();
      void controller!.submit("Chat A");
      await waitFor(() => agentLoop.calls.length === 1);

      // Model cancellation releases the composer before the provider promise
      // settles; this is the real overlap boundary the generation guard owns.
      cockpitStore!.actions.setIsProcessing(false);
      await tick();
      void controller!.submit("Mission B", { forceMission: true });
      await waitFor(() => agentLoop.calls.length === 2);
      expect(cockpitStore!.state.workstream.overallStatus).toBe("running");

      const approval = approvalBridge.request({
        toolId: "project.run",
        inputs: { command: "npm", args: ["test"] },
        cwd: process.cwd(),
        mode: "act",
        identity: {
          tenantId: "test",
          userId: "test",
          actorId: "test",
          trusted: false,
          interaction: "interactive",
        },
      } as ExecutionRequest, null);
      cockpitStore!.actions.workstreamPush((workstream) => workstream.setBlocked());

      agentLoop.calls[0]!.resolve({
        content: "CHAT_A_LATE",
        termination: "complete",
        durationMs: 1,
        toolResults: [],
      });
      await tick();
      expect(approvalBridge.pending).not.toBeNull();
      expect(cockpitStore!.state.workstream.overallStatus).toBe("blocked");
      expect(cockpitStore!.state.chatTranscript.some((message) => message.content === "CHAT_A_LATE")).toBe(false);

      approvalBridge.decide(false);
      await expect(approval).resolves.toBe(false);

      const missionId = session.getStore().getMission()!.id;
      sessionBridge.onEvent({
        type: "litt_event",
        subtype: "mission:completed",
        ts: Date.now(),
        data: { missionId, missionGeneration: 1, completionReason: "done" },
      } as RuntimeEvent);
      await tick();
      expect(cockpitStore!.state.workstream.overallStatus).toBe("complete");
    } finally {
      instance.unmount();
      stdout.end();
    }
  });
});
