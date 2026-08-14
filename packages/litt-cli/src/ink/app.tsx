/**
 * CockpitApp — the Ink cockpit composition root.
 *
 * Composition only. No business logic. No execution.
 * Everything executable goes through ExecutionGateway via the controller.
 *
 * Architecture:
 *   Ink UI → RuntimeSession → ExecutionGateway → Executor → Events → Ink UI
 */

import React, { useCallback } from "react";
import { Box, useApp, useInput } from "ink";
import { useCockpitStore } from "./cockpit-store.js";
import { useEventBridge } from "./event-bridge.js";
import { useCockpitController } from "./controller.js";
import { Header } from "./header.js";
import { Subsystems } from "./subsystems.js";
import { LiTTHoloPanel } from "./holo-panel.js";
import { ActivityStream } from "./activity-stream.js";
import { CommandDock } from "./command-dock.js";
import { ApprovalUX } from "./approval-ux.js";
import { StatusBar } from "./status-bar.js";
import { ModelPicker, DEFAULT_MODELS } from "./model-picker.js";
import { CommandPalette, DEFAULT_ACTIONS } from "./command-palette.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { SessionEventBridge } from "./session-event-bridge.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

export interface CockpitAppProps {
  session: RuntimeSession;
  client: RuntimeClient | null;
  approvalBridge: ApprovalBridge;
  sessionBridge: SessionEventBridge;
  project: string;
  branch: string;
  model: string;
  cwd: string;
}

export function CockpitApp({ session, client, approvalBridge, sessionBridge, project, branch, model, cwd }: CockpitAppProps): React.ReactElement {
  const { exit } = useApp();
  const store = useCockpitStore();
  useEventBridge(client, store, sessionBridge);
  const { submit, handleApproval } = useCockpitController({ session, store, approvalBridge, onExit: () => exit() });

  // Effective model: selected model overrides the default
  const effectiveModel = store.state.selectedModel ?? model;

  // Ctrl+C cancels active run or pending approval (first press), exits (second press when idle)
  // Ctrl+M opens model picker
  // Ctrl+K opens command palette
  useInput(useCallback((input, key) => {
    // Don't handle Ctrl shortcuts when an overlay is open — let the overlay handle input
    if (store.state.overlay !== "none") return;

    if (key.ctrl && input === "c") {
      if (store.state.holoState === "APPROVAL") {
        approvalBridge.cancel();
        store.actions.clearApproval();
        store.actions.setHoloState("IDLE");
      } else if (store.state.holoState === "RUNNING" || store.state.holoState === "THINKING") {
        session.cancel().catch(() => {});
        store.actions.setHoloState("IDLE");
      } else {
        exit();
      }
    } else if (key.ctrl && input === "m") {
      store.actions.setOverlay("model-picker");
    } else if (key.ctrl && input === "k") {
      store.actions.setOverlay("command-palette");
    }
  }, [session, store, approvalBridge, exit]));

  const disabled = store.state.holoState === "RUNNING" || store.state.holoState === "THINKING" || store.state.holoState === "APPROVAL"
    || store.state.overlay !== "none";

  // Handle model picker selection
  const handleModelSelect = useCallback((selected: typeof DEFAULT_MODELS[number]) => {
    store.actions.setSelectedModel(selected.id);
    store.actions.setOverlay("none");
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "model.changed",
      text: `Model: ${selected.label} (${selected.id})`,
    });
  }, [store]);

  // Handle command palette selection
  const handlePaletteSelect = useCallback((action: typeof DEFAULT_ACTIONS[number]) => {
    store.actions.setOverlay("none");
    // Route the selected action through the normal submit flow
    submit(action.id);
  }, [store, submit]);

  return (
    <Box flexDirection="column">
      <Header
        project={project}
        projectRoot={cwd}
        branch={branch}
        model={effectiveModel}
        connected={store.state.connected}
        localRuntime={store.state.localRuntime}
        remoteRuntime={store.state.remoteRuntime}
      />
      <Box flexDirection="row" gap={2}>
        <LiTTHoloPanel state={store.state.holoState} />
        <Subsystems selected={store.state.selectedPanel} onSelect={store.actions.setSelectedPanel} />
      </Box>
      {store.state.approvalPrompt && (
        <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
      )}
      {store.state.overlay === "model-picker" && (
        <ModelPicker
          models={DEFAULT_MODELS}
          activeModelId={store.state.selectedModel}
          onSelect={handleModelSelect}
          onCancel={() => store.actions.setOverlay("none")}
        />
      )}
      {store.state.overlay === "command-palette" && (
        <CommandPalette
          actions={DEFAULT_ACTIONS}
          onSelect={handlePaletteSelect}
          onCancel={() => store.actions.setOverlay("none")}
        />
      )}
      <ActivityStream entries={store.state.activityLog} />
      <CommandDock
        history={store.state.commandHistory}
        onSubmit={submit}
        onNavigateHistory={store.actions.navigateHistory}
        disabled={disabled}
      />
      <StatusBar
        connected={store.state.connected}
        localRuntime={store.state.localRuntime}
        remoteRuntime={store.state.remoteRuntime}
        cwd={cwd}
        holoState={store.state.holoState}
        model={effectiveModel}
        runId={store.state.currentRunId}
      />
    </Box>
  );
}
