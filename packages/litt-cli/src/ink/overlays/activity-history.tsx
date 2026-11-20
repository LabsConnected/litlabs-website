/**
 * ActivityHistoryOverlay — the scrollable activity feed ("/activity").
 *
 * The live shell shows only a bounded tail under the WorkstreamDock;
 * this overlay pages through the FULL retained activityLog — commands,
 * tool calls, file changes, evidence, verification, errors — with the
 * same row renderer, redaction, and expandable details as the live feed.
 *
 *   PgUp/PgDn  page through history      Home/End  oldest/live tail
 *   ↑/↓        step one rendered row     d         toggle all details
 *   Esc/Enter/q close
 *
 * The overlay reads the LIVE log: while a mission runs, new entries keep
 * arriving. A view scrolled up stays pinned to its position; scrollBack=0
 * follows the live tail.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";
import { useOverlayKeyboard } from "../overlay-manager.js";
import { isEnter, isEscape } from "../keyboard-utils.js";
import { COLORS } from "../colors.js";
import {
  ActivityFeedRow,
  activityFeedMetrics,
  fitActivityFeed,
} from "../activity-stream.js";
import type { ActivityEntry } from "../cockpit-store.js";

export interface ActivityHistoryOverlayProps {
  entries: ActivityEntry[];
  /** Global expand-all flag (Ctrl+O toolDetails). */
  details?: boolean;
  /** Per-row expansion ids (Ctrl+G toggles the latest entry). */
  expandedIds?: ReadonlySet<string>;
  onClose: () => void;
}

export function ActivityHistoryOverlay({
  entries,
  details = false,
  expandedIds,
  onClose,
}: ActivityHistoryOverlayProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  // Border(2) + paddingY(2) + header(1) + footer(1) + 2 section margins.
  const bodyRows = Math.max(3, rows - 8);
  const innerWidth = Math.max(30, columns - 6);
  const metrics = activityFeedMetrics(innerWidth);

  const [scrollBack, setScrollBack] = useState(0);
  const [localDetails, setLocalDetails] = useState(false);
  const effectiveDetails = details || localDetails;

  const fitted = useMemo(
    () => fitActivityFeed(entries, bodyRows, innerWidth, effectiveDetails, expandedIds, scrollBack),
    [entries, bodyRows, innerWidth, effectiveDetails, expandedIds, scrollBack],
  );
  const atLive = fitted.scrollBack === 0;

  // Pin the reading position while scrolled up: new entries grow the feed
  // at the bottom, so keep the same distance from the live tail.
  const prevTotalRef = useRef(fitted.totalRows);
  useEffect(() => {
    const delta = fitted.totalRows - prevTotalRef.current;
    prevTotalRef.current = fitted.totalRows;
    if (delta > 0 && fitted.scrollBack > 0) {
      setScrollBack((b) => b + delta);
    }
  }, [fitted.totalRows, fitted.scrollBack]);

  const maxScroll = fitted.maxScroll;
  useOverlayKeyboard("activity", useCallback((input, key) => {
    if (isEscape(key, input) || isEnter(key, input) || input === "q" || input === "Q") {
      onClose();
      return;
    }
    if (input === "d" || input === "D") {
      setLocalDetails((v) => !v);
      return;
    }
    const page = Math.max(3, bodyRows - 1);
    if (key.pageUp) { setScrollBack((b) => Math.min(b + page, maxScroll)); return; }
    if (key.pageDown) { setScrollBack((b) => Math.max(0, b - page)); return; }
    if (key.home) { setScrollBack(maxScroll); return; }
    if (key.end) { setScrollBack(0); return; }
    if (key.upArrow) { setScrollBack((b) => Math.min(b + 1, maxScroll)); return; }
    if (key.downArrow) { setScrollBack((b) => Math.max(0, b - 1)); return; }
  }, [onClose, bodyRows, maxScroll]));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.brand} paddingX={2} paddingY={1}>
      <Box>
        <Text bold color={COLORS.brand}>Activity</Text>
        <Text color={COLORS.secondary}>{`  ${entries.length} events · rows ${fitted.rows}/${fitted.totalRows}`}</Text>
        {atLive
          ? <Text color={COLORS.success}>{"  ● live"}</Text>
          : <Text color={COLORS.secondary}>{`  ↑${fitted.scrollBack} from live`}</Text>}
      </Box>
      <Box flexDirection="column" marginTop={1} height={bodyRows}>
        {fitted.entries.length === 0 ? (
          <Text color={COLORS.secondary}>{"  "}No activity recorded yet.</Text>
        ) : (
          fitted.entries.map((entry) => (
            <ActivityFeedRow
              key={entry.id}
              entry={entry}
              metrics={metrics}
              details={effectiveDetails}
              expandedIds={expandedIds}
            />
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={COLORS.secondary}>
          {effectiveDetails ? "PgUp/PgDn page · Home/End ends · ↑/↓ step · d hide details · Esc close"
            : "PgUp/PgDn page · Home/End ends · ↑/↓ step · d show details · Esc close"}
        </Text>
      </Box>
    </Box>
  );
}
