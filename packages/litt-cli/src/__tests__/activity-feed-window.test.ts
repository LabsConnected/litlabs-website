/**
 * fitActivityFeed — the row-budgeted window used by BOTH the live feed
 * under WorkstreamDock (scrollBack=0) and the /activity history overlay.
 * Contract: picked entries never exceed maxRows rendered rows; window
 * edges cut on entry boundaries; scrollBack clamps to reachable history.
 */

import { describe, it, expect } from "vitest";
import {
  fitActivityFeed,
  estimateActivityEntryHeight,
  activityFeedMetrics,
  isEntryExpanded,
} from "../ink/activity-stream.js";
import type { ActivityEntry } from "../ink/cockpit-store.js";

function entry(id: string, text = `msg ${id}`, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  return { id, ts: 0, type: "tool.completed", tag: "RUN", text, ...extra };
}

const WIDTH = 100;
const METRICS = activityFeedMetrics(WIDTH);

describe("fitActivityFeed — live tail (scrollBack=0)", () => {
  it("returns the newest suffix that fits maxRows", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`));
    const fit = fitActivityFeed(entries, 4, WIDTH);
    expect(fit.entries.map((e) => e.id)).toEqual(["e6", "e7", "e8", "e9"]);
    expect(fit.rows).toBe(4);
    expect(fit.scrollBack).toBe(0);
    expect(fit.maxScroll).toBe(9); // totalRows(10) - first entry height(1)
  });

  it("empty input returns an empty window", () => {
    expect(fitActivityFeed([], 5, WIDTH).entries).toEqual([]);
    expect(fitActivityFeed([entry("a")], 0, WIDTH).entries).toEqual([]);
  });
});

describe("fitActivityFeed — scrolled window", () => {
  it("scrollBack shifts the window toward older entries", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`));
    const fit = fitActivityFeed(entries, 4, WIDTH, false, undefined, 3);
    // Window = rows [10-3-4, 10-3) = [3,7) → e3..e6
    expect(fit.entries.map((e) => e.id)).toEqual(["e3", "e4", "e5", "e6"]);
    expect(fit.scrollBack).toBe(3);
  });

  it("clamps scrollBack to maxScroll (oldest entry stays reachable)", () => {
    const entries = Array.from({ length: 10 }, (_, i) => entry(`e${i}`));
    const fit = fitActivityFeed(entries, 4, WIDTH, false, undefined, 999);
    expect(fit.scrollBack).toBe(fit.maxScroll);
    expect(fit.entries[0]?.id).toBe("e0");
  });

  it("window never exceeds maxRows even with mixed entry heights", () => {
    // e1 carries a fullText that wraps to several detail lines when expanded.
    const long = "x".repeat(METRICS.msgMax * 4);
    const entries = [
      entry("a"),
      entry("b", "short", { fullText: long }),
      ...Array.from({ length: 8 }, (_, i) => entry(`c${i}`)),
    ];
    const fit = fitActivityFeed(entries, 6, WIDTH, true);
    expect(fit.rows).toBeLessThanOrEqual(6);
    // The tall expanded entry may be skipped at a window edge — that's
    // the contract (no partial renders, no overflow).
  });
});

describe("estimateActivityEntryHeight / isEntryExpanded", () => {
  it("collapsed entries are 1 row; expanded add capped detail lines", () => {
    const long = "y".repeat(METRICS.msgMax * 20);
    const e = entry("x", "sum", { fullText: long });
    expect(isEntryExpanded(e, false)).toBe(false);
    expect(estimateActivityEntryHeight(e, METRICS, false)).toBe(1);
    expect(isEntryExpanded(e, true)).toBe(true);
    const h = estimateActivityEntryHeight(e, METRICS, true);
    expect(h).toBe(1 + 8 + 1); // 1 row + DETAIL_MAX_LINES + overflow marker
  });

  it("per-row expandedIds expand only matching entries", () => {
    const a = entry("a", "sum", { fullText: "detail-a" });
    const b = entry("b", "sum", { fullText: "detail-b" });
    const ids = new Set(["a"]);
    expect(isEntryExpanded(a, false, ids)).toBe(true);
    expect(isEntryExpanded(b, false, ids)).toBe(false);
  });
});
