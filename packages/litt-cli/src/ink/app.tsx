/**
 * CockpitApp — the LiTT shell composition root.
 *
 * Minimal surface (everything powerful stays available; almost nothing
 * is visible until you need it):
 *
 *   ⚡ LiTT                                  LOCAL        ← header (1 line)
 *   (Welcome | transcript + semantic feed + DONE)
 *   › Ask LiTT anything...                                ← composer
 *   ─────────────────────────────────────────────────────
 *   LiTT Auto → GPT-5.6              ○ Plan   ● Act       ← status bar
 *   litlabs-website · main · LOCAL          clean
 *
 * Overlays (/ palette, @ picker, /diff, /ship, /workspace, /resume,
 * model center, help) take the screen above this. The RuntimeStore
 * remains the single authority underneath — the shell invents no state.
 *
 * Input system:
 *   OverlayKeyboardProvider — single dispatch: overlay owners get keys
 *   when open; otherwise ctrl/escape/tab go to the app shortcuts
 *   (F2/Ctrl+K/L/D/N/R/O, Tab=Plan/Act, ?=help) and printable chars go
 *   to the Composer's own useInput.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, useApp, useStdout } from "ink";
import { useCockpitStore } from "./cockpit-store.js";
import { useEventBridge } from "./event-bridge.js";
import { useCockpitController } from "./controller.js";
import { OverlayKeyboardProvider, type KeyboardHandler } from "./overlay-manager.js";
import { isCtrl, isRawF2 } from "./keyboard-utils.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { Header } from "./header.js";
import { LiTTShell } from "./shell/shell.js";
import { ApprovalUX } from "./approval-ux.js";
import { HelpOverlay } from "./help-overlay.js";
import { ModelPicker } from "./model-picker.js";
import { ModelCenter } from "./model-center.js";
import { CommandPalette, DEFAULT_ACTIONS } from "./command-palette.js";
import { ContextPicker } from "./overlays/context-picker.js";
import { DiffViewer } from "./overlays/diff-viewer.js";
import { WorkspacePicker } from "./overlays/workspace-picker.js";
import { ResumePicker } from "./overlays/resume-picker.js";
import { ShipFlow } from "./overlays/ship-flow.js";
import { hasOpenRouterKey, providerLabel } from "../lib/model-provider.js";
import { probeLocalLane } from "../lib/local-lane.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import type { ModelChoice } from "../lib/model-routing.js";
import { applyBranchRefresh } from "../lib/project-state.js";
import { getDiffData, suggestCommitMessage } from "../lib/diff-view.js";
import { discoverWorkspaces } from "../lib/workspace-store.js";
import { listSessions } from "../lib/session-store.js";
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
  /** Auth email for header display (null when unknown). */
  authEmail?: string | null;
  /** Whether the user is signed in. */
  signedIn?: boolean;
}

export function CockpitApp({
  session, client, approvalBridge, sessionBridge,
  project, branch, cwd, mode, gitModified, gitUntracked,
  authEmail, signedIn,
}: CockpitAppProps): React.ReactElement {
  const { exit } = useApp();
  const store = useCockpitStore();
  const { stdout } = useStdout();
  useEventBridge(client, store, sessionBridge);

  // ─── Canonical ModelRuntime — ONE instance for the whole app ───
  const [modelRuntime] = useState(() => new ModelRuntime(store.state.executionTarget === "remote"));

  // Local provider truth comes from a real Ollama probe, not merely
  // the presence of an endpoint environment variable.
  const [localModelReady, setLocalModelReady] = useState(false);

  useEffect(() => {
    if (store.state.executionTarget !== "local") {
      setLocalModelReady(false);
      return;
    }

    let cancelled = false;

    void probeLocalLane().then((status) => {
      if (!cancelled) {
        setLocalModelReady(status.available);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [store.state.executionTarget]);

  const controller = useCockpitController({
    session, store, approvalBridge, sessionBridge,
    onExit: () => exit(), projectName: project, branch: store.state.branch, modelRuntime,
    client, signedIn,
  });
  const { submit, handleApproval } = controller;

  // Seed shell context from the launcher (once). After that, /workspace
  // and branch refreshes own these via the store.
  useEffect(() => {
    store.actions.setWorkspace({
      project: project || store.state.project,
      cwd: cwd || store.state.cwd,
      branch: branch && branch !== "unknown" ? branch : store.state.branch,
      gitModified,
      gitUntracked,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mode prop → session + store (initial).
  useEffect(() => {
    if (mode === "plan" || mode === "act") {
      store.actions.setMode(mode);
      session.setMode(mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branch refresh from the same cwd the tools use — one source of truth.
  useEffect(() => {
    if (branch && branch !== "unknown") {
      store.actions.setBranch(branch);
    }
    applyBranchRefresh(session.getCwd(), store.actions.setBranch, store.state.branch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Responsive layout — the shell adapts but never reflows content.
  useTerminalSize(stdout);

  // executionTarget, NOT hasOpenRouterKey(), is the source of truth for
  // whether the model path is usable — "remote" never needs a local key
  // (see lib/execution-target.ts). hasOpenRouterKey() only matters in
  // "local" (developer/BYOK) mode.
  const modelReady = store.state.executionTarget === "remote" || hasOpenRouterKey() || localModelReady;
  const brain = modelRuntime.brainLabel(store.state.routingMode, store.state.selectedModel);
  // Source truth: show the REAL served provider (from the last run's
  // adapter) AND where it executed — never let "REMOTE" in the header
  // and "OpenRouter • BYOK" in the footer imply two different stories
  // about where the model call actually ran.
  const executionSuffix = store.state.executionTarget === "remote" ? "REMOTE" : "BYOK ✓";
  const source = store.state.activeProvider
    ? `${providerLabel(store.state.activeProvider)} • ${executionSuffix}`
    : store.state.executionTarget === "remote"
      ? "REMOTE (server-executed)"
      : modelReady && !localModelReady ? "OpenRouter • BYOK ✓"
    : modelReady && localModelReady ? "Local Ollama ✓"
    : "No provider";

  // ─── Overlay data (computed on open, memoized until close) ──────
  const overlay = store.state.overlay;
  const diffData = useMemo(() => {
    if (overlay !== "diff-viewer" && overlay !== "ship") return null;
    return getDiffData(store.state.cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, store.state.cwd, controller.diffRefreshKey]);


  const workspaces = useMemo(() => {
    if (overlay !== "workspace-picker") return [];
    return discoverWorkspaces(store.state.cwd);
  }, [overlay, store.state.cwd]);

  const sessions = useMemo(() => {
    if (overlay !== "resume-picker") return [];
    return listSessions();
  }, [overlay]);

  const shipSuggested = useMemo(() => {
    if (overlay !== "ship" || !diffData) return "";
    return suggestCommitMessage(store.state.cwd, diffData.files);
  }, [overlay, diffData, store.state.cwd]);

  // ─── App shortcuts (only when no overlay owns the keyboard) ─────
  const appShortcutHandler = useCallback<KeyboardHandler>((input, key) => {
    if (isRawF2(input)) {
      store.actions.setOverlay("model-center");
      return;
    }
    // Transcript scroll — PgUp/PgDn/Home/End. Works even while busy
    // (browsing history during a run). Never steals Up/Down (history).
    if (key.pageUp) { store.actions.scrollPgUp(); return; }
    if (key.pageDown) { store.actions.scrollPgDn(); return; }
    if (key.home) { store.actions.scrollHome(); return; }
    if (key.end) { store.actions.scrollEnd(); return; }
    if (key.tab) {
      // Tab → Plan/Act toggle. Never mid-processing.
      if (!store.state.isProcessing) controller.toggleMode();
      return;
    }
    // Esc while working — cancel the active mission/chat (the composer
    // shows "Esc to stop"; this makes it true). Esc when idle is the
    // composer's own "clear draft" — the app handler ignores it here.
    if (key.escape && (store.state.isProcessing
      || store.state.holoState === "RUNNING" || store.state.holoState === "UNDERSTANDING"
      || store.state.holoState === "PLANNING"
      || store.state.holoState === "READING" || store.state.holoState === "EDITING"
      || store.state.holoState === "TESTING" || store.state.holoState === "VERIFYING")) {
      session.cancel().catch(() => {});
      // Also cancel an in-flight REMOTE model stream — session.cancel()
      // only stops local tool execution; the server-side model call
      // would otherwise keep running (and being billed) unheard.
      controller.cancelRemoteModel();
      store.actions.setIsProcessing(false);
      store.actions.setHoloState("IDLE");
      store.actions.clearMission();
      store.actions.clearToolProgress();
      store.actions.stopBusy();
      return;
    }
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
        controller.cancelRemoteModel();
        store.actions.setIsProcessing(false);
        store.actions.setHoloState("IDLE");
        store.actions.clearMission();
        store.actions.clearToolProgress();
        store.actions.stopBusy();
      } else {
        exit();
      }
    } else if (isCtrl(input, key, "k")) {
      store.actions.setOverlay("command-palette");
      store.actions.setOverlayQuery("");
    } else if (isCtrl(input, key, "l")) {
      // Ctrl+L — clear the transcript (and any active mission view).
      store.actions.setHoloState("IDLE");
      store.actions.clearMission();
      store.actions.clearChatTranscript();
      store.actions.clearToolProgress();
      store.actions.stopBusy();
    } else if (isCtrl(input, key, "d")) {
      controller.openDiffViewer();
    } else if (isCtrl(input, key, "n")) {
      controller.newSession();
    } else if (isCtrl(input, key, "r")) {
      store.actions.setOverlay("resume-picker");
    } else if (isCtrl(input, key, "o")) {
      // Ctrl+O — toggle execution details: expand/collapse the result
      // summaries of successful tool runs in the execution group.
      // (Workspace switching lives at /workspace and in the palette.)
      store.actions.toggleToolDetails();
    } else if (input === "?") {
      if (!store.state.isProcessing) store.actions.setOverlay("help");
    }
  }, [controller, session, store, approvalBridge, exit]);

  const disabled = store.state.isProcessing
    || store.state.holoState === "RUNNING"
    || store.state.holoState === "UNDERSTANDING"
    || store.state.holoState === "PLANNING" || store.state.holoState === "READING"
    || store.state.holoState === "EDITING" || store.state.holoState === "TESTING"
    || store.state.holoState === "VERIFYING" || store.state.holoState === "APPROVAL";

  const handleModelSelect = useCallback((selected: ModelChoice) => {
    // Picking an explicit model switches routing to FIXED — in "auto" mode
    // cliModeToRouteOptions() ignores selectedModel entirely, so the pick
    // would never be honored ("models don't stick").
    store.actions.updateSelectedModel(selected.id);
    store.actions.updateRoutingMode("fixed");
    store.actions.setOverlay("none");
    store.actions.setOverlayQuery("");
  }, [store]);

  const handleRoutingModeSelect = useCallback((routing: typeof store.state.routingMode) => {
    store.actions.updateRoutingMode(routing);
    store.actions.setOverlayQuery("");
  }, [store]);

  const handlePaletteSelect = useCallback((action: typeof DEFAULT_ACTIONS[number]) => {
    store.actions.setOverlay("none");
    store.actions.setOverlayQuery("");
    store.actions.setComposerValue("");
    submit(action.id);
  }, [store, submit]);

  const closeOverlay = useCallback(() => {
    store.actions.setOverlay("none");
    store.actions.setOverlayQuery("");
  }, [store]);

  const overlayOpen = overlay !== "none";

  return (
    <OverlayKeyboardProvider appShortcutHandler={appShortcutHandler}>
    <Box flexDirection="column">
      {/* Header — the one-line brand band (always compact in the shell). */}
      <Header
        project={store.state.project}
        projectRoot={store.state.cwd}
        branch={store.state.branch}
        brain={brain}
        activeModel={store.state.activeModel}
        source={source}
        connected={store.state.connected}
        executionTarget={store.state.executionTarget}
        localRuntime={store.state.localRuntime}
        remoteRuntime={store.state.remoteRuntime}
        mode={store.state.mode}
        authEmail={authEmail}
        signedIn={signedIn}
        compact
      />

      {/* Overlays take over the screen when open */}
      {overlayOpen ? (
        <>
          {overlay === "model-picker" && (
            <ModelPicker
              selectedModelId={store.state.selectedModel}
              routingMode={store.state.routingMode}
              onSelectModel={handleModelSelect}
              onSelectRoutingMode={handleRoutingModeSelect}
              onCancel={closeOverlay}
              activeModel={store.state.activeModel}
              source={source}
              modelRuntime={modelRuntime}
            />
          )}
          {overlay === "model-center" && (
            <ModelCenter
              routingMode={store.state.routingMode}
              selectedModelId={store.state.selectedModel}
              activeModel={store.state.activeModel}
              hasApiKey={modelReady}
              onCancel={closeOverlay}
              onSelectRoutingMode={handleRoutingModeSelect}
              onSelectModel={handleModelSelect}
              modelRuntime={modelRuntime}
            />
          )}
          {overlay === "command-palette" && (
            <CommandPalette
              actions={DEFAULT_ACTIONS}
              initialQuery={store.state.overlayQuery}
              onSelect={handlePaletteSelect}
              onCancel={closeOverlay}
              onSpace={closeOverlay}
            />
          )}
          {overlay === "context-picker" && (
            <ContextPicker
              cwd={store.state.cwd}
              initialQuery={store.state.overlayQuery}
              onSelect={controller.attachToken}
              onCancel={closeOverlay}
            />
          )}
          {overlay === "file-picker" && (
            <ContextPicker
              mode="files"
              cwd={store.state.cwd}
              initialQuery=""
              onSelect={controller.attachToken}
              onCancel={closeOverlay}
            />
          )}
          {overlay === "diff-viewer" && diffData && (
            <DiffViewer
              cwd={store.state.cwd}
              files={diffData.files}
              onClose={closeOverlay}
              onRevert={controller.revertFile}
              onOpen={controller.openFileInEditor}
              onAccept={controller.acceptDiff}
            />
          )}
          {overlay === "workspace-picker" && (
            <WorkspacePicker
              workspaces={workspaces}
              onSelect={controller.switchWorkspace}
              onCancel={closeOverlay}
            />
          )}
          {overlay === "resume-picker" && (
            <ResumePicker
              sessions={sessions}
              onSelect={controller.restoreSession}
              onCancel={closeOverlay}
            />
          )}
          {overlay === "ship" && diffData && (
            <ShipFlow
              cwd={store.state.cwd}
              project={store.state.project}
              branch={store.state.branch}
              files={diffData.files}
              suggestedMessage={shipSuggested}
              onVerify={controller.runShipVerify}
              onCommit={controller.runShipCommit}
              onReview={controller.openDiffViewer}
              onClose={closeOverlay}
            />
          )}
          {overlay === "help" && <HelpOverlay onCancel={closeOverlay} />}
        </>
      ) : (
        <>
          {/* Approval UX (when needed) — registers as keyboard owner */}
          {store.state.approvalPrompt && (
            <ApprovalUX prompt={store.state.approvalPrompt} onDecision={handleApproval} />
          )}

          {/* The minimal shell — welcome/transcript, composer, status bar */}
          <LiTTShell
            messages={store.state.chatTranscript}
            activityLog={store.state.activityLog}
            holoState={store.state.holoState}
            isProcessing={store.state.isProcessing}
            busySince={store.state.busySince}
            missionState={store.state.missionState}
            gitModified={store.state.gitModified}
            gitUntracked={store.state.gitUntracked}
            toolProgress={store.state.toolProgress}
            toolDetails={store.state.toolDetails}
            executionTarget={store.state.executionTarget}
            canonicalMission={store.state.canonicalMission}
            workstream={store.state.workstream}
            composerValue={store.state.composerValue}
            onComposerChange={(v) => store.actions.setComposerValue(v)}
            onSubmit={(v) => {
              // Preserve the draft until submit is accepted. If submit
              // throws synchronously (before adding any chat message),
              // the draft is restored so the user doesn't lose their text.
              const draft = store.state.composerValue;
              store.actions.setComposerValue("");
              try {
                submit(v);
              } catch (err) {
                // Synchronous throw before any transcript mutation —
                // restore the draft and surface the error.
                store.actions.setComposerValue(draft);
                store.actions.addActivity({
                  id: `act_${Date.now()}_submit_err`,
                  ts: Date.now(),
                  type: "error",
                  tag: "SUBMIT",
                  text: `Submit failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            }}
            onNavigateHistory={store.actions.navigateHistory}
            onOpenPalette={controller.openPalette}
            onClosePalette={closeOverlay}
            onOpenContext={controller.openContext}
            composerDisabled={disabled}
            composerScrolled={store.state.transcriptAnchor !== null}
            composerFocusEpoch={store.state.focusEpoch}
            onComposerReturnToLive={() => {
              // Typing while scrolled: return to live AND restore the
              // caret exactly once (the allowed explicit focus moment).
              store.actions.setTranscriptAnchor(null);
              store.actions.bumpFocus();
            }}
            transcriptAnchor={store.state.transcriptAnchor}
            onTranscriptPageChange={store.actions.setTranscriptPage}
            onTranscriptAnchorChange={store.actions.setTranscriptAnchor}
            project={store.state.project}
            branch={store.state.branch}
            localRuntime={store.state.localRuntime}
            brain={brain}
            activeModel={store.state.activeModel}
            activeProvider={store.state.activeProvider}
            mode={store.state.mode}
            approvalPrompt={store.state.approvalPrompt}
            onApprovalDecision={handleApproval}
            approvalSince={store.state.approvalSince}
            approvalAccumMs={store.state.approvalAccumMs}
          />
        </>
      )}
    </Box>
    </OverlayKeyboardProvider>
  );
}
