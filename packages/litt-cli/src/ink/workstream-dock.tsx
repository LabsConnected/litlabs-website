/**
 * WorkstreamDock — the live "watch LiTT work" operations view.
 *
 * When LiTT is working, this component becomes the primary center of the
 * shell — replacing the idle Welcome screen with a live operations view:
 *
 *   ◉ INSPECTING
 *   Fix CLI backspace behavior across Windows + Termux
 *
 *   ● Understanding
 *     Inspecting terminal input flow
 *   ● Inspecting 4 files
 *     src/input.ts, src/app.tsx, ...
 *   ◉ Working
 *     Tracing raw key events
 *   ○ Next
 *     Run full verification suite
 *
 * Design rules:
 *   - NO chain-of-thought: only concise operational summaries.
 *   - Bounded feed: last 4-7 meaningful activities (grouped).
 *   - Stable widths to prevent rerender jitter.
 *   - Subtle animation: ◉ for current, ● for completed, ○ for queued.
 *   - Responsive: condenses on narrow terminals.
 *   - Completion/failure/blocked have distinct visual states.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS } from "./colors.js";
import { classifyWidth } from "./ui-primitives.js";
import { LiTTMark, type MarkState } from "./litt-mark.js";
import {
  type WorkstreamSnapshot,
  type WorkstreamActivity,
  type WorkstreamPhase,
  type WorkstreamOverallStatus,
  type VerificationState,
  PHASE_DISPLAY,
} from "./workstream-store.js";
import { groupConsecutive, type ActivityGroup } from "./workstream-normalizer.js";

// ─── Phase → MarkState mapping ─────────────────────────────────────

function phaseToMarkState(phase: WorkstreamPhase | null, status: WorkstreamOverallStatus): MarkState {
  if (status === "complete") return "success";
  if (status === "failed") return "error";
  if (status === "blocked") return "idle";
  switch (phase) {
    case "understanding":
    case "planning":
      return "thinking";
    case "inspecting":
    case "editing":
    case "running":
    case "testing":
    case "verifying":
    case "deploying":
    case "syncing":
      return "executing";
    default:
      return "idle";
  }
}

// ─── Phase badge color ─────────────────────────────────────────────

function phaseColor(phase: WorkstreamPhase | null, status: WorkstreamOverallStatus): string {
  if (status === "complete") return COLORS.success;
  if (status === "failed") return COLORS.error;
  if (status === "blocked") return COLORS.gold;
  switch (phase) {
    case "understanding":
    case "planning":
      return COLORS.brandBright;
    case "inspecting":
    case "editing":
    case "running":
      return COLORS.working;
    case "testing":
    case "verifying":
      return COLORS.brand;
    case "deploying":
    case "syncing":
      return COLORS.remote;
    default:
      return COLORS.brand;
  }
}

// ─── Activity status glyphs ────────────────────────────────────────

const STATUS_GLYPH = {
  running: "◉",
  complete: "●",
  failed: "×",
  queued: "○",
} as const;

const STATUS_COLOR = {
  running: COLORS.brand,
  complete: COLORS.secondaryBright,
  failed: COLORS.error,
  queued: COLORS.secondaryDim,
} as const;

// ─── Animation: subtle pulse for the current activity ──────────────

const PULSE_FRAMES = ["◉", "◐", "◓", "◑", "◒"];
const PULSE_MS = 1200;

function usePulse(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setFrame((f) => (f + 1) % PULSE_FRAMES.length);
    }, PULSE_MS / PULSE_FRAMES.length);
    return () => clearInterval(timer);
  }, [active]);
  return active ? PULSE_FRAMES[frame] : STATUS_GLYPH.running;
}

// ─── Truncation helper ─────────────────────────────────────────────

function truncateTail(str: string, max: number): string {
  if (str.length <= max) return str;
  if (max <= 3) return str.slice(0, max);
  return str.slice(0, max - 1) + "…";
}

// ─── Sub-components ────────────────────────────────────────────────

/** The header: LiTT mark + phase badge + objective. */
function WorkstreamHeader({
  snapshot,
  width,
}: {
  snapshot: WorkstreamSnapshot;
  width: number;
}): React.ReactElement {
  const markState = phaseToMarkState(snapshot.phase, snapshot.overallStatus);
  const color = phaseColor(snapshot.phase, snapshot.overallStatus);
  const phaseLabel = snapshot.phase ? PHASE_DISPLAY[snapshot.phase] : snapshot.currentPhase;
  const pulse = usePulse(snapshot.overallStatus === "running");

  return (
    <Box flexDirection="column">
      <Box>
        <LiTTMark state={markState} showWordmark />
        <Text> </Text>
        <Text color={color} bold>
          {snapshot.overallStatus === "running" ? pulse : "◈"} {phaseLabel}
        </Text>
      </Box>
      {snapshot.objective && (
        <Box marginTop={0}>
          <Text color={COLORS.textBright} bold>
            {truncateTail(snapshot.objective, Math.max(20, width - 4))}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/** A single activity row (supports grouped and individual). */
function ActivityRow({
  group,
  width,
  isCurrent,
}: {
  group: ActivityGroup;
  width: number;
  isCurrent: boolean;
}): React.ReactElement {
  const pulse = usePulse(isCurrent && group.status === "running");
  const glyph = isCurrent && group.status === "running"
    ? pulse
    : STATUS_GLYPH[group.status] ?? STATUS_GLYPH.complete;
  const color = STATUS_COLOR[group.status] ?? COLORS.secondaryBright;
  const maxLabel = Math.max(16, width - 6);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={color} bold={isCurrent}>{glyph} </Text>
        <Text color={group.status === "failed" ? COLORS.error : COLORS.text}>
          {truncateTail(group.label, maxLabel)}
        </Text>
        {group.count > 1 && (
          <Text dimColor> ({group.count})</Text>
        )}
      </Box>
      {/* Show first subject as sub-line for file/test groups */}
      {group.subjects.length > 0 && group.count <= 3 && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {truncateTail(group.subjects.join(", "), Math.max(10, width - 8))}
          </Text>
        </Box>
      )}
      {/* For larger groups, show count summary */}
      {group.subjects.length > 0 && group.count > 3 && (
        <Box paddingLeft={2}>
          <Text dimColor>
            {group.subjects.length} files
          </Text>
        </Box>
      )}
    </Box>
  );
}

/** Verification summary block. */
function VerificationBlock({
  verification,
  width,
}: {
  verification: VerificationState;
  width: number;
}): React.ReactElement {
  const statusGlyph = verification.status === "passed" ? "✓"
    : verification.status === "failed" ? "×"
    : verification.status === "running" ? "◉"
    : "○";
  const statusColor = verification.status === "passed" ? COLORS.success
    : verification.status === "failed" ? COLORS.error
    : verification.status === "running" ? COLORS.brand
    : COLORS.secondaryDim;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={statusColor} bold>{statusGlyph} Verification</Text>
      {verification.checks.map((check) => {
        const g = check.status === "passed" ? "✓"
          : check.status === "failed" ? "×"
          : check.status === "running" ? "◉"
          : "○";
        const c = check.status === "passed" ? COLORS.success
          : check.status === "failed" ? COLORS.error
          : check.status === "running" ? COLORS.brand
          : COLORS.secondaryDim;
        return (
          <Box key={check.id} paddingLeft={2}>
            <Text color={c}>{g} </Text>
            <Text color={COLORS.text}>{truncateTail(check.label, Math.max(10, width - 12))}</Text>
            {check.detail && (
              <Text dimColor> {truncateTail(check.detail, Math.max(8, width - check.label.length - 14))}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/** Next action line. */
function NextActionRow({ text, width }: { text: string; width: number }): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text color={COLORS.secondaryDim}>○ Next</Text>
      <Text color={COLORS.secondary}>  {truncateTail(text, Math.max(10, width - 12))}</Text>
    </Box>
  );
}

/** "↑ N earlier" indicator. */
function EarlierIndicator({ count }: { count: number }): React.ReactElement {
  if (count <= 0) return <></>;
  return (
    <Text dimColor>↑ {count} earlier activities</Text>
  );
}

// ─── Completion / Failure / Blocked cards ──────────────────────────

function CompletionCard({ snapshot, width }: { snapshot: WorkstreamSnapshot; width: number }): React.ReactElement {
  const lastSuccess = [...snapshot.activities].reverse().find((a) => a.kind === "success");
  const edits = snapshot.activities.filter((a) => a.kind === "edit" && a.status === "complete");
  const tests = snapshot.activities.filter((a) => a.kind === "test" && a.status === "complete");
  const totalPassed = tests.reduce((sum, t) => sum + (t.passed ?? 0), 0);
  const totalSkipped = tests.reduce((sum, t) => sum + (t.skipped ?? 0), 0);

  return (
    <Box flexDirection="column" alignItems="center" marginTop={1}>
      <Text color={COLORS.success} bold>✓ COMPLETE</Text>
      {snapshot.objective && (
        <Text color={COLORS.textBright} bold>{truncateTail(snapshot.objective, width - 4)}</Text>
      )}
      <Box marginTop={1} flexDirection="column">
        {edits.length > 0 && (
          <Text dimColor>  {edits.length} file{edits.length !== 1 ? "s" : ""} changed</Text>
        )}
        {totalPassed > 0 && (
          <Text dimColor>  {totalPassed} tests passed{totalSkipped > 0 ? ` · ${totalSkipped} skipped` : ""}</Text>
        )}
        {lastSuccess?.label && (
          <Text dimColor>  {truncateTail(lastSuccess.label, width - 4)}</Text>
        )}
      </Box>
    </Box>
  );
}

function FailureCard({ snapshot, width }: { snapshot: WorkstreamSnapshot; width: number }): React.ReactElement {
  const failures = snapshot.activities.filter((a) => a.status === "failed");
  const lastFailure = failures[failures.length - 1];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.error} bold>× {snapshot.objective ? "Failed" : "FAILED"}</Text>
      {snapshot.objective && (
        <Text color={COLORS.text}>{truncateTail(snapshot.objective, width - 4)}</Text>
      )}
      {failures.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.error}>  {failures.length} failure{failures.length !== 1 ? "s" : ""}</Text>
          {lastFailure?.reason && (
            <Text dimColor>  {truncateTail(lastFailure.reason, width - 4)}</Text>
          )}
        </Box>
      )}
      <Box marginTop={1}><Text dimColor>  LiTT stopped before completing.</Text></Box>
    </Box>
  );
}

function BlockedCard({ snapshot, width }: { snapshot: WorkstreamSnapshot; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={COLORS.gold} bold>! BLOCKED</Text>
      {snapshot.objective && (
        <Text color={COLORS.text}>{truncateTail(snapshot.objective, width - 4)}</Text>
      )}
      <Box marginTop={1}><Text dimColor>  Waiting for approval.</Text></Box>
    </Box>
  );
}

// ─── Main WorkstreamDock component ─────────────────────────────────

export interface WorkstreamDockProps {
  snapshot: WorkstreamSnapshot;
  /** Width override (default: stdout columns or 80). */
  width?: number;
  /** Max activity rows to show (default 7). */
  maxActivityRows?: number;
}

/**
 * WorkstreamDock — the primary center view when LiTT is working.
 *
 * Renders:
 *   1. Header: LiTT mark + phase badge + objective
 *   2. Activity feed: last N grouped activities
 *   3. Verification summary (if verification is active)
 *   4. Next action (if known)
 *   5. Completion/failure/blocked card (if terminal)
 */
export function WorkstreamDock({
  snapshot,
  width,
  maxActivityRows = 7,
}: WorkstreamDockProps): React.ReactElement {
  const { stdout } = useStdout();
  const w = width ?? stdout?.columns ?? 80;
  const widthClass = classifyWidth(w);

  // Terminal states get special cards
  if (snapshot.overallStatus === "complete") {
    return <CompletionCard snapshot={snapshot} width={w} />;
  }
  if (snapshot.overallStatus === "failed") {
    return <FailureCard snapshot={snapshot} width={w} />;
  }
  if (snapshot.overallStatus === "blocked") {
    return <BlockedCard snapshot={snapshot} width={w} />;
  }

  // Running / idle — show the live dock
  // Group consecutive activities for the feed
  const allActivities = snapshot.activities;
  const visibleSlice = allActivities.slice(-maxActivityRows * 2); // over-fetch for grouping
  const groups = groupConsecutive(visibleSlice);
  const visibleGroups = groups.slice(-maxActivityRows);
  const hiddenCount = Math.max(0, allActivities.length - visibleSlice.length);

  // Find the current (running) activity index
  const currentIdx = visibleGroups.findIndex((g) => g.status === "running");

  // Narrow width: condense
  const showObjective = widthClass !== "narrow" || !!snapshot.objective;
  const showNext = !!snapshot.nextAction;
  const showVerification = snapshot.verification !== null;

  return (
    <Box flexDirection="column">
      <WorkstreamHeader snapshot={snapshot} width={w} />

      {visibleGroups.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {hiddenCount > 0 && <EarlierIndicator count={hiddenCount} />}
          {visibleGroups.map((group, idx) => (
            <ActivityRow
              key={group.ids[0] ?? idx}
              group={group}
              width={w}
              isCurrent={idx === currentIdx}
            />
          ))}
        </Box>
      )}

      {showVerification && snapshot.verification && (
        <VerificationBlock verification={snapshot.verification} width={w} />
      )}

      {showNext && snapshot.nextAction && (
        <NextActionRow text={snapshot.nextAction} width={w} />
      )}
    </Box>
  );
}

// ─── Row estimator for viewport budget ─────────────────────────────

/**
 * Pure row-count estimator for the WorkstreamDock.
 * Used by the shell to reserve space for the fixed content region.
 */
export function estimateWorkstreamDockRows(
  snapshot: WorkstreamSnapshot,
  maxActivityRows = 7,
): number {
  // Terminal states: compact cards
  if (snapshot.overallStatus === "complete") return 4;
  if (snapshot.overallStatus === "failed") return 5;
  if (snapshot.overallStatus === "blocked") return 4;

  // Running / idle
  let rows = 2; // header (mark + phase) + objective
  if (!snapshot.objective) rows = 1;

  // Activity feed
  const allActivities = snapshot.activities;
  const visibleSlice = allActivities.slice(-maxActivityRows * 2);
  const groups = groupConsecutive(visibleSlice);
  const visibleGroups = groups.slice(-maxActivityRows);
  rows += visibleGroups.length;
  // Each group may have a sub-line for subjects
  for (const g of visibleGroups) {
    if (g.subjects.length > 0) rows += 1;
  }
  if (allActivities.length > visibleSlice.length) rows += 1; // "↑ N earlier"

  // Verification block
  if (snapshot.verification) {
    rows += 1; // header
    rows += snapshot.verification.checks.length;
  }

  // Next action
  if (snapshot.nextAction) rows += 1;

  return rows;
}
