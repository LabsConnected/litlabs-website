/**
 * CockpitApp — the Ink cockpit composition root (premium TUI).
 *
 * Premium layout (spec):
 *   1. Compact header — brand + project + ONLINE + model + state
 *   2. Mission section — only when canonical mission exists
 *   3. Activity stream — conversation/work stream
 *   4. Command dock — ALWAYS visible, keyboard-native input
 *   5. Status bar — quiet context line
 *
 * Layout modes:
 *   FULL    >= 42 rows  — everything visible
 *   MEDIUM  30-41 rows  — compact header, mission first
 *   COMPACT < 30 rows   — minimal header, everything squeezes
 *
 * Input system:
 *   Global useInput ONLY consumes Ctrl+M/K/L/C and Esc.
 *   All printable characters fall through to TextInput.
 *   After overlay closes, focus returns to the prompt.
 */

import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { useCockpitStore } from "./cockpit-store.js";
import { useEventBridge } from "./event-bridge.js";
import { useCockpitController } from "./controller.js";
import { OverlayKeyboardProvider, type KeyboardHandler } from "./overlay-manager.js";
import { isEnter, isEscape, isCtrl } from "./keyboard-utils.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { HelpOverlay } from "./help-overlay.js";
import { Header } from "./header.js";
import { LittShard } from "./litt-shard.js";
import { MissionSection } from "./mission-section.js";
import { ActivityStream } from "./activity-stream.js";
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
import type { HoloState } from "./cockpit-store.js";
import type { MissionProjection } from "./mission-projection.js";

type LayoutMode = "full" | "medium" | "compact";

/**
 * Layout thresholds based on actual row budget.
 *
 * Reserved rows (always visible):
 *   Header:       ~4 rows (compact) to ~8 rows (full)
 *   Mission:      ~3 rows (when active)
 *   Activity:     ~5 rows (shrinks in compact)
 *   Prompt:       ~2 rows
 *   Status bar:   ~3 rows
 *   Separators:   ~2 rows
 *
 * FULL    >= 42 rows  — everything visible
 * MEDIUM  30-41 rows  — compact header, mission first
 * COMPACT < 30 rows   — minimal header, everything squeezes
 */
function getLayoutMode(rows: number): LayoutMode {
  if (rows >= 42) return "full";
  if (rows >= 30) return "medium";
  return "compact";
}

function holoLabel(state: HoloState): string {
  switch (state) {
    case "IDLE": return "IDLE";
    case "UNDERSTANDING": return "INSPECTING";
    case "PLANNING": return "PLANNING";
    case "READING": return "READING";
    case "EDITING": return "EDITING";
    case "RUNNING": return "WORKING";
    case "TESTING": return "TESTING";
    case "VERIFYING": return "VERIFYING";
    case "APPROVAL": return "APPROVAL";
    case "COMPLETE": return "COMPLETE";
    case "FAILED": return "FAILED";
    case "CANCELLED": return "CANCELLED";
    case "TIMEOUT": return "TIMEOUT";
    default: return "IDLE";
  }
}

function holoStateIsBusy(state: HoloState): boolean {
  return ["UNDERSTANDING", "PLANNING", "READING", "EDITING", "RUNNING", "TESTING", "VERIFYING"].includes(state);
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

  // ─── Canonical mission projection ───
  // RuntimeStore.mission is the authority. This hook projects it into
  // the cockpit's canonicalMission state on mount and when mission
  // events arrive through the SessionEventBridge.
  useEffect(() => {
    const projectCanonical = () => {
      const m = session.getStore().getMission();
      if (m) {
        store.actions.setCanonicalMission({
          id: m.id,
          goal: m.goal,
          status: m.status,
          currentStepId: m.currentStepId,
          steps: m.steps.map((s) => ({
            id: s.id,
            title: s.title,
            status: s.status,
            sequence: s.sequence,
          })),
          verificationProven: m.evidence.some(
            (e) => e.type === "verification_result" && e.success === true,
          ) || null,
          restored: m.metadata?.restoredFrom !== undefined,
          completionReason: m.completionReason,
          failureReason: m.failureReason,
        });
      } else {
        store.actions.setCanonicalMission(null);
      }
    };

    // Project on mount
    projectCanonical();

    // Project on every mission event from the session bridge
    const unsub = sessionBridge.subscribe((event) => {
      if (event.type.startsWith("mission.")) {
        projectCanonical();
      }
    });

    return () => { unsub(); };
  }, [session, sessionBridge, store]);

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

  // Calculate elapsed time
  const elapsed = useMemo(() => {
    const started = store.state.missionState?.startedAt;
    if (!started) return undefined;
    return Math.floor((Date.now() - new Date(started).getTime()) / 1000);
  }, [store.state.missionState?.startedAt]);

  // Activity max entries based on layout
  const activityMax = useMemo(() => {
    if (layoutMode === "compact") return Math.max(3, Math.min(4, rows - 20));
    if (layoutMode === "medium") return 6;
    return 10;
  }, [layoutMode, rows]);

  return (
    <OverlayKeyboardProvider appShortcutHandler={appShortcutHandler}>
      <Box flexDirection="column" flexGrow={1}>
        {/* Compact header — always visible */}
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
        <Box flexDirection="column" flexGrow={1}>
          {/* LittShard — identity face (full for planning/approval/completion/failure) */}
          <Box justifyContent="center" alignItems="center" marginTop={1}>
            <LittShard
              state={store.state.holoState}
              full={["PLANNING", "VERIFYING", "APPROVAL", "COMPLETE", "FAILED", "CANCELLED", "TIMEOUT"].includes(store.state.holoState)}
              elapsed={elapsed}
            />
          </Box>

          {/* Mission section — only when canonical mission exists */}
          {(store.state.missionProjection || store.state.missionState) && (
            <MissionSection
              holoState={store.state.holoState}
              mission={store.state.mission}
              missionState={store.state.missionState}
              lastCompletedMission={store.state.lastCompletedMission}
              missionProjection={store.state.missionProjection}
            />
          )}

          {/* Approval UX (when needed) — registers as keyboard owner */}
          {store.state.approvalPrompt && (
            <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
          )}

          {/* Activity stream — conversation/work stream */}
          <ActivityStream
            entries={store.state.activityLog}
            maxEntries={activityMax}
          />

          {/* Command dock — ALWAYS visible */}
          <CommandDock
            history={store.state.commandHistory}
            onSubmit={submit}
            onNavigateHistory={store.actions.navigateHistory}
            onDebugKey={handleDebugKey}
            disabled={disabled}
          />

          {/* Status bar — quiet footer */}
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
          />
        </Box>
      )}
      </Box>
    </OverlayKeyboardProvider>
  );
}
