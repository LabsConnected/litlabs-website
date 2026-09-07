/**
 * ActivityStream — live operator feed with fixed columns.
 *
 * Shows real tool activity inline while LiTT works: file reads, searches,
 * edits, shell commands, test/build output, failures, retries, git
 * diff/status, and completion. Rows with a `fullText` payload are
 * expandable via the `details` prop (wired to Ctrl+O in the shell).
 *
 * Format:
 *   16:11:06  READ    packages/litt-cli/src/ink/activity-stream.tsx
 *   16:11:07  RUN     git status
 *   16:11:08  TEST    vitest run --reporter=dot
 *   16:11:09  FAIL    pnpm build
 *
 * Fixed columns:
 *   [timestamp 8ch] [SP] [verb 8ch] [SP] [indicator?] [message...]
 *
 * Messages are wrapped/truncated to fit the terminal width. Stream deltas
 * (stdout/stderr/agent.delta) are collapsed — only the latest chunk is
 * shown, but it expands when details are open.
 */

import React from "react";
import { Box, Text, useStdout } from "ink";
import { COLORS, activityColor } from "./colors.js";
import { classifyWidth } from "./ui-primitives.js";
import type { ActivityEntry } from "./cockpit-store.js";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

const TAG_WIDTH = 8;
const DETAIL_MAX_LINES = 8;
const TIMESTAMP_WIDTH = 8;
const GAP = 2; // two spaces between time and tag

/** Whether the entry is a live stream delta. */
export function isStreamEntry(entry: ActivityEntry): boolean {
  return entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
}

/** Collapse consecutive stream deltas and keep the newest `max` events. */
export function visibleEvents(entries: ActivityEntry[], max: number): ActivityEntry[] {
  const collapsed: ActivityEntry[] = [];
  // Look back far enough that collapsing doesn't drop real events.
  const raw = entries.slice(-Math.max(max * 3, max));
  for (const entry of raw) {
    if (isStreamEntry(entry) && collapsed.length > 0 && isStreamEntry(collapsed[collapsed.length - 1])) {
      collapsed[collapsed.length - 1] = entry;
      continue;
    }
    collapsed.push(entry);
  }
  return collapsed.slice(-max);
}

/** Truncate text to fit within a max width, adding … if cut. */
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  const single = text.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "…";
}

/**
 * Wrap text into lines of at most `max` chars, preserving explicit
 * newlines from the source.
 */
export function wrapText(text: string, max: number): string[] {
  if (max < 1) return [text];
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      out.push("");
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = "";
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= max) {
        line += " " + word;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line.length > 0) out.push(line);
  }
  return out.length > 0 ? out : [""];
}

function inferTag(entry: ActivityEntry): string {
  if (entry.tag) return entry.tag;

  const t = entry.type;
  const text = entry.text ?? "";
  const lower = text.toLowerCase();

  if (t === "agent.response") return "LiTT";
  if (t === "agent.thinking" || t === "agent.request") return "THINK";
  if (t === "agent.chat") return "CHAT";
  if (t === "agent.delta") return "│";
  if (t === "agent.complete") return "DONE";
  if (t === "agent.stopped") return "STOP";

  if (t === "run.started") return "RUN";
  if (t === "run.completed") return "DONE";
  if (t === "run.failed") return "FAIL";

  if (t === "tool.started") {
    if (lower.includes("git")) return "GIT";
    if (lower.includes("vitest") || lower.includes("jest") || lower.includes("test")) return "TEST";
    if (lower.includes("build") && !lower.includes("rebuild")) return "BUILD";
    if (lower.includes("tsc") || lower.includes("typecheck") || lower.includes("lint")) return "VERIFY";
    if (lower.includes("search") || lower.includes("grep") || lower.includes("find")) return "SEARCH";
    if (lower.includes("read") || lower.includes("list") || lower.includes("glob")) return "READ";
    if (lower.includes("edit") || lower.includes("write") || lower.includes("replace") || lower.includes("patch")) return "EDIT";
    return "RUN";
  }
  if (t === "tool.stdout" || t === "tool.stderr") return "│";
  if (t === "tool.completed") return "PASS";
  if (t === "tool.failed" || t === "tool.timeout" || t === "tool.cancelled") return "FAIL";

  if (t.startsWith("mission.")) {
    if (t === "mission.step_started") return "STEP";
    if (t === "mission.step_passed") return "PASS";
    if (t === "mission.step_failed") return "FAIL";
    if (t === "mission.verifying") return "VERIFY";
    if (t === "mission.completed") return "DONE";
    if (t === "mission.failed") return "FAIL";
    return "MISSION";
  }

  if (t === "approval.required") return "APPROVAL";
  if (t === "approval.granted") return "PASS";
  if (t === "approval.denied") return "FAIL";

  if (t === "error") return "ERROR";
  if (t === "info") return "INFO";

  if (t === "model.changed" || t === "mode" || t === "credential.resolving" || t === "credential.ready" || t === "credential.denied") return "ROUTE";

  if (t === "verification.passed") return "PASS";
  if (t === "verification.failed") return "FAIL";

  return entry.tag ?? "·";
}

export interface ActivityStreamProps {
  entries: ActivityEntry[];
  /** Maximum number of activity rows to show. */
  maxEntries?: number;
  /** Content width (defaults to the terminal width). */
  width?: number;
  /** Expand every row that has a `fullText` payload. */
  details?: boolean;
  /** Compact mode: drop the border/header for narrow terminals. */
  compact?: boolean;
}

export function ActivityStream({
  entries,
  maxEntries = 4,
  width: widthProp,
  details = false,
  compact: compactProp,
}: ActivityStreamProps): React.ReactElement {
  const { stdout } = useStdout();
  const termWidth = widthProp ?? stdout?.columns ?? 80;
  const compact = compactProp ?? classifyWidth(termWidth) === "narrow";

  // Account for border (2) + horizontal padding (2) when not compact.
  const innerWidth = compact ? termWidth : Math.max(20, termWidth - 4);
  const prefixWidth = TIMESTAMP_WIDTH + GAP + TAG_WIDTH + 1 + 2 + 1; // time + gap + tag + space + indicator(2) + space
  const msgMax = Math.max(10, innerWidth - prefixWidth);

  const finalVisible = visibleEvents(entries, maxEntries);

  return (
    <Box flexDirection="column" borderStyle={compact ? undefined : "single"} borderColor={COLORS.brand} paddingX={compact ? 0 : 1}>
      {!compact && <Text bold color={COLORS.brand}>ACTIVITY</Text>}
      {finalVisible.length === 0 ? (
        <Text dimColor> No activity yet — ask LiTT something.</Text>
      ) : (
        finalVisible.map((entry) => {
          const tag = inferTag(entry).padEnd(TAG_WIDTH);
          const color = activityColor(tag.trim());
          const time = formatTime(entry.ts);
          const hasDetails = !!entry.fullText && entry.fullText !== entry.text && entry.fullText.length > entry.text.length;
          const isStream = isStreamEntry(entry);
          const msg = truncate(entry.text, msgMax);
          const expanded = details && hasDetails;

          return (
            <Box key={entry.id} flexDirection="column">
              <Box>
                <Text dimColor>{time}{" ".repeat(GAP)}</Text>
                <Text color={color} bold={!isStream}>{tag}</Text>
                <Text dimColor> </Text>
                {hasDetails && (
                  <Text dimColor>{expanded ? "− " : "+ "}</Text>
                )}
                {!hasDetails && <Text dimColor>  </Text>}
                <Text color={color} dimColor={isStream || entry.type === "info"}>{msg}</Text>
              </Box>
              {expanded && (
                <Box flexDirection="column" marginLeft={prefixWidth}>
                  {wrapText(entry.fullText!, msgMax)
                    .slice(0, DETAIL_MAX_LINES)
                    .map((line, i) => (
                      <Text key={i} color={COLORS.secondary} dimColor>{line}</Text>
                    ))}
                  {wrapText(entry.fullText!, msgMax).length > DETAIL_MAX_LINES && (
                    <Text color={COLORS.secondary} dimColor>…</Text>
                  )}
                </Box>
              )}
            </Box>
          );
        })
      )}
    </Box>
  );
}
