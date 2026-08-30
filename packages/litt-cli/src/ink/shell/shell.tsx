/**
 * LiTTShell — the minimal shell composition root.
 *
 *   LiTT                                  LOCAL          ← header
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ (Welcome | transcript viewport + DONE)                   │ ← fixed region
 *   │ (scroll indicator while browsing history)                │
 *   └──────────────────────────────────────────────────────────┘
 *   │ › Ask LiTT anything...▌                                   ← composer
 *   ─────────────────────────────────────────────────────────────
 *   LiTT Auto → GPT-5.6 Luna              ○ Plan   ● Act        ← status bar
 *   litlabs-website · feat/litt-final-integration · LOCAL    clean
 *
 * The content region has a FIXED height (viewport − chrome): the
 * welcome and the transcript swap inside the same reserved region, so
 * the composer and status bar never move. The LOGICAL transcript is
 * never mutated — scroll-model.ts computes a viewport slice (live =
 * newest content; scrolled = anchored history with PgUp/PgDn/Home/End).
 * Only when a single message is taller than the whole region does the
 * shell fall back to natural flow (terminal scrollback).
 *
 * One rule: everything powerful stays available; almost nothing is
 * visible until you need it. Overlays (/, @, Ctrl+K, /diff, /ship…)
 * live above this shell; the composer stays in place.
 */

import React, { useEffect, useMemo } from "react";
import { Box, useStdout } from "ink";
import { Welcome } from "./welcome.js";
import { TranscriptArea, layoutTranscript, computeViewport, SCROLL_INDICATOR_ROWS, estimateExtraContentHeight } from "./transcript.js";
import { Composer } from "./composer.js";
import { StatusBar } from "../status-bar.js";
import { CONTENT_MEASURE } from "../chat-transcript.js";
import { deriveRuntimeState } from "../runtime-state.js";
import type { ActivityEntry, ApprovalPrompt, ChatMessage, HoloState, MissionState, CanonicalMissionProjection } from "../cockpit-store.js";
import { ApprovalUX } from "../approval-ux.js";
import type { ToolProgressSnapshot } from "../tool-progress-store.js";
import type { WorkstreamSnapshot } from "../workstream-store.js";
import type { ExecutionTarget } from "../../lib/execution-target.js";
import { WorkstreamDock, estimateWorkstreamDockRows } from "../workstream-dock.js";

/** Rows consumed by fixed chrome below the content region:
 *  composer margin(1) + composer(1) + status margin(1) + divider(1) + 2 status lines. */
const CHROME_ROWS = 6;

export interface LiTTShellProps {
  messages: ChatMessage[];
  activityLog: ActivityEntry[];
  holoState: HoloState;
  isProcessing: boolean;
  busySince: number | null;
  missionState: MissionState | null;
  gitModified: number;
  gitUntracked: number;

  /** Structured per-tool progress — fills the main content area during
   *  mission execution with friendly per-tool blocks. */
  toolProgress: ToolProgressSnapshot | null;

  /** Where the MODEL provider executes — preserved as the LOCAL/REMOTE
   *  locus on every observability execution block. */
  executionTarget: ExecutionTarget;
  /** Canonical mission projection — real mission steps drive the
   *  MissionProgressBlock. null when no mission is active. */
  canonicalMission: CanonicalMissionProjection | null;
  /** Live workstream snapshot — the "watch LiTT work" dock (live mode). */
  workstream: WorkstreamSnapshot | null;

  // Composer wiring
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
  onOpenPalette: (query: string) => void;
  onClosePalette?: () => void;
  onOpenContext: (query: string) => void;
  composerDisabled: boolean;
  /** True while the transcript is scrolled into history (no fake caret). */
  composerScrolled: boolean;
  /** Focus epoch — caret restarts exactly once per restoration event. */
  composerFocusEpoch: number;
  /** Typing while scrolled returns to live + restores focus. */
  onComposerReturnToLive: () => void;

  // Transcript scroll wiring
  /** null = live (auto-follow); else index of the top visible message. */
  transcriptAnchor: number | null;
  /** Sync the PgUp/PgDn page size (message count) from the live viewport. */
  onTranscriptPageChange: (page: number) => void;
  /** Set the scroll anchor (null = live). Used for auto-return to live. */
  onTranscriptAnchorChange: (anchor: number | null) => void;

  // Status bar wiring
  project: string;
  branch: string;
  localRuntime: string;
  /** Remote transport state — forwarded so the footer matches the header. */
  remoteRuntime?: string;
  brain: string;
  activeModel: string | null;
  activeProvider: string | null;
  mode: "plan" | "act";
  /** Ctrl+O — expand execution details for collapsed successful runs. */
  toolDetails?: boolean;

  // Pinned approval wiring
  /** The pending approval — when set, the approval panel is PINNED
   *  directly above the composer (never buried in the transcript). */
  approvalPrompt: ApprovalPrompt | null;
  /** Approve once / approve similar (session) / deny. */
  onApprovalDecision: (approved: boolean, scope: "once" | "session") => void;
  /** Approval-wait clock (see cockpit-store pause/resumeBusyForApproval). */
  approvalSince: number | null;
  approvalAccumMs: number;
}

export function LiTTShell(props: LiTTShellProps): React.ReactElement {
  const {
    messages, activityLog, holoState, isProcessing, busySince, missionState,
    gitModified, gitUntracked, toolProgress, toolDetails = false,
    executionTarget, canonicalMission, workstream,
    composerValue, onComposerChange, onSubmit, onNavigateHistory,
    onOpenPalette, onClosePalette, onOpenContext, composerDisabled,
    composerScrolled, composerFocusEpoch, onComposerReturnToLive,
    transcriptAnchor, onTranscriptPageChange, onTranscriptAnchorChange,
    project, branch, localRuntime, remoteRuntime = "offline", brain, activeModel, activeProvider, mode,
    approvalPrompt, onApprovalDecision, approvalSince, approvalAccumMs,
  } = props;

  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  // ── Workstream dock: when LiTT is actively working, the dock becomes
  //    the primary center view. The transcript still renders below it
  //    (conversation record), but the workstream is the hero.
  //    When idle, the Welcome or Transcript owns the center.
  const hasWorkstream = workstream != null
    && workstream.activities.length > 0
    && (workstream.hasRunning || workstream.overallStatus !== "idle");

  // Guard for harnesses/surfaces that don't wire scroll yet.
  const anchor = transcriptAnchor ?? null;
  const onPageChange = onTranscriptPageChange ?? (() => {});
  const onAnchorChange = onTranscriptAnchorChange ?? (() => {});

  const hasConversation = messages.length > 0 || isProcessing
    || (missionState !== null && missionState.state !== "IDLE");

  // Welcome stays visible while the user types — the composer gains
  // focus WITHOUT the rest of the product vanishing. Only an actual
  // conversation/mission/workstream replaces the Welcome screen.

  // ── ONE authoritative runtime state (runtime-state.ts) ─────────────
  // Shared by the composer and threaded to surfaces below — the composer
  // copy can never contradict the footer, and a terminal mission
  // atomically unlocks the composer.
  const runtimeState = useMemo(() => deriveRuntimeState({
    holoState,
    isProcessing,
    missionState,
    // `!= null` (loose) on purpose: an UNWIRED approval prompt (undefined)
    // must not pin the shell into waiting_for_approval the way `!== null`
    // alone did — undefined !== null is true, which rendered a phantom
    // "⚠ APPROVAL" footer in every surface that doesn't wire approvals.
    hasApproval: approvalPrompt != null,
  }), [holoState, isProcessing, missionState, approvalPrompt]);

  // Content measure: readable width on wide terminals, natural on narrow.
  const contentWidth = Math.max(32, Math.min(CONTENT_MEASURE, columns - 4));
  const contentRows = Math.max(8, rows - 1 - CHROME_ROWS);

  const layout = useMemo(() => layoutTranscript(messages, contentWidth), [messages, contentWidth]);

  // Extra content height in live mode: tool progress + result block +
  // activity feed. These render BELOW the messages inside the same
  // fixed-height Box, so the viewport budget must reserve rows for them.
  // Without this, the Box overflows and Ink collides lines (the 100×30 bug).
  //
  // In scrolled mode, the observability blocks are NOT rendered, so
  // extraHeight=0 — the scrolled viewport gets the full contentRows
  // budget (more messages visible). This is intentional: the user is
  // browsing history, not watching live execution.
  //
  // The auto-return-to-live effect (below) uses a SEPARATE live-mode
  // atBottom check to avoid the "scroll sticks" bug: previously, the
  // scrolled viewport's larger budget caused atBottom=true immediately
  // after PgUp, yanking the user back to live. Now the auto-return only
  // fires when the anchor truly reaches the bottom in the LIVE budget.
  const extraHeight = useMemo(() => {
    if (anchor !== null) return 0; // scrolled mode — extra content not rendered
    // When the workstream dock is the primary center, don't double-count
    // it as extra content below the transcript.
    const wsForExtra = hasWorkstream ? null : workstream;
    return estimateExtraContentHeight(
      toolProgress, missionState, activityLog, toolDetails,
      holoState, isProcessing, canonicalMission, executionTarget, columns,
      wsForExtra,
    );
  }, [anchor, toolProgress, missionState, activityLog, toolDetails,
      holoState, isProcessing, canonicalMission, executionTarget, columns, workstream, hasWorkstream]);

  // Live-mode extra height (for the auto-return atBottom check).
  // This is the extraHeight as it would be in live mode — used to compute
  // whether the anchored viewport would be at the bottom IF the user
  // returned to live mode. Prevents premature auto-return when the
  // scrolled viewport is larger than the live viewport.
  const liveExtraHeight = useMemo(() => {
    const wsForExtra = hasWorkstream ? null : workstream;
    return estimateExtraContentHeight(
      toolProgress, missionState, activityLog, toolDetails,
      holoState, isProcessing, canonicalMission, executionTarget, columns,
      wsForExtra,
    );
  }, [toolProgress, missionState, activityLog, toolDetails,
      holoState, isProcessing, canonicalMission, executionTarget, columns, workstream, hasWorkstream]);

  const viewport = useMemo(() => {
    if (messages.length === 0) {
      return { start: 0, end: 0, atBottom: true, hasAbove: false, belowCount: 0, fits: extraHeight < contentRows };
    }
    // Reserve rows for extra content (tool progress + result block + feed).
    // In scrolled mode, extra content is not rendered, so reserve = 0.
    const reserve = anchor === null ? extraHeight : 0;
    // If the extra content (observability + workstream dock) alone exceeds
    // the region, fall back to natural flow (terminal scrollback) instead
    // of overflowing the fixed Box — never invent a scroll anchor jump.
    if (reserve >= contentRows) {
      const last = messages.length - 1;
      return { start: last, end: messages.length, atBottom: true, hasAbove: last > 0, belowCount: 0, fits: false };
    }
    return computeViewport(
      messages,
      layout,
      contentRows - reserve,
      anchor,
      anchor === null ? 0 : SCROLL_INDICATOR_ROWS,
    );
  }, [messages, layout, contentRows, anchor, extraHeight]);

  // Page size for PgUp/PgDn = the number of messages the LIVE viewport
  // shows. Synced on every render.
  useEffect(() => {
    if (messages.length === 0) return;
    const live = computeViewport(messages, layout, contentRows, null, 0);
    onPageChange(Math.max(1, live.end - live.start));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, layout, contentRows]);

  // Auto-return to live: when the anchored viewport naturally reaches
  // the newest content, drop the anchor (auto-follow resumes). This
  // never yanks a scrolled view — it only fires once the user has
  // scrolled down to the bottom themselves (or the transcript shrank).
  //
  // CRITICAL FIX: The atBottom check uses the LIVE-MODE budget (with
  // extraHeight reserved), not the scrolled-mode budget (which is larger
  // because extraHeight=0 in scrolled mode). Without this, PgUp from live
  // sets an anchor near the bottom, the scrolled viewport (with its larger
  // budget) immediately reaches atBottom=true, and the auto-return yanks
  // the user back to live — the "scroll sticks" bug. Now the auto-return
  // only fires when the anchor would be at the bottom even in live mode.
  useEffect(() => {
    if (anchor === null) return;
    // Compute atBottom using the live-mode budget (with extraHeight).
    // If the live-mode viewport from this anchor would be at the bottom,
    // auto-return is safe — the user won't see a visual jump.
    const liveReserve = liveExtraHeight;
    if (liveReserve >= contentRows) return; // natural flow — no auto-return
    const liveViewport = computeViewport(
      messages,
      layout,
      contentRows - liveReserve,
      anchor,
      SCROLL_INDICATOR_ROWS,
    );
    if (liveViewport.atBottom) {
      onAnchorChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, messages, layout, contentRows, liveExtraHeight]);

  // ── Workstream dock is the primary center when active (declared above).
  return (
    <Box flexDirection="column" paddingX={2}>
      {/* The swap-in-place region: Welcome until the first message, then transcript.
          When workstream is active, the dock takes the primary slot. */}
      <Box flexDirection="column" height={viewport.fits ? contentRows : undefined}>
        {hasWorkstream ? (
          <WorkstreamDock
            snapshot={workstream!}
            width={contentWidth}
          />
        ) : hasConversation ? (
          <TranscriptArea
            messages={messages}
            events={activityLog}
            viewport={viewport}
            contentWidth={contentWidth}
            mission={missionState}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
            toolProgress={toolProgress}
            toolDetails={toolDetails}
            holoState={holoState}
            isProcessing={isProcessing}
            executionTarget={executionTarget}
            canonicalMission={canonicalMission}
            workstream={workstream}
          />
        ) : (
          <Welcome
            project={project}
            branch={branch}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
            executionTarget={executionTarget}
          />
        )}
      </Box>

      {/* Pinned approval panel — ALWAYS directly above the composer.
          It never scrolls away with the transcript, so a pending approval
          is actionable no matter where the user has scrolled. It owns
          ALL keyboard input while pending (a/⇧a/d/Esc). */}
      {approvalPrompt && (
        <ApprovalUX
          prompt={approvalPrompt}
          onDecision={onApprovalDecision}
        />
      )}

      {/* The single input line — always visible, always in place */}
      <Composer
        value={composerValue}
        onChange={onComposerChange}
        onSubmit={onSubmit}
        onNavigateHistory={onNavigateHistory}
        onOpenPalette={onOpenPalette}
        onClosePalette={onClosePalette}
        onOpenContext={onOpenContext}
        disabled={composerDisabled}
        busy={isProcessing}
        runtimeState={runtimeState}
        scrolled={composerScrolled}
        focusEpoch={composerFocusEpoch}
        onReturnToLive={onComposerReturnToLive}
      />

      {/* The two-line bottom bar */}
      <StatusBar
        project={project}
        branch={branch}
        localRuntime={localRuntime}
        remoteRuntime={remoteRuntime}
        holoState={holoState}
        brain={brain}
        activeModel={activeModel}
        activeProvider={activeProvider}
        mode={mode}
        isProcessing={isProcessing}
        busySince={busySince}
        approvalSince={approvalSince}
        approvalAccumMs={approvalAccumMs}
        approvalCount={approvalPrompt ? approvalPrompt.depth : 0}
        missionState={missionState}
        gitModified={gitModified}
        gitUntracked={gitUntracked}
      />
    </Box>
  );
}
