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
import { redactSecrets } from "./activity-redact.js";
import { COLORS, activityColor } from "./colors.js";

import type { ActivityEntry, ActivitySemantic } from "./cockpit-store.js";

const TAG_WIDTH = 8;
const DETAIL_MAX_LINES = 8;

/** Whether the entry is a live stream delta. */
export function isStreamEntry(entry: ActivityEntry): boolean {
  return entry.type === "tool.stdout" || entry.type === "tool.stderr" || entry.type === "agent.delta";
}

/** Fixed-column metrics shared by the renderer and the height estimator —
 *  the budget math MUST match the render math or the fixed-height region
 *  overflows (the 100×30 line-collision bug). */
export interface ActivityFeedMetrics {
  /** Indent for expanded detail lines (aligns under the message column). */
  prefixWidth: number;
  /** Max chars per message/detail line. */
  msgMax: number;
}

export function activityFeedMetrics(termWidth: number): ActivityFeedMetrics {
  const innerWidth = Math.max(20, termWidth - 2);
  const prefixWidth = 2 + 1 + TAG_WIDTH + 1 + 1; // indent + glyph + tag + space + indicator col
  const msgMax = Math.max(10, innerWidth - prefixWidth);
  return { prefixWidth, msgMax };
}

/** Whether the entry carries a `fullText` payload richer than `text`. */
export function entryHasDetails(entry: ActivityEntry): boolean {
  return !!entry.fullText && entry.fullText !== entry.text && entry.fullText.length > entry.text.length;
}

/** Whether the entry renders expanded: global details flag or per-row id. */
export function isEntryExpanded(
  entry: ActivityEntry,
  details: boolean,
  expandedIds?: ReadonlySet<string>,
): boolean {
  return (details || expandedIds?.has(entry.id) === true) && entryHasDetails(entry);
}

/** Rendered row count for one feed entry (1 + expanded detail lines). */
export function estimateActivityEntryHeight(
  entry: ActivityEntry,
  metrics: ActivityFeedMetrics,
  details: boolean,
  expandedIds?: ReadonlySet<string>,
): number {
  if (!isEntryExpanded(entry, details, expandedIds)) return 1;
  const lines = wrapText(redactSecrets(entry.fullText!), metrics.msgMax).length;
  return 1 + Math.min(DETAIL_MAX_LINES, lines) + (lines > DETAIL_MAX_LINES ? 1 : 0);
}

export interface FittedActivityFeed {
  entries: ActivityEntry[];
  /** Rendered rows the picked entries occupy. */
  rows: number;
  /** Total rendered rows across the whole visible feed. */
  totalRows: number;
  /** Effective scroll offset applied (clamped to [0, maxScroll]). */
  scrollBack: number;
  /** Largest scrollBack that still shows the oldest entry. */
  maxScroll: number;
}

/**
 * Window of the visible feed that fits `maxRows` rendered rows.
 * `scrollBack` = rendered rows above the live tail (0 = newest).
 * Used by the shell to budget the live feed under the WorkstreamDock —
 * the dock is the compact summary, this is the detailed operator feed —
 * and by the scrollable activity-history overlay.
 *
 * Entries straddling a window edge are skipped rather than partially
 * rendered, so the picked set can never exceed maxRows rows.
 */
export function fitActivityFeed(
  entries: ActivityEntry[],
  maxRows: number,
  termWidth: number,
  details = false,
  expandedIds?: ReadonlySet<string>,
  scrollBack = 0,
): FittedActivityFeed {
  const empty: FittedActivityFeed = { entries: [], rows: 0, totalRows: 0, scrollBack: 0, maxScroll: 0 };
  if (maxRows < 1 || entries.length === 0) return empty;
  const metrics = activityFeedMetrics(termWidth);
  const visible = visibleEvents(entries, Math.min(entries.length, 80));
  const heights = visible.map((e) => estimateActivityEntryHeight(e, metrics, details, expandedIds));
  const totalRows = heights.reduce((a, b) => a + b, 0);
  const maxScroll = Math.max(0, totalRows - (heights[0] ?? 0));
  const back = Math.max(0, Math.min(scrollBack, maxScroll));
  const w1 = Math.max(0, totalRows - back);   // window bottom (exclusive)
  const w0 = Math.max(0, w1 - maxRows);       // window top

  const picked: ActivityEntry[] = [];
  let rows = 0;
  let acc = 0; // rendered rows at/below current entry (from the bottom)
  for (let i = visible.length - 1; i >= 0; i--) {
    const h = heights[i];
    const entryTop = totalRows - acc - h;
    const entryBottom = totalRows - acc;
    acc += h;
    if (entryTop < w0) break;                 // this and all older entries are above the window
    if (entryBottom <= w1) {                  // fully inside the window
      picked.unshift(visible[i]);
      rows += h;
    }
    // Entries straddling the bottom edge are skipped — the next scroll
    // step reveals them whole.
  }
  return { entries: picked, rows, totalRows, scrollBack: back, maxScroll };
}

/** Tags suppressed from the live feed — pure diagnostic noise that
 *  duplicates what the transcript already shows (the user message echo)
 *  or belongs in the optional debug view (/activity), not conversation. */
const HIDDEN_FEED_TAGS = new Set(["ROUTE", "CHAT"]);

/** Collapse consecutive stream deltas AND consecutive duplicate semantic
 *  entries (same text + tag), then keep the newest `max` events.
 *
 *  This is the SECOND deduplication layer (the first is the store's
 *  reconcileActivity by toolCallId/stepId). It catches duplicates the
 *  reconciler misses — e.g. the same logical action replayed with a
 *  different toolCallId on reconnect, or a mission step_started emitted
 *  twice with the same text but different ids. Without this, the feed
 *  shows "Inspecting / Inspecting" — the exact bug the user reported. */
export function visibleEvents(entries: ActivityEntry[], max: number): ActivityEntry[] {
  const collapsed: ActivityEntry[] = [];
  // Look back far enough that collapsing doesn't drop real events.
  const raw = entries.slice(-Math.max(max * 3, max));
  for (const entry of raw) {
    // Noise gate: routing chatter and the user-message echo never render
    // in the live feed. They remain in the log for /activity debugging.
    if (HIDDEN_FEED_TAGS.has(inferTag(entry))) continue;
    const prev = collapsed.length > 0 ? collapsed[collapsed.length - 1] : null;
    // Collapse consecutive stream deltas into the newest
    if (isStreamEntry(entry) && prev && isStreamEntry(prev)) {
      collapsed[collapsed.length - 1] = entry;
      continue;
    }
    // Collapse consecutive duplicate semantic entries (same text + tag).
    // This kills "Inspecting / Inspecting" without dropping distinct
    // events that happen to share a tag (e.g. two different READ calls).
    if (prev && !isStreamEntry(entry) && !isStreamEntry(prev)
        && prev.text === entry.text
        && (prev.tag ?? "") === (entry.tag ?? "")) {
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
      if (word.length > max) {
        // Hard-break unbroken runs (paths, minified output, base64) so the
        // rendered row count matches estimateActivityEntryHeight.
        if (line.length > 0) {
          out.push(line);
          line = "";
        }
        for (let i = 0; i < word.length; i += max) out.push(word.slice(i, i + max));
        continue;
      }
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

/** Tiny-vocabulary glyphs — the canonical map (re-exported via
 *  shell/transcript.tsx for back-compat). */
export const SEMANTIC_GLYPH: Record<ActivitySemantic, { glyph: string; color: string }> = {
  working: { glyph: "→", color: COLORS.working },
  success: { glyph: "✓", color: COLORS.success },
  warning: { glyph: "!", color: COLORS.warning },
  failed: { glyph: "×", color: COLORS.error },
  decision: { glyph: "◆", color: COLORS.brand },
};

/** Derive the semantic class from the entry when not explicitly set.
 *  Plan-mode denials are DECISIONS, not failures — the policy did its job. */
export function semanticOf(entry: ActivityEntry): ActivitySemantic {
  if (entry.semantic) return entry.semantic;
  if (/^PLAN mode rejects/i.test(entry.text)) return "decision";
  switch (entry.type) {
    case "run.completed":
    case "tool.completed":
    case "mission.step_passed":
    case "mission.completed":
    case "verification.passed":
    case "agent.complete":
    case "approval.granted":
      return "success";
    case "run.failed":
    case "tool.failed":
    case "mission.step_failed":
    case "mission.failed":
    case "verification.failed":
    case "agent.stopped":
    case "approval.denied":
    case "error":
      return "failed";
    case "tool.timeout":
    case "approval.required":
      return "warning";
    case "model.changed":
    case "mode":
      return "decision";
    default:
      return "working";
  }
}

/** Semantic glyph + color for a feed row:
 *  → working  ✓ success  ! warning  × failed  ◆ decision */
export function semanticGlyphOf(entry: ActivityEntry): { glyph: string; color: string } {
  return SEMANTIC_GLYPH[semanticOf(entry)];
}

export function inferTag(entry: ActivityEntry): string {
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
  /** Per-row expansion — ids toggled individually (Ctrl+G on latest). */
  expandedIds?: ReadonlySet<string>;
  /** Compact mode: drop the border/header for narrow terminals. */
  compact?: boolean;
}

export interface ActivityFeedRowProps {
  entry: ActivityEntry;
  metrics: ActivityFeedMetrics;
  /** Expand every row that has a `fullText` payload. */
  details?: boolean;
  /** Per-row expansion — ids toggled individually (Ctrl+G on latest). */
  expandedIds?: ReadonlySet<string>;
}

/** One feed row — shared by ActivityStream (live tail) and the
 *  scrollable activity history overlay. Render math lives ONLY here. */
export function ActivityFeedRow({ entry, metrics, details = false, expandedIds }: ActivityFeedRowProps): React.ReactElement {
  const tag = inferTag(entry).padEnd(TAG_WIDTH);
  const color = activityColor(tag.trim());
  const semantic = semanticGlyphOf(entry);
  const hasDetails = entryHasDetails(entry);
  const isStream = isStreamEntry(entry);
  const msg = truncate(redactSecrets(entry.text), metrics.msgMax);
  const expanded = isEntryExpanded(entry, details, expandedIds);
  const detailLines = expanded ? wrapText(redactSecrets(entry.fullText!), metrics.msgMax) : [];

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>{"  "}</Text>
        <Text color={semantic.color}>{semantic.glyph} </Text>
        <Text color={color} bold={!isStream}>{tag}</Text>
        <Text dimColor> </Text>
        {hasDetails && (
          <Text dimColor>{expanded ? "− " : "+ "}</Text>
        )}
        {!hasDetails && <Text dimColor>  </Text>}
        <Text color={color} dimColor={isStream}>{msg}</Text>
      </Box>
      {expanded && (
        <Box flexDirection="column" marginLeft={metrics.prefixWidth}>
          {detailLines
            .slice(0, DETAIL_MAX_LINES)
            .map((line, i) => (
              <Text key={i} color={COLORS.secondary}>{line}</Text>
            ))}
          {detailLines.length > DETAIL_MAX_LINES && (
            <Text color={COLORS.secondary}>…</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ActivityStream({
  entries,
  maxEntries = 4,
  width: widthProp,
  details = false,
  expandedIds,
}: ActivityStreamProps): React.ReactElement {
  const { stdout } = useStdout();
  const termWidth = widthProp ?? stdout?.columns ?? 80;
  const metrics = activityFeedMetrics(termWidth);

  const finalVisible = visibleEvents(entries, maxEntries);

  return (
    <Box flexDirection="column">
      {finalVisible.length === 0 ? (
        <Text dimColor>{"  "}…working</Text>
      ) : (
        finalVisible.map((entry) => (
          <ActivityFeedRow
            key={entry.id}
            entry={entry}
            metrics={metrics}
            details={details}
            expandedIds={expandedIds}
          />
        ))
      )}
    </Box>
  );
}
