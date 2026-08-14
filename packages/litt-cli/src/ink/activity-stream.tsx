/**
 * ActivityStream — live event stream with icons, timestamps.
 *
 * Consumes canonical runtime events only. Every entry comes from
 * the CockpitStore's activityLog, populated by the event bridge.
 */

import React from "react";
import { Box, Text } from "ink";
import type { ActivityEntry } from "./cockpit-store.js";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function shortId(id?: string): string {
  if (!id) return "";
  return id.length > 8 ? id.slice(-8) : id;
}

function entryColor(entry: ActivityEntry): string {
  if (entry.stream === "stderr") return "red";
  switch (entry.type) {
    case "run.started": return "cyan";
    case "tool.started": return "cyan";
    case "tool.completed": return "green";
    case "tool.failed": return "red";
    case "tool.cancelled": return "yellow";
    case "tool.timeout": return "yellow";
    case "tool.stdout": return "gray";
    case "tool.stderr": return "red";
    case "run.completed": return "green";
    case "run.failed": return "red";
    case "approval.required": return "yellow";
    case "approval.granted": return "green";
    case "approval.denied": return "red";
    case "credential.resolving": return "cyan";
    case "credential.ready": return "green";
    case "credential.denied": return "red";
    case "agent.thinking": return "cyan";
    case "agent.request": return "magenta";
    case "agent.chat": return "magenta";
    case "agent.delta": return "gray";
    case "agent.complete": return "green";
    case "agent.stopped": return "yellow";
    case "model.changed": return "magenta";
    case "error": return "red";
    case "info": return "gray";
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
    case "tool.stdout": return "│";
    case "tool.stderr": return "│";
    case "run.completed": return "■";
    case "run.failed": return "■";
    case "approval.required": return "⚠";
    case "approval.granted": return "✓";
    case "approval.denied": return "✗";
    case "credential.resolving": return "⟳";
    case "credential.ready": return "✓";
    case "credential.denied": return "✗";
    case "agent.thinking": return "◈";
    case "agent.request": return "❯";
    case "agent.chat": return "❯";
    case "agent.delta": return " ";
    case "agent.complete": return "■";
    case "agent.stopped": return "■";
    case "model.changed": return "◆";
    case "error": return "✗";
    case "info": return "·";
    default: return "·";
  }
}

export function ActivityStream({ entries }: { entries: ActivityEntry[] }): React.ReactElement {
  const visible = entries.slice(-12);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
      <Text bold color="magenta">ACTIVITY</Text>
      {visible.length === 0 ? (
        <Text dimColor> No activity yet — type a command or ask LiTT something.</Text>
      ) : (
        visible.map((entry) => {
          const color = entryColor(entry);
          const icon = entryIcon(entry);
          const time = formatTime(entry.ts);
          const run = shortId(entry.runId);

          return (
            <Box key={entry.id}>
              <Text dimColor>{time}  </Text>
              <Text color={color}>{icon} </Text>
              {run && <Text dimColor>[{run}] </Text>}
              <Text color={color} dimColor={entry.type === "tool.stdout" || entry.type === "agent.delta"}>{entry.text}</Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}
