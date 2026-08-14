/**
 * ActivityStream — consumes canonical runtime events only.
 *
 * Renders the activity log with timestamps, runId, toolCallId,
 * stdout/stderr streaming, approval events, and credential state.
 *
 * This component NEVER invents events. Every entry comes from
 * the CockpitStore's activityLog, which is populated by the
 * event bridge from RuntimeClient lifecycle events.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ActivityEntry } from "./cockpit-store.js";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

function shortId(id?: string): string {
  if (!id) return "";
  return id.length > 8 ? id.slice(-8) : id;
}

function entryColor(entry: ActivityEntry): string {
  if (entry.stream === "stderr") return "red";
  switch (entry.type) {
    case "run.started": return "cyan";
    case "tool.started": return "blue";
    case "tool.completed": return "green";
    case "tool.failed": return "red";
    case "tool.cancelled": return "yellow";
    case "tool.timeout": return "yellow";
    case "run.completed": return "green";
    case "run.failed": return "red";
    case "approval.required": return "yellow";
    case "approval.granted": return "green";
    case "approval.denied": return "red";
    case "credential.resolving": return "blue";
    case "credential.ready": return "green";
    case "credential.denied": return "red";
    case "agent.thinking": return "cyan";
    default: return "gray";
  }
}

function entryIcon(entry: ActivityEntry): string {
  switch (entry.type) {
    case "run.started": return "▶";
    case "tool.started": return "○";
    case "tool.completed": return "✓";
    case "tool.failed": return "✗";
    case "tool.cancelled": return "⊘";
    case "tool.timeout": return "⏱";
    case "run.completed": return "■";
    case "run.failed": return "■";
    case "approval.required": return "⚠";
    case "approval.granted": return "✓";
    case "approval.denied": return "✗";
    case "credential.resolving": return "⟳";
    case "credential.ready": return "✓";
    case "credential.denied": return "✗";
    case "agent.thinking": return "◈";
    default: return "·";
  }
}

export function ActivityStream({ entries }: { entries: ActivityEntry[] }): React.ReactElement {
  const visible = entries.slice(-15);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold color="gray">Activity</Text>
      {visible.length === 0 ? (
        <Text dimColor> No activity yet</Text>
      ) : (
        visible.map((entry) => {
          const color = entryColor(entry);
          const icon = entryIcon(entry);
          const time = formatTime(entry.ts);
          const run = shortId(entry.runId);
          const tool = shortId(entry.toolCallId);
          const tags = run ? `[${run}]` : "";
          const toolTag = tool ? `[${tool}]` : "";

          return (
            <Box key={entry.id}>
              <Text color={color}>{icon} </Text>
              <Text dimColor>{time} </Text>
              {tags && <Text dimColor>{tags} </Text>}
              {toolTag && <Text dimColor>{toolTag} </Text>}
              <Text color={color}>{entry.text}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
