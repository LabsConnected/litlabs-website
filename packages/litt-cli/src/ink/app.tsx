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
import { Box, Text, useApp, useStdout } from "ink";
import { useCockpitStore } from "./cockpit-store.js";
import { useEventBridge } from "./event-bridge.js";
import { useCockpitController } from "./controller.js";
import { OverlayKeyboardProvider, type KeyboardHandler } from "./overlay-manager.js";
import { isEnter, isEscape, isCtrl } from "./keyboard-utils.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { HelpOverlay } from "./help-overlay.js";
import { Header } from "./header.js";
import { Subsystems } from "./subsystems.js";
import { LiTTHoloPanel } from "./holo-panel.js";
import { MissionSection } from "./mission-section.js";
import { ActivityStream } from "./activity-stream.js";
import { AssistantResponsePanel } from "./assistant-response.js";
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
import { applyBranchRefresh } from "../lib/project-state.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { SessionEventBridge } from "./session-event-bridge.js";
import type { RuntimeSession } from "../lib/runtime-session.js";
import type { RuntimeClient } from "../lib/runtime-client.js";

type LayoutMode = "full" | "medium" | "compact";

/**
 * Layout thresholds based on actual row budget.
 *
 * Reserved rows (always visible):
 *   Header:       ~4 rows (compact) to ~10 rows (full)
 *   Mission:      ~3 rows
 *   Activity:     ~5 rows (shrinks in compact)
 *   Prompt:       ~2 rows
 *   Status bar:   ~3 rows
 *   Separators:   ~2 rows
 *
 * FULL    >= 42 rows  — everything visible
 * MEDIUM  30-41 rows  — hide files, quick actions; compact header
 * COMPACT < 30 rows   — hide holo, subsystems, files, quick actions; minimal header
 */
function getLayoutMode(rows: number): LayoutMode {
  if (rows >= 42) return "full";
  if (rows >= 30) return "medium";
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
  const { submit, handleApproval } = useCockpitController({ session, store, approvalBridge, onExit: () => exit(), projectName: project, branch: store.state.branch });

  // Responsive layout — reactive terminal viewport (spec §9).
  const { rows } = useTerminalSize(stdout);
  const layoutMode = getLayoutMode(rows);

  const modelReady = hasOpenRouterKey();
  const brain = brainLabel(store.state.routingMode, store.state.selectedModel);
  const activeModel = store.state.activeModel;
  const source = modelReady ? "OpenRouter • BYOK ✓" : "No provider";

  // Initialize store branch from prop, then refresh from the same cwd
  // the tools use. This ensures the header branch matches what
  // project.status and other git tools report — one source of truth.
  // Branch detection is delegated to lib/project-state.ts — the UI
  // component never calls child_process directly (spec §4/§58).
  useEffect(() => {
    if (branch && branch !== "unknown") {
      store.actions.setBranch(branch);
    }
    applyBranchRefresh(session.getCwd(), store.actions.setBranch, branch ?? "unknown");
  }, [branch, session, store]);

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

  // App-level shortcut handler — ONLY handles Ctrl+M/K/L/C and Ctrl+C.
  // This is passed to the OverlayKeyboardProvider, which dispatches it
  // ONLY when no overlay owns the keyboard. All printable characters
  // fall through to TextInput in the CommandDock.
  const appShortcutHandler = useCallback<KeyboardHandler>((input, key) => {
    if (isCtrl(input, key, "c")) {
      if (store.state.holoState === "APPROVAL") {
        approvalBridge.cancel();
        store.actions.clearApproval();
        store.actions.setHoloState("IDLE");
      } else if (store.state.isProcessing
        || store.state.holoState === "RUNNING" || store.state.holoState === "UNDERSTANDING"
        || store.state.holoState === "PLANNING"
        || store.state.holoState === "READING" || store.state.holoState === "EDITING"
        || store.state.holoState === "TESTING" || store.state.holoState === "VERIFYING") {
        session.cancel().catch(() => {});
        store.actions.setIsProcessing(false);
        store.actions.setHoloState("IDLE");
        store.actions.clearMission();
      } else {
        exit();
      }
    } else if (isCtrl(input, key, "m")) {
      store.actions.setOverlay("model-picker");
    } else if (isCtrl(input, key, "k")) {
      store.actions.setOverlay("command-palette");
    } else if (isCtrl(input, key, "l")) {
      store.actions.setHoloState("IDLE");
      store.actions.clearMission();
    } else if (input === "?") {
      // ? → Help (spec §16). Only when idle so it doesn't intercept mid-run.
      if (!store.state.isProcessing) store.actions.setOverlay("help");
    }
  }, [session, store, approvalBridge, exit]);

  const disabled = store.state.isProcessing
    || store.state.holoState === "RUNNING"
    || store.state.holoState === "UNDERSTANDING"
    || store.state.holoState === "PLANNING" || store.state.holoState === "READING"
    || store.state.holoState === "EDITING" || store.state.holoState === "TESTING"
    || store.state.holoState === "VERIFYING" || store.state.holoState === "APPROVAL"
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

  // Debug key callback — writes key info to Activity (NOT console.log)
  const handleDebugKey = useCallback((info: string) => {
    store.actions.addActivity({
      id: `act_${Date.now()}_key`,
      ts: Date.now(),
      type: "info",
      tag: "KEY",
      text: info,
    });
  }, [store]);

  // Show overlays on top, hide the main content
  const overlayOpen = store.state.overlay !== "none";

  return (
    <OverlayKeyboardProvider appShortcutHandler={appShortcutHandler}>
    <Box flexDirection="column">
      {/* Header — always visible, compact in medium/compact mode */}
      <Header
        project={project}
        projectRoot={cwd}
        branch={store.state.branch}
        brain={brain}
        activeModel={activeModel}
        source={source}
        connected={store.state.connected}
        localRuntime={store.state.localRuntime}
        remoteRuntime={store.state.remoteRuntime}
        mode={mode}
        compact={layoutMode !== "full"}
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
          {store.state.overlay === "help" && (
            <HelpOverlay onCancel={() => store.actions.setOverlay("none")} />
          )}
        </>
      ) : (
        <>
          {/* Holo + Subsystems — only in full layout (collapses first) */}
          {layoutMode === "full" && (
            <Box flexDirection="row" gap={2}>
              <LiTTHoloPanel
                state={store.state.holoState}
                activeModel={store.state.activeModel}
                routingReason={store.state.mission}
                missionStartedAt={store.state.missionState?.startedAt ?? null}
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
          <MissionSection
            holoState={store.state.holoState}
            mission={store.state.mission}
            missionState={store.state.missionState}
            lastCompletedMission={store.state.lastCompletedMission}
          />

          {/* Approval UX (when needed) — registers as keyboard owner */}
          {store.state.approvalPrompt && (
            <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
          )}

          {/* LiTT's actual response — Activity remains operator telemetry */}
          <AssistantResponsePanel
            text={store.state.assistantResponse.text}
            streaming={store.state.assistantResponse.streaming}
            maxChars={
              layoutMode === "full"
                ? 1000
                : layoutMode === "medium"
                  ? 650
                  : 350
            }
          />

          {/* Activity stream — always visible, shrinks in compact mode */}
          <ActivityStream
            entries={store.state.activityLog}
            maxEntries={layoutMode === "full" ? 10 : layoutMode === "medium" ? 6 : 4}
          />

          {/* Files info — hide in medium/compact */}
          {layoutMode === "full" && (
            <FilesInfo
              modified={gitModified}
              untracked={gitUntracked}
              missionFiles={store.state.missionState?.filesTouched ?? []}
            />
          )}

          {/* Quick actions — hide in medium/compact */}
          {layoutMode === "full" && <QuickActions />}

          {/* Command dock — ALWAYS visible */}
          <CommandDock
            history={store.state.commandHistory}
            onSubmit={submit}
            onNavigateHistory={store.actions.navigateHistory}
            onDebugKey={handleDebugKey}
            disabled={disabled}
          />

          {/* Status bar — always visible: project + branch + model + ctx (spec §31) */}
          <StatusBar
            connected={store.state.connected}
            localRuntime={store.state.localRuntime}
            remoteRuntime={store.state.remoteRuntime}
            cwd={cwd}
            project={project}
            branch={store.state.branch}
            holoState={store.state.holoState}
            brain={brain}
            activeModel={activeModel}
            source={source}
            mode={mode}
            runId={store.state.currentRunId}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
          />
        </>
      )}
    </Box>
    </OverlayKeyboardProvider>
  );
}
