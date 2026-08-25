/**
 * Transcript scroll model — separates LOGICAL transcript, VIEWPORT
 * rendering, and SCROLL POSITION (dogfood P0).
 *
 *   - The logical transcript lives in the CockpitStore / ChatTranscriptStore.
 *     It is NEVER mutated because content no longer fits on screen.
 *   - The viewport renders only the slice of messages that fits the
 *     fixed content region (the composer/status never move).
 *   - The scroll position is a message anchor: the index of the top
 *     visible message. `null` = LIVE mode (auto-follow the newest).
 *
 * Live mode: the largest suffix of messages that fits the region —
 * streaming automatically follows the bottom.
 * Scrolled mode: a fixed anchor; as new messages arrive below, the
 * viewport stays put and the "↓ N new" indicator grows. End returns to
 * live. When the viewport naturally reaches the newest content, the
 * caller returns to live mode (auto-follow resumes).
 *
 * Paging (PgUp/PgDn) moves the anchor by a page of messages; the page
 * size is set by the shell from the live-mode visible count.
 */

import type { ChatMessage } from "./cockpit-store.js";
import { estimateMessageHeight } from "./chat-transcript.js";

/** Rows reserved for the scroll indicator in scrolled mode. */
export const SCROLL_INDICATOR_ROWS = 2;

export interface TranscriptLayout {
  /** Rendered height (rows) of each message. */
  heights: number[];
  /** prefix[i] = total rows of messages[0..i-1]. */
  prefix: number[];
  /** Total rendered rows of the whole transcript. */
  total: number;
}

export function layoutTranscript(messages: ChatMessage[], width: number): TranscriptLayout {
  const heights = messages.map((m) => estimateMessageHeight(m, width));
  const prefix: number[] = [0];
  for (let i = 0; i < heights.length; i++) {
    // Each message after the first has marginTop={1} in TranscriptArea.
    // Include it so the budget accurately reflects the rendered height.
    const margin = i > 0 ? 1 : 0;
    prefix.push(prefix[prefix.length - 1] + heights[i] + margin);
  }
  return { heights, prefix, total: prefix[prefix.length - 1] ?? 0 };
}

export interface ViewportResult {
  /** Index of the first visible message. */
  start: number;
  /** Index after the last visible message (exclusive). */
  end: number;
  /** True when the viewport reaches the newest content (live). */
  atBottom: boolean;
  /** True when older messages exist above the viewport. */
  hasAbove: boolean;
  /** Messages hidden below the viewport (0 when atBottom). */
  belowCount: number;
  /** False when a single message is taller than the region (natural flow). */
  fits: boolean;
}

/**
 * Compute the viewport slice for the region.
 *
 * @param anchor  index of the top visible message, or null for live.
 * @param reserveRows rows to keep free (scroll indicator) in scrolled mode.
 */
export function computeViewport(
  messages: ChatMessage[],
  layout: TranscriptLayout,
  regionHeight: number,
  anchor: number | null,
  reserveRows = 0,
): ViewportResult {
  const n = messages.length;
  if (n === 0) {
    return { start: 0, end: 0, atBottom: true, hasAbove: false, belowCount: 0, fits: true };
  }

  const budget = Math.max(4, regionHeight - (anchor === null ? 0 : reserveRows));

  if (anchor === null) {
    // LIVE — the largest suffix that fits.
    let start = n;
    while (start > 0 && layout.total - layout.prefix[start - 1] <= budget) start--;
    if (start === n) {
      // Even the newest message alone is taller than the region.
      return { start: n - 1, end: n, atBottom: true, hasAbove: false, belowCount: 0, fits: false };
    }
    return { start, end: n, atBottom: true, hasAbove: start > 0, belowCount: 0, fits: true };
  }

  // SCROLLED — greedy forward from the anchor.
  const start = Math.min(Math.max(0, anchor), n - 1);
  let end = start;
  while (end < n && layout.prefix[end + 1] - layout.prefix[start] <= budget) end++;
  if (end === start) {
    // The anchored message alone is taller than the region.
    return { start, end: start + 1, atBottom: false, hasAbove: start > 0, belowCount: n - (start + 1), fits: false };
  }
  const atBottom = end === n;
  return { start, end, atBottom, hasAbove: start > 0, belowCount: n - end, fits: true };
}

/**
 * PgUp — move the anchor up one page (toward the oldest content).
 * From live, anchor = the top of the live window.
 */
export function pageUpAnchor(
  anchor: number | null,
  messageCount: number,
  pageSize: number,
  liveStart: number,
): number {
  const base = anchor ?? liveStart;
  return Math.max(0, base - Math.max(1, pageSize));
}

/**
 * PgDn — move the anchor down one page (toward the newest content).
 * Returns null when the bottom is reached (return to live).
 */
export function pageDownAnchor(
  anchor: number | null,
  messageCount: number,
  pageSize: number,
): number | null {
  if (anchor === null) return null;
  const next = anchor + Math.max(1, pageSize);
  return next >= messageCount ? null : next;
}

/** Home — jump to the oldest content. */
export function homeAnchor(): number {
  return 0;
}

/** End — return to live (auto-follow). */
export function endAnchor(): null {
  return null;
}
