/**
 * CockpitApp — the Ink cockpit composition root.
 *
 * Priority order (what must always be visible):
 *   1. Header (compact in small terminals)
 *   2. LiTT state (holo)
 *   3. Current mission
 *   4. Activity
 *   5. Prompt (ALWAYS visible)
 *   6. Status bar
 *
 * Files / quick actions / extra telemetry collapse first
 * when the terminal is too short.
 *
 * Input system:
 *   Global useInput ONLY consumes Ctrl+M/K/L/C and Esc.
 *   All printable characters fall through to TextInput.
 *   After overlay closes, focus returns to the prompt.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
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
import { ModelPicker } from "./model-picker.js";
import { ModelCenter } from "./model-center.js";
import { CommandPalette, DEFAULT_ACTIONS } from "./command-palette.js";
import { hasOpenRouterKey } from "../lib/model-provider.js";
import { brainLabel, type ModelChoice } from "../lib/model-routing.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { SessionEventBridge } from "./session-event-bridge.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

type LayoutMode = "full" | "medium" | "compact";

function getLayoutMode(rows: number): LayoutMode {
  if (rows >= 38) return "full";
  if (rows >= 24) return "medium";
  return "compact";
}

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
  const { stdout } = useStdout();
  useEventBridge(client, store, sessionBridge);
  const { submit, handleApproval } = useCockpitController({ session, store, approvalBridge, onExit: () => exit() });

  // Responsive layout — track terminal size
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => getLayoutMode(stdout?.rows ?? 40));
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setLayoutMode(getLayoutMode(stdout.rows ?? 40));
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  const modelReady = hasOpenRouterKey();
  const brain = brainLabel(store.state.routingMode, store.state.selectedModel);
  const activeModel = store.state.activeModel;
  const source = modelReady ? "OpenRouter • BYOK ✓" : "No provider";

  // Seed startup activity (only once, when local runtime becomes ready)
  useEffect(() => {
    if (store.state.localRuntime === "ready" && store.state.activityLog.length === 0) {
      const now = Date.now();
      store.actions.addActivity({ id: `act_${now}_0`, ts: now, type: "info", text: `Project detected: ${project}` });
      store.actions.addActivity({ id: `act_${now}_1`, ts: now + 1, type: "info", text: `Runtime initialized` });
      if (modelReady) {
        store.actions.addActivity({ id: `act_${now}_2`, ts: now + 2, type: "info", text: `Provider: OpenRouter • BYOK ✓` });
      }
      store.actions.addActivity({ id: `act_${now}_3`, ts: now + 3, type: "info", text: `LiTT ready` });
    }
  }, [store.state.localRuntime, store.state.activityLog.length, project, modelReady, store]);

  // Global keyboard shortcuts — ONLY consume Ctrl+M/K/L/C.
  // All printable characters MUST fall through to TextInput.
  // This is critical: do not act on any key that isn't a shortcut.
  useInput(useCallback((input, key) => {
    // Only handle ctrl shortcuts and escape — nothing else
    if (!key.ctrl && !key.escape) return;
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
      store.actions.setHoloState("IDLE");
      store.actions.setMission(null);
    }
  }, [session, store, approvalBridge, exit]));

  const disabled = store.state.holoState === "RUNNING" || store.state.holoState === "THINKING" || store.state.holoState === "APPROVAL"
    || store.state.overlay !== "none";

  const handleModelSelect = useCallback((selected: ModelChoice) => {
    store.actions.setSelectedModel(selected.id);
    store.actions.setOverlay("none");
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "model.changed",
      text: `Brain: ${selected.label} (${selected.id})`,
    });
  }, [store]);

  const handleRoutingModeSelect = useCallback((mode: typeof store.state.routingMode) => {
    store.actions.setRoutingMode(mode);
    store.actions.addActivity({
      id: `act_${Date.now()}`,
      ts: Date.now(),
      type: "model.changed",
      text: `Routing mode: ${mode.toUpperCase()}`,
    });
  }, [store]);

  const handlePaletteSelect = useCallback((action: typeof DEFAULT_ACTIONS[number]) => {
    store.actions.setOverlay("none");
    submit(action.id);
  }, [store, submit]);

  // Show overlays on top, hide the main content
  const overlayOpen = store.state.overlay !== "none";

  return (
    <Box flexDirection="column">
      {/* Header — always visible, but compact mode shows less */}
      <Header
        project={project}
        projectRoot={cwd}
        branch={branch}
        brain={brain}
        activeModel={activeModel}
        source={source}
        connected={store.state.connected}
        localRuntime={store.state.localRuntime}
        remoteRuntime={store.state.remoteRuntime}
        mode={mode}
        compact={layoutMode === "compact"}
      />

      {/* Overlays take over the screen when open */}
      {overlayOpen ? (
        <>
          {store.state.overlay === "model-picker" && (
            <ModelPicker
              selectedModelId={store.state.selectedModel}
              routingMode={store.state.routingMode}
              onSelectModel={handleModelSelect}
              onSelectRoutingMode={handleRoutingModeSelect}
              onCancel={() => store.actions.setOverlay("none")}
            />
          )}
          {store.state.overlay === "model-center" && (
            <ModelCenter
              routingMode={store.state.routingMode}
              selectedModelId={store.state.selectedModel}
              hasApiKey={modelReady}
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
        </>
      ) : (
        <>
          {/* Holo + Subsystems — hide in compact mode */}
          {layoutMode !== "compact" && (
            <Box flexDirection="row" gap={2}>
              <LiTTHoloPanel
                state={store.state.holoState}
                activeModel={store.state.activeModel}
                routingReason={store.state.mission}
              />
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
          )}

          {/* Mission section — always visible */}
          <MissionSection holoState={store.state.holoState} mission={store.state.mission} />

          {/* Approval UX (when needed) */}
          {store.state.approvalPrompt && (
            <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
          )}

          {/* Activity stream — always visible */}
          <ActivityStream entries={store.state.activityLog} />

          {/* Files info — hide in medium/compact */}
          {layoutMode === "full" && <FilesInfo modified={gitModified} untracked={gitUntracked} />}

          {/* Quick actions — hide in medium/compact */}
          {layoutMode === "full" && <QuickActions />}

          {/* Command dock — ALWAYS visible */}
          <Box marginTop={0}>
            <Text dimColor>────────────────────────────────────────────────────────────</Text>
          </Box>
          <CommandDock
            history={store.state.commandHistory}
            onSubmit={submit}
            onNavigateHistory={store.actions.navigateHistory}
            disabled={disabled}
          />

          {/* Status bar — always visible */}
          <StatusBar
            connected={store.state.connected}
            localRuntime={store.state.localRuntime}
            remoteRuntime={store.state.remoteRuntime}
            cwd={cwd}
            holoState={store.state.holoState}
            brain={brain}
            activeModel={activeModel}
            runId={store.state.currentRunId}
          />
        </>
      )}
    </Box>
  );
}
