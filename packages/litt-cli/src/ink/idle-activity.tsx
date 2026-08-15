/**
 * IdleActivity — the ACTIVITY panel shown at idle (spec §2).
 *
 *   ACTIVITY                                          LIVE
 *   ────────────────────────────────────────────────────
 *   17:52:11  ✓ project.detected     Homebase-3.0
 *   17:52:11  ✓ model.selected       GPT-5.6 Sol
 *   17:52:12  ✓ context.loaded       38%
 *
 * Renders real activity entries from the store. No fabricated events.
 * The LIVE indicator reflects the local runtime readiness state.
 * When there are no entries, shows a quiet placeholder.
 */

import React from "react";
import { Box, Text } from "ink";
import { COLORS, activityColor } from "./colors.js";
import type { ActivityEntry } from "./cockpit-store.js";
import type { LayoutBand } from "./use-terminal-size.js";

/** Status symbol for an activity entry (spec §24). */
function statusSymbol(entry: ActivityEntry): { sym: string; color: string } {
  switch (entry.type) {
    case "tool.completed":
    case "run.completed":
    case "agent.complete":
    case "approval.granted":
      return { sym: "✓", color: COLORS.success };
    case "tool.started":
    case "run.started":
    case "agent.request":
      return { sym: "●", color: COLORS.working };
    case "agent.thinking":
    case "agent.chat":
      return { sym: "◌", color: COLORS.working };
    case "tool.failed":
    case "run.failed":
    case "agent.stopped":
    case "approval.denied":
    case "error":
      return { sym: "×", color: COLORS.error };
    case "tool.cancelled":
      return { sym: "■", color: COLORS.warning };
    case "tool.timeout":
      return { sym: "⌛", color: COLORS.warning };
    default:
      return { sym: "·", color: COLORS.secondary };
  }
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function trunc(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(1, max - 1)) + "…";
}

export interface IdleActivityProps {
  entries: ActivityEntry[];
  /** Local runtime readiness — drives the LIVE indicator. */
  live: boolean;
  band: LayoutBand;
  width: number;
  /** Max rows to show. */
  maxRows?: number;
}

export function IdleActivity({ entries, live, band, width, maxRows = 6 }: IdleActivityProps): React.ReactElement {
  const liveColor = live ? COLORS.success : COLORS.secondary;
  const liveSym = live ? "●" : "○";

  // Filter out noisy stream entries for the idle view.
  const visible = entries
    .filter((e) => e.type !== "tool.stdout" && e.type !== "tool.stderr" && e.type !== "agent.delta")
    .slice(-maxRows);

  const labelWidth = band === "wide" ? 22 : 16;
  const msgMax = Math.max(20, width - 8 - 9 - labelWidth - 2);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box justifyContent="space-between">
        <Text color={COLORS.secondary} bold>{"ACTIVITY"}</Text>
        <Text color={liveColor}>{`${liveSym} ${live ? "LIVE" : "OFFLINE"}`}</Text>
      </Box>
      <Text color={COLORS.secondary}>{"─".repeat(Math.max(8, Math.min(width - 2, 68)))}</Text>
      {visible.length === 0 ? (
        <Text dimColor>{"  · waiting for events"}</Text>
      ) : (
        visible.map((entry) => {
          const { sym, color } = statusSymbol(entry);
          const time = formatTime(entry.ts);
          const tag = entry.tag ?? entry.type;
          const msg = trunc(entry.text, msgMax);
          return (
            <Box key={entry.id}>
              <Text dimColor>{`  ${time}  `}</Text>
              <Text color={color}>{`${sym} `}</Text>
              <Text color={COLORS.secondary}>{tag.padEnd(labelWidth).slice(0, labelWidth)}</Text>
              <Text color={color} dimColor={entry.type === "info"}>{` ${msg}`}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
