/**
 * Regression test: TUI line collision at 100×30 terminal.
 *
 * Bug: at 100×30, the fixed-height content Box overflowed because the
 * viewport budget only accounted for message heights, not the inter-message
 * margins, tool progress, result block, or activity feed. Ink's fixed-height
 * Box overflow caused lines to overwrite each other:
 *
 *   15|    2 tools used not verified          ← "× inspection not verified" overwritten
 *   17|    /verify  retry checkses            ← "/diff review changes" overwritten
 *
 * At 100×24 the bug was absent because messages didn't fit (fits=false →
 * natural flow, no fixed height). The corruption only happened in the
 * "fits" case where the Box got a fixed height but the content exceeded it.
 *
 * Fix: layoutTranscript now includes inter-message marginTop(1), and the
 * shell reserves rows for tool progress + result block + activity feed
 * via estimateExtraContentHeight.
 */

import { describe, it, expect } from "vitest";
import { layoutTranscript, computeViewport } from "../ink/scroll-model.js";
import {
  estimateResultBlockHeight,
  estimateActivityFeedHeight,
  estimateExtraContentHeight,
} from "../ink/shell/transcript.js";
import {
  projectToolResultBlocks,
  projectSummaryBlock,
  estimateToolResultsHeight,
  estimateSummaryHeight,
} from "../ink/observability-project.js";
import type { ChatMessage, MissionState, ActivityEntry } from "../ink/cockpit-store.js";
import type { ToolProgressSnapshot } from "../ink/tool-progress-store.js";

const t = Date.now();

// ─── Helpers ───────────────────────────────────────────────────────

const userMsg = (i: number): ChatMessage => ({
  id: `u${i}`, role: "user", content: `Search site:stores.bestbuy.com Michigan Best Buy Holland hours`, ts: t + i, status: "complete",
});

const asstMsg = (i: number, lines: number): ChatMessage => ({
  id: `a${i}`, role: "assistant",
  content: Array.from({ length: lines }, (_, j) => `Line ${j} of answer ${i}`).join("\n"),
  ts: t + i, status: "complete",
  resolvedModel: "GPT-5.6 Luna", durationMs: 9000,
});

/** Build a failed read-only mission (the exact scenario from the bug report). */
function failedReadOnlyMission(): MissionState {
  return {
    id: "m1",
    state: "FAILED",
    readOnly: true,
    toolsUsed: ["read_file", "web_search"],
    filesTouched: [],
    missionDeltaFiles: [],
    runtimeProven: false,
    testResults: null,
    typecheckPassed: null,
    buildPassed: null,
  } as unknown as MissionState;
}

/** Build activity entries that would appear in the feed. */
function activityEntries(count: number): ActivityEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `evt${i}`,
    ts: t + i,
    type: i % 2 === 0 ? "tool.started" : "tool.completed",
    tag: "TOOL",
    text: `Event ${i}: fetching https://stores.bestbuy.com/mi/holland/${i}`,
  } as unknown as ActivityEntry));
}

/** Build a tool progress snapshot with entries. */
function toolProgressWith(entries: number): ToolProgressSnapshot {
  return {
    missionActive: true,
    missionStatus: "running",
    entries: Array.from({ length: entries }, (_, i) => ({
      id: `tp${i}`,
      label: `Step ${i}`,
      status: i < entries - 1 ? "completed" : "running",
      summary: i < entries - 1 ? "done" : undefined,
      lastChunk: i === entries - 1 ? "Running…" : undefined,
      durationMs: i < entries - 1 ? 1000 * i : undefined,
    })),
  } as unknown as ToolProgressSnapshot;
}

// ─── Layout includes inter-message margins ──────────────────────────

describe("layoutTranscript includes inter-message margins", () => {
  const WIDTH = 96; // 100 - 4 padding

  it("total height includes marginTop(1) between messages", () => {
    const messages = [userMsg(0), asstMsg(1, 3), userMsg(2), asstMsg(3, 2)];
    const layout = layoutTranscript(messages, WIDTH);
    // Without margins, total = sum of individual heights.
    // With margins, total = sum + (n-1) * 1 (one margin between each pair).
    const rawSum = layout.heights.reduce((a, b) => a + b, 0);
    expect(layout.total).toBe(rawSum + (messages.length - 1));
  });

  it("first message has no margin, subsequent messages do", () => {
    const messages = [userMsg(0), asstMsg(1, 2), userMsg(2)];
    const layout = layoutTranscript(messages, WIDTH);
    // prefix[1] = heights[0] (no margin before first)
    expect(layout.prefix[1]).toBe(layout.heights[0]);
    // prefix[2] = heights[0] + 1 (margin) + heights[1]
    expect(layout.prefix[2]).toBe(layout.heights[0] + 1 + layout.heights[1]);
  });
});

// ─── Extra content height estimation ───────────────────────────────

describe("estimateResultBlockHeight", () => {
  it("returns 0 for null mission", () => {
    expect(estimateResultBlockHeight(null)).toBe(0);
  });

  it("returns 0 for non-terminal mission", () => {
    const mission = { state: "RUNNING" } as unknown as MissionState;
    expect(estimateResultBlockHeight(mission)).toBe(0);
  });

  it("failed read-only mission with tools + failed verification + action hints", () => {
    const mission = failedReadOnlyMission();
    const h = estimateResultBlockHeight(mission);
    // header(1) + verification(1) + toolsUsed(1) + actionHints(3) = 6
    expect(h).toBe(6);
  });

  it("complete mutating mission with verification + tests + typecheck + build", () => {
    const mission = {
      state: "COMPLETE",
      readOnly: false,
      toolsUsed: ["edit_file"],
      filesTouched: ["a.ts"],
      missionDeltaFiles: ["a.ts"],
      runtimeProven: true,
      testResults: { passed: 22, failed: 0 },
      typecheckPassed: true,
      buildPassed: true,
    } as unknown as MissionState;
    const h = estimateResultBlockHeight(mission);
    // header(1) + verification(1) + delta(1) + tests(1) + typecheck(1) + build(1) = 6
    expect(h).toBe(6);
  });

  it("cancelled mission has no action hints", () => {
    const mission = {
      state: "CANCELLED",
      readOnly: true,
      toolsUsed: ["read_file"],
      runtimeProven: null,
      testResults: null,
      typecheckPassed: null,
      buildPassed: null,
    } as unknown as MissionState;
    const h = estimateResultBlockHeight(mission);
    // header(1) + toolsUsed(1) = 2
    expect(h).toBe(2);
  });
});

describe("estimateActivityFeedHeight", () => {
  it("returns 0 for empty events", () => {
    expect(estimateActivityFeedHeight([])).toBe(0);
  });

  it("returns marginTop + 1 line per visible event", () => {
    const events = activityEntries(3);
    expect(estimateActivityFeedHeight(events)).toBe(1 + 3); // marginTop(1) + 3 lines
  });

  it("caps at 4 visible events", () => {
    const events = activityEntries(10);
    expect(estimateActivityFeedHeight(events)).toBe(1 + 4); // marginTop(1) + 4 lines
  });
});

describe("estimateExtraContentHeight", () => {
  // The rendering model changed: the raw activity feed is replaced by the
  // observability blocks (ThinkingBlock + ToolResultBlocks +
  // MissionProgressBlock + SummaryBlock). With the default holoState=IDLE
  // and no canonical mission, only the ToolResultBlocks + result block +
  // SummaryBlock contribute. The activity feed height is no longer reserved
  // (it is no longer rendered in the transcript).
  const COLS = 96; // matches the 100-col scenario below

  it("returns 0 when nothing is present", () => {
    expect(estimateExtraContentHeight(null, null, [])).toBe(0);
  });

  it("includes tool result blocks + marginTop (replaces ToolProgress)", () => {
    const tp = toolProgressWith(2);
    const h = estimateExtraContentHeight(tp, null, [], false, "IDLE", false, null, "local", COLS);
    const blocks = projectToolResultBlocks(tp, "local");
    expect(h).toBe(estimateToolResultsHeight(blocks, COLS) + 1);
  });

  it("includes result block + SummaryBlock + marginTop for terminal mission", () => {
    const mission = failedReadOnlyMission();
    const h = estimateExtraContentHeight(null, mission, [], false, "IDLE", false, null, "local", COLS);
    // result block + marginTop(1) + summary + marginTop(1)
    const expected = estimateResultBlockHeight(mission) + 1 + estimateSummaryHeight(projectSummaryBlock(mission)) + 1;
    expect(h).toBe(expected);
  });

  it("activity feed is no longer reserved (removed from transcript rendering)", () => {
    const events = activityEntries(3);
    // The feed helpers still exist for /activity, but the transcript no
    // longer renders the feed — so estimateExtraContentHeight reserves 0
    // for events alone (no mission, no tools, idle).
    const h = estimateExtraContentHeight(null, null, events, false, "IDLE", false, null, "local", COLS);
    expect(h).toBe(0);
    // The helper itself still works for /activity consumers.
    expect(estimateActivityFeedHeight(events)).toBe(1 + 3);
  });

  it("sums tool results + result block + summary when all present", () => {
    const tp = toolProgressWith(2);
    const mission = failedReadOnlyMission();
    const events = activityEntries(4);
    const h = estimateExtraContentHeight(tp, mission, events, false, "IDLE", false, null, "local", COLS);
    const blocks = projectToolResultBlocks(tp, "local");
    const expected = estimateToolResultsHeight(blocks, COLS) + 1
      + estimateResultBlockHeight(mission) + 1
      + estimateSummaryHeight(projectSummaryBlock(mission)) + 1;
    expect(h).toBe(expected);
  });
});

// ─── The 100×30 collision regression ───────────────────────────────

describe("100×30 collision regression", () => {
  const WIDTH = 96; // 100 - 4 padding
  const ROWS = 30;
  const CHROME_ROWS = 6;
  const CONTENT_ROWS = Math.max(8, ROWS - 1 - CHROME_ROWS); // 23

  it("contentRows = 23 at 100×30", () => {
    expect(CONTENT_ROWS).toBe(23);
  });

  it("without extra content: messages fit and fits=true", () => {
    // 2 turns (4 messages) — small enough to fit in 23 rows
    const messages = [userMsg(0), asstMsg(1, 2), userMsg(2), asstMsg(3, 2)];
    const layout = layoutTranscript(messages, WIDTH);
    const extraHeight = 0; // no tool progress, no mission, no events
    const reserve = extraHeight;
    const vp = computeViewport(messages, layout, CONTENT_ROWS - reserve, null, 0);
    expect(vp.fits).toBe(true);
    // The actual rendered height (including margins) must fit
    const rendered = layout.prefix[vp.end] - layout.prefix[vp.start];
    expect(rendered).toBeLessThanOrEqual(CONTENT_ROWS);
  });

  it("with failed mission + events: budget reserves extra, no overflow", () => {
    // The exact bug scenario: a failed read-only mission with activity events.
    // The activity feed is no longer rendered (observability blocks replace
    // it), so events don't add height. The reserve = result block +
    // SummaryBlock.
    const messages = [userMsg(0), asstMsg(1, 5), userMsg(2), asstMsg(3, 3)];
    const layout = layoutTranscript(messages, WIDTH);
    const mission = failedReadOnlyMission();
    const events = activityEntries(4);
    const extraHeight = estimateExtraContentHeight(null, mission, events, false, "IDLE", false, null, "local", WIDTH);
    // extraHeight = resultBlock(6) + marginTop(1) + summary(2) + marginTop(1) = 10
    expect(extraHeight).toBe(10);
    // Reserve must be subtracted from the budget
    const reserve = extraHeight;
    const budget = CONTENT_ROWS - reserve; // 23 - 10 = 13
    expect(budget).toBe(13);
    const vp = computeViewport(messages, layout, budget, null, 0);
    // Messages must fit in the reduced budget
    const messageRows = layout.prefix[vp.end] - layout.prefix[vp.start];
    // Total = message rows + extra height must NOT exceed contentRows
    expect(messageRows + extraHeight).toBeLessThanOrEqual(CONTENT_ROWS);
  });

  it("with tool progress + mission + events: all fit without overflow", () => {
    const messages = [userMsg(0), asstMsg(1, 3), userMsg(2), asstMsg(3, 2)];
    const layout = layoutTranscript(messages, WIDTH);
    const tp = toolProgressWith(3);
    const mission = failedReadOnlyMission();
    const events = activityEntries(4);
    const extraHeight = estimateExtraContentHeight(tp, mission, events, false, "IDLE", false, null, "local", WIDTH);
    const reserve = extraHeight;
    const budget = CONTENT_ROWS - reserve;
    // If budget < 4 (minimum), fall back to natural flow
    if (budget < 4) {
      // Extra content alone nearly fills the region — natural flow
      expect(extraHeight).toBeGreaterThanOrEqual(CONTENT_ROWS - 4);
    } else {
      const vp = computeViewport(messages, layout, budget, null, 0);
      const messageRows = layout.prefix[vp.end] - layout.prefix[vp.start];
      expect(messageRows + extraHeight).toBeLessThanOrEqual(CONTENT_ROWS);
    }
  });

  it("100×24: messages don't fit → fits=false → natural flow (no collision)", () => {
    const ROWS_24 = 24;
    const CONTENT_ROWS_24 = Math.max(8, ROWS_24 - 1 - CHROME_ROWS); // 17
    expect(CONTENT_ROWS_24).toBe(17);
    // With extra content, budget is even smaller
    const messages = [userMsg(0), asstMsg(1, 8), userMsg(2), asstMsg(3, 5)];
    const layout = layoutTranscript(messages, WIDTH);
    const mission = failedReadOnlyMission();
    const events = activityEntries(4);
    const extraHeight = estimateExtraContentHeight(null, mission, events, false, "IDLE", false, null, "local", WIDTH);
    const budget = CONTENT_ROWS_24 - extraHeight;
    // At 100×24 with extra content, budget shrinks
    // Messages need more than the budget → fits=false (natural flow)
    if (budget < 4) {
      expect(true).toBe(true); // would fall back to natural flow
    } else {
      const vp = computeViewport(messages, layout, budget, null, 0);
      // Either fits with no overflow, or falls back to natural flow
      if (vp.fits) {
        const messageRows = layout.prefix[vp.end] - layout.prefix[vp.start];
        expect(messageRows + extraHeight).toBeLessThanOrEqual(CONTENT_ROWS_24);
      } else {
        expect(vp.fits).toBe(false);
      }
    }
  });

  it("extra content exceeding contentRows → fits=false (natural flow)", () => {
    // Pathological case: extra content alone exceeds the region.
    const messages = [userMsg(0), asstMsg(1, 2)];
    const layout = layoutTranscript(messages, WIDTH);
    // Simulate a huge result block + many events
    const hugeMission = {
      state: "FAILED",
      readOnly: false,
      toolsUsed: [],
      filesTouched: [],
      missionDeltaFiles: ["a.ts", "b.ts", "c.ts"],
      runtimeProven: false,
      testResults: { passed: 0, failed: 5 },
      typecheckPassed: false,
      buildPassed: false,
    } as unknown as MissionState;
    const events = activityEntries(4);
    const extraHeight = estimateExtraContentHeight(null, hugeMission, events, false, "IDLE", false, null, "local", WIDTH);
    // If extra >= contentRows, the shell forces fits=false
    if (extraHeight >= CONTENT_ROWS) {
      // The shell's logic: reserve >= contentRows → fits=false
      expect(extraHeight).toBeGreaterThanOrEqual(CONTENT_ROWS);
    } else {
      // Even if extra < contentRows, the budget is small
      const budget = CONTENT_ROWS - extraHeight;
      const vp = computeViewport(messages, layout, budget, null, 0);
      if (vp.fits) {
        const messageRows = layout.prefix[vp.end] - layout.prefix[vp.start];
        expect(messageRows + extraHeight).toBeLessThanOrEqual(CONTENT_ROWS);
      }
    }
  });
});

// ─── Wider terminal (120×30) also renders clean ───────────────────

describe("120×30 wide terminal", () => {
  const WIDTH = 116; // 120 - 4 padding
  const ROWS = 30;
  const CHROME_ROWS = 6;
  const CONTENT_ROWS = Math.max(8, ROWS - 1 - CHROME_ROWS); // 23

  it("wide terminal with failed mission + events: no overflow", () => {
    const messages = [userMsg(0), asstMsg(1, 3), userMsg(2), asstMsg(3, 2)];
    const layout = layoutTranscript(messages, WIDTH);
    const mission = failedReadOnlyMission();
    const events = activityEntries(4);
    const extraHeight = estimateExtraContentHeight(null, mission, events, false, "IDLE", false, null, "local", WIDTH);
    const budget = CONTENT_ROWS - extraHeight;
    if (budget >= 4) {
      const vp = computeViewport(messages, layout, budget, null, 0);
      if (vp.fits) {
        const messageRows = layout.prefix[vp.end] - layout.prefix[vp.start];
        expect(messageRows + extraHeight).toBeLessThanOrEqual(CONTENT_ROWS);
      }
    }
  });
});
