/**
 * ActivityStream — live operator feed with fixed columns.
 *
 * Format:
 *   16:11:06  READ    docs/landing/
 *   16:11:07  THINK   Reviewing current project state
 *   16:11:08  CHAT    LiTT responded · 27.1s
 *
 * Fixed columns:
 *   [timestamp 8ch] [SP] [verb 8ch] [SP] [message...]
 *
 * Messages are truncated to fit the terminal width so nothing wraps.
 * Stream deltas (stdout/stderr/agent.delta) are collapsed — only the
 * latest chunk is shown, prefixed with │.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS, activityColor } from "./colors.js";
import type { ActivityEntry } from "./cockpit-store.js";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/** Map internal event types to short operator tags */
function entryTag(entry: ActivityEntry): string {
  if (entry.tag) return entry.tag;
  switch (entry.type) {
    case "agent.thinking":
    case "agent.request":
      return "THINK";
    case "agent.chat":
      return "CHAT";
    case "agent.delta":
      return "│";
    case "agent.complete":
      return "DONE";
    case "agent.stopped":
      return "STOP";
    case "run.started":
      return "RUN";
    case "run.completed":
      return "DONE";
    case "run.failed":
      return "FAIL";
    case "tool.started":
      return "RUN";
    case "tool.completed":
      return "PASS";
    case "tool.failed":
      return "FAIL";
    case "tool.cancelled":
      return "STOP";
    case "tool.timeout":
      return "WARN";
    case "tool.stdout":
      return "│";
    case "tool.stderr":
      return "│";
    case "approval.required":
      return "APPROVAL";
    case "approval.granted":
      return "PASS";
    case "approval.denied":
      return "FAIL";
    case "credential.resolving":
      return "ROUTE";
    case "credential.ready":
      return "PASS";
    case "credential.denied":
      return "FAIL";
    case "model.changed":
      return "ROUTE";
    case "error":
      return "ERROR";
    case "info":
      return "INFO";
    case "help":
      return "INFO";
    case "mode":
      return "INFO";
    default:
      return "·";
  }
}

/** Truncate text to fit within a max width, adding … if cut */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function ActivityStream({ entries, maxEntries = 8 }: { entries: ActivityEntry[]; maxEntries?: number }): React.ReactElement {
  const { stdout } = useStdout();
  const termWidth = stdout?.columns ?? 80;
  // Fixed columns: "HH:MM:SS  VVVVVVVV  " = 8 + 2 + 8 + 2 = 20 chars
  // Message gets the rest, minus 2 for border padding
  const msgMax = Math.max(20, termWidth - 20 - 2);

  // Collapse consecutive stream deltas — only show the latest
  const visible: ActivityEntry[] = [];
  const raw = entries.slice(-maxEntries * 2); // look back further for collapsing
  for (const entry of raw) {
    const isStream = entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
    if (isStream && visible.length > 0) {
      const last = visible[visible.length - 1];
      const lastIsStream = last.type === "tool.stdout" || last.type === "tool.stderr" || last.type === "agent.delta";
      if (lastIsStream) {
        // Replace the last stream entry with this one (collapse)
        visible[visible.length - 1] = entry;
        continue;
      }
    }
    visible.push(entry);
  }
  const finalVisible = visible.slice(-maxEntries);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={COLORS.brand} paddingX={1}>
      <Text bold color={COLORS.brand}>ACTIVITY</Text>
      {finalVisible.length === 0 ? (
        <Text dimColor> No activity yet — ask LiTT something.</Text>
      ) : (
        finalVisible.map((entry) => {
          const tag = entryTag(entry);
          const color = activityColor(tag);
          const time = formatTime(entry.ts);
          const isStream = entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
          const msg = truncate(entry.text, msgMax);

          return (
            <Box key={entry.id}>
              <Text dimColor>{time}  </Text>
              <Text color={color} bold={!isStream}>{tag.padEnd(8)}</Text>
              <Text color={color} dimColor={isStream || entry.type === "info"}> {msg}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
