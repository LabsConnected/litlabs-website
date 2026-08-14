/**
 * CockpitApp — the Ink cockpit composition root.
 *
 * Architecture:
 *   Ink UI → RuntimeSession → ExecutionGateway → Executor → Events → Ink UI
 *
 * Layout (top to bottom):
 *   ⚡ LiTT CODE header (branded)
 *   ┌─────────────┐  Subsystem cards (independent truth)
 *   │  ◇ LiTT ◇   │  RUNTIME  ● ONLINE
 *   │  [ pulse ]   │  TERMINAL ● READY
 *   │  THINKING    │  MEMORY   ● READY
 *   └─────────────┘  AGENT    ● IDLE
 *   CURRENT MISSION
 *   ACTIVITY (live event stream)
 *   FILES (git status)
 *   QUICK ACTIONS
 *   litt ❯ command dock
 *   status bar + keyboard help
 */

import React, { useCallback } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { useCockpitStore } from "./cockpit-store.js";
import { useEventBridge } from "./event-bridge.js";
import { useCockpitController } from "./controller.js";
import { Header } from "./header.js";
import { Subsystems } from "./subsystems.js";
import { LiTTHoloPanel } from "./holo-panel.js";
import { MissionSection } from "./mission-section.js";
import { ActivityStream } from "./activity-stream.js";
import { FilesInfo } from "./files-info.js";
import { QuickActions } from "./quick-actions.js";
import { CommandDock } from "./command-dock.js";
import { ApprovalUX } from "./approval-ux.js";
import { StatusBar } from "./status-bar.js";
import { ModelPicker, DEFAULT_MODELS } from "./model-picker.js";
import { CommandPalette, DEFAULT_ACTIONS } from "./command-palette.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";
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
  mode: string;
  gitModified: number;
  gitUntracked: number;
}

export function CockpitApp({
  session, client, approvalBridge, sessionBridge,
  project, branch, model, cwd, mode, gitModified, gitUntracked,
}: CockpitAppProps): React.ReactElement {
  const { exit } = useApp();
  const store = useCockpitStore();
  useEventBridge(client, store, sessionBridge);
  const { submit, handleApproval } = useCockpitController({ session, store, approvalBridge, onExit: () => exit() });

  const effectiveModel = store.state.selectedModel ?? model;
  const modelReady = hasOpenRouterKey();

  // Global keyboard shortcuts
  useInput(useCallback((input, key) => {
    if (store.state.overlay !== "none") return;

    if (key.ctrl && input === "c") {
      if (store.state.holoState === "APPROVAL") {
        approvalBridge.cancel();
        store.actions.clearApproval();
        store.actions.setHoloState("IDLE");
      } else if (store.state.holoState === "RUNNING" || store.state.holoState === "THINKING") {
        session.cancel().catch(() => {});
        store.actions.setHoloState("IDLE");
        store.actions.setMission(null);
      } else {
        exit();
      }
    } else if (key.ctrl && input === "m") {
      store.actions.setOverlay("model-picker");
    } else if (key.ctrl && input === "k") {
      store.actions.setOverlay("command-palette");
    } else if (key.ctrl && input === "l") {
      // Clear activity log
      store.actions.setHoloState("IDLE");
      store.actions.setMission(null);
    }
  }, [session, store, approvalBridge, exit]));

  const disabled = store.state.holoState === "RUNNING" || store.state.holoState === "THINKING" || store.state.holoState === "APPROVAL"
    || store.state.overlay !== "none";

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

  const handlePaletteSelect = useCallback((action: typeof DEFAULT_ACTIONS[number]) => {
    store.actions.setOverlay("none");
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
        mode={mode}
      />

      {/* Holo + Subsystems side by side */}
      <Box flexDirection="row" gap={2}>
        <LiTTHoloPanel state={store.state.holoState} />
        <Box flexDirection="column">
          <Subsystems
            selected={store.state.selectedPanel}
            onSelect={(p) => store.actions.setSelectedPanel(p as import("./cockpit-store.js").CockpitPanel)}
            localRuntime={store.state.localRuntime}
            remoteRuntime={store.state.remoteRuntime}
            holoState={store.state.holoState}
            modelReady={modelReady}
          />
        </Box>
      </Box>

      {/* Mission section */}
      <MissionSection holoState={store.state.holoState} mission={store.state.mission} />

      {/* Approval UX (when needed) */}
      {store.state.approvalPrompt && (
        <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
      )}

      {/* Overlays */}
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

      {/* Activity stream */}
      <ActivityStream entries={store.state.activityLog} />

      {/* Files info */}
      <FilesInfo modified={gitModified} untracked={gitUntracked} />

      {/* Quick actions */}
      <QuickActions />

      {/* Command dock */}
      <Box marginTop={0}>
        <Text dimColor>────────────────────────────────────────────────────────────</Text>
      </Box>
      <CommandDock
        history={store.state.commandHistory}
        onSubmit={submit}
        onNavigateHistory={store.actions.navigateHistory}
        disabled={disabled}
      />

      {/* Status bar */}
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
