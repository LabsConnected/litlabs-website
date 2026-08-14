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
import type { ApprovalBridge } from "./approval-bridge.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

export interface CockpitAppProps {
  session: RuntimeSession;
  client: RuntimeClient | null;
  approvalBridge: ApprovalBridge;
  project: string;
  branch: string;
  model: string;
  cwd: string;
}

export function CockpitApp({ session, client, approvalBridge, project, branch, model, cwd }: CockpitAppProps): React.ReactElement {
  const { exit } = useApp();
  const store = useCockpitStore();
  useEventBridge(client, store);
  const { submit, handleApproval } = useCockpitController({ session, store, approvalBridge, onExit: () => exit() });

  // Ctrl+C cancels active run or pending approval (first press), exits (second press when idle)
  useInput(useCallback((_, key) => {
    if (key.ctrl && _ === "c") {
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
    }
  }, [session, store, approvalBridge, exit]));

  const disabled = store.state.holoState === "RUNNING" || store.state.holoState === "THINKING" || store.state.holoState === "APPROVAL";

  return (
    <Box flexDirection="column">
      <Header project={project} branch={branch} model={model} connected={store.state.connected} />
      <Box flexDirection="row" gap={2}>
        <LiTTHoloPanel state={store.state.holoState} />
        <Subsystems selected={store.state.selectedPanel} onSelect={store.actions.setSelectedPanel} />
      </Box>
      {store.state.approvalPrompt && (
        <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
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
        cwd={cwd}
        holoState={store.state.holoState}
        model={model}
        runId={store.state.currentRunId}
      />
    </Box>
  );
}
