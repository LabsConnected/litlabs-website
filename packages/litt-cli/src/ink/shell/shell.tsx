/**
 * LiTTShell — the minimal shell composition root.
 *
 *   ⚡ LiTT                                  LOCAL          ← header
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
import { TranscriptArea, layoutTranscript, computeViewport, SCROLL_INDICATOR_ROWS } from "./transcript.js";
import { Composer } from "./composer.js";
import { StatusBar } from "../status-bar.js";
import { CONTENT_MEASURE } from "../chat-transcript.js";
import type { ActivityEntry, ChatMessage, HoloState, MissionState } from "../cockpit-store.js";

/** Rows consumed by fixed chrome below the content region:
 *  composer margin(1) + composer(1) + status margin(1) + divider(1) + 2 status lines. */
const CHROME_ROWS = 6;

/** Result block reserve — rows set aside for the DONE/FAILED block. */
const RESULT_RESERVE = 4;

export interface LiTTShellProps {
  messages: ChatMessage[];
  activityLog: ActivityEntry[];
  holoState: HoloState;
  isProcessing: boolean;
  busySince: number | null;
  missionState: MissionState | null;
  gitModified: number;
  gitUntracked: number;

  // Composer wiring
  composerValue: string;
  onComposerChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onNavigateHistory: (direction: "up" | "down") => string | null;
  onOpenPalette: (query: string) => void;
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
  brain: string;
  activeModel: string | null;
  activeProvider: string | null;
  mode: "plan" | "act";
}

export function LiTTShell(props: LiTTShellProps): React.ReactElement {
  const {
    messages, activityLog, holoState, isProcessing, busySince, missionState,
    gitModified, gitUntracked,
    composerValue, onComposerChange, onSubmit, onNavigateHistory,
    onOpenPalette, onOpenContext, composerDisabled,
    composerScrolled, composerFocusEpoch, onComposerReturnToLive,
    transcriptAnchor, onTranscriptPageChange, onTranscriptAnchorChange,
    project, branch, localRuntime, brain, activeModel, activeProvider, mode,
  } = props;

  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  // Guard for harnesses/surfaces that don't wire scroll yet.
  const anchor = transcriptAnchor ?? null;
  const onPageChange = onTranscriptPageChange ?? (() => {});
  const onAnchorChange = onTranscriptAnchorChange ?? (() => {});

  const hasConversation = messages.length > 0 || isProcessing
    || (missionState !== null && missionState.state !== "IDLE");

  // Content measure: readable width on wide terminals, natural on narrow.
  const contentWidth = Math.max(32, Math.min(CONTENT_MEASURE, columns - 4));
  const contentRows = Math.max(8, rows - 1 - CHROME_ROWS);

  const terminalMission = missionState
    && (missionState.state === "COMPLETE" || missionState.state === "FAILED"
      || missionState.state === "CANCELLED" || missionState.state === "TIMEOUT");

  const layout = useMemo(() => layoutTranscript(messages, contentWidth), [messages, contentWidth]);

  const viewport = useMemo(() => {
    if (messages.length === 0) {
      return { start: 0, end: 0, atBottom: true, hasAbove: false, belowCount: 0, fits: true };
    }
    // In scrolled mode the DONE/events are skipped; live mode reserves
    // rows for the result block.
    const reserve = anchor === null && terminalMission ? RESULT_RESERVE : 0;
    return computeViewport(
      messages,
      layout,
      contentRows - reserve,
      anchor,
      anchor === null ? 0 : SCROLL_INDICATOR_ROWS,
    );
  }, [messages, layout, contentRows, anchor, terminalMission]);

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
  useEffect(() => {
    if (anchor !== null && viewport.atBottom) {
      onAnchorChange(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, viewport.atBottom]);

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* The swap-in-place region: Welcome until the first message, then transcript. */}
      <Box flexDirection="column" height={viewport.fits ? contentRows : undefined}>
        {hasConversation ? (
          <TranscriptArea
            messages={messages}
            events={activityLog}
            viewport={viewport}
            contentWidth={contentWidth}
            mission={missionState}
            gitModified={gitModified}
            gitUntracked={gitUntracked}
          />
        ) : (
          <Welcome />
        )}
      </Box>

      {/* The single input line — always visible, always in place */}
      <Composer
        value={composerValue}
        onChange={onComposerChange}
        onSubmit={onSubmit}
        onNavigateHistory={onNavigateHistory}
        onOpenPalette={onOpenPalette}
        onOpenContext={onOpenContext}
        disabled={composerDisabled}
        busy={isProcessing}
        scrolled={composerScrolled}
        focusEpoch={composerFocusEpoch}
        onReturnToLive={onComposerReturnToLive}
      />

      {/* The two-line bottom bar */}
      <StatusBar
        project={project}
        branch={branch}
        localRuntime={localRuntime}
        holoState={holoState}
        brain={brain}
        activeModel={activeModel}
        activeProvider={activeProvider}
        mode={mode}
        isProcessing={isProcessing}
        busySince={busySince}
        missionState={missionState}
        gitModified={gitModified}
        gitUntracked={gitUntracked}
      />
    </Box>
  );
}
