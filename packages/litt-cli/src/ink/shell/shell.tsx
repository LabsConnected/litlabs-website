/**
 * LiTTShell — the minimal shell composition root.
 *
 *   ⚡ LiTT                                  LOCAL
 *
 *              (Welcome — when idle)     ┐
 *   ┌────────────────────────────────────┤ same area, swapped in place
 *   │ transcript + semantic feed + DONE  ┘
 *
 *   › Ask LiTT anything...
 *   ─────────────────────────────────────
 *   LiTT Auto → GPT-5.6              ○ Plan   ● Act
 *   litlabs-website · main · LOCAL          clean
 *
 * One rule: everything powerful stays available; almost nothing is
 * visible until you need it. Overlays (/, @, Ctrl+K, /diff, /ship…)
 * live above this shell; the composer stays in place.
 */

import React from "react";
import { Box } from "ink";
import { Welcome } from "./welcome.js";
import { TranscriptArea } from "./transcript.js";
import { Composer } from "./composer.js";
import { StatusBar } from "../status-bar.js";
import type { ActivityEntry, ChatMessage, HoloState, MissionState } from "../cockpit-store.js";

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

  // Status bar wiring
  project: string;
  branch: string;
  localRuntime: string;
  brain: string;
  activeModel: string | null;
  mode: "plan" | "act";
}

export function LiTTShell(props: LiTTShellProps): React.ReactElement {
  const {
    messages, activityLog, holoState, isProcessing, busySince, missionState,
    gitModified, gitUntracked,
    composerValue, onComposerChange, onSubmit, onNavigateHistory,
    onOpenPalette, onOpenContext, composerDisabled,
    project, branch, localRuntime, brain, activeModel, mode,
  } = props;

  const hasConversation = messages.length > 0 || isProcessing || (missionState !== null && missionState.state !== "IDLE");

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* The swap-in-place area: Welcome until the first message, then transcript. */}
      {hasConversation ? (
        <TranscriptArea
          messages={messages}
          activityLog={activityLog}
          maxMessages={6}
          maxActivity={4}
          mission={missionState}
          gitModified={gitModified}
          gitUntracked={gitUntracked}
        />
      ) : (
        <Welcome />
      )}

      {/* The single input line — always visible */}
      <Composer
        value={composerValue}
        onChange={onComposerChange}
        onSubmit={onSubmit}
        onNavigateHistory={onNavigateHistory}
        onOpenPalette={onOpenPalette}
        onOpenContext={onOpenContext}
        disabled={composerDisabled}
        busy={isProcessing}
      />

      {/* The two-line bottom bar */}
      <StatusBar
        project={project}
        branch={branch}
        localRuntime={localRuntime}
        holoState={holoState}
        brain={brain}
        activeModel={activeModel}
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
