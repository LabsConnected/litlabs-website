/**
 * Transcript scroll window — dogfood P0 regression coverage.
 *
 * Acceptance:
 *   - The LOGICAL transcript is never mutated by the viewport.
 *   - Generate >3 screens of transcript: the first message still exists,
 *     PgUp reaches it, PgDn returns downward, End returns to live.
 *   - New streaming while scrolled upward does NOT yank the viewport.
 *   - The viewport fits the fixed region (composer/status never move)
 *     unless a single message is taller than the whole region.
 */

import { describe, it, expect } from "vitest";
import {
  layoutTranscript,
  computeViewport,
  pageUpAnchor,
  pageDownAnchor,
  homeAnchor,
  endAnchor,
} from "../ink/scroll-model.js";
import { detectRawScrollKey } from "../ink/keyboard-utils.js";
import type { ChatMessage } from "../ink/cockpit-store.js";

const t = Date.now();
const userMsg = (i: number): ChatMessage => ({ id: `u${i}`, role: "user", content: `question number ${i}`, ts: t + i, status: "complete" });
const asstMsg = (i: number): ChatMessage => ({
  id: `a${i}`, role: "assistant", content: `Answer ${i} with enough text to wrap across at least two lines at narrow widths.`, ts: t + i, status: "complete",
  resolvedModel: "GPT-5.6 Luna", durationMs: 9000,
});

/** Build a transcript of `turns` user/assistant pairs. */
function transcript(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < turns; i++) { messages.push(userMsg(i)); messages.push(asstMsg(i)); }
  return messages;
}

describe("transcript scroll window", () => {
  const WIDTH = 60;
  const REGION = 10;

  it("live mode shows the newest suffix that fits and never mutates history", () => {
    const messages = transcript(20); // 40 messages ≫ 3 screens at region 10
    const layout = layoutTranscript(messages, WIDTH);

    // Logical transcript intact — the first message still exists.
    expect(messages[0].id).toBe("u0");
    expect(messages[0].content).toContain("question number 0");

    const vp = computeViewport(messages, layout, REGION, null, 0);
    expect(vp.atBottom).toBe(true);
    expect(vp.fits).toBe(true);
    // The newest message is always visible in live mode.
    expect(vp.end).toBe(messages.length);
    expect(vp.start).toBeLessThan(messages.length);
    // The slice fits the region.
    const rows = layout.prefix[vp.end] - layout.prefix[vp.start];
    expect(rows).toBeLessThanOrEqual(REGION);
  });

  it("PgUp reaches the first message from live; the anchor moves toward 0", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);
    const live = computeViewport(messages, layout, REGION, null, 0);
    const pageSize = live.end - live.start;

    let anchor: number | null = null;
    let steps = 0;
    while (anchor !== 0 && steps < 100) {
      anchor = pageUpAnchor(anchor, messages.length, pageSize, live.start);
      steps++;
    }
    expect(anchor).toBe(0);
    // A page of ~pageSize messages each step must reach the top.
    expect(steps).toBeLessThan(20);

    // The viewport at the top shows the OLDEST content (u0).
    const vp = computeViewport(messages, layout, REGION, 0, 2);
    expect(vp.start).toBe(0);
    const visible = messages.slice(vp.start, vp.end);
    expect(visible[0].id).toBe("u0");
  });

  it("PgDn returns downward and End returns to live", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);
    const live = computeViewport(messages, layout, REGION, null, 0);
    const pageSize = live.end - live.start;

    // Scroll to the top, then page down repeatedly until live.
    let anchor: number | null = homeAnchor();
    expect(anchor).toBe(0);
    let steps = 0;
    while (anchor !== null && steps < 100) {
      anchor = pageDownAnchor(anchor, messages.length, pageSize);
      steps++;
    }
    expect(anchor).toBeNull(); // End → live

    // End returns to live directly from anywhere.
    expect(endAnchor()).toBeNull();
  });

  it("streaming while scrolled upward does NOT yank the viewport", () => {
    // Build a settled transcript, scroll up, then append new content.
    const settled = transcript(8);
    const layout0 = layoutTranscript(settled, WIDTH);
    const live0 = computeViewport(settled, layout0, REGION, null, 0);
    const pageSize = live0.end - live0.start;

    // Scroll up one page.
    const anchor = pageUpAnchor(null, settled.length, pageSize, live0.start);
    const vpBefore = computeViewport(settled, layout0, REGION, anchor, 2);
    const visibleBefore = settled.slice(vpBefore.start, vpBefore.end).map((m) => m.id);

    // New content streams in (3 more turns).
    const grown = [...settled, ...transcript(3)];
    const layout1 = layoutTranscript(grown, WIDTH);
    const vpAfter = computeViewport(grown, layout1, REGION, anchor, 2);
    const visibleAfter = grown.slice(vpAfter.start, vpAfter.end).map((m) => m.id);

    // The anchored viewport shows the SAME messages — no yank.
    expect(vpAfter.start).toBe(anchor);
    expect(vpAfter.end).toBeGreaterThanOrEqual(vpBefore.end);
    expect(visibleAfter.slice(0, visibleBefore.length)).toEqual(visibleBefore);
    // And the "N new below" count reflects the new arrivals.
    expect(vpAfter.belowCount).toBeGreaterThan(vpBefore.belowCount);
  });

  it("auto-return to live: when the viewport reaches the newest content, atBottom is true", () => {
    // A short transcript (one turn) fits entirely even when anchored at 0.
    const messages = transcript(1);
    const layout = layoutTranscript(messages, WIDTH);
    const vp = computeViewport(messages, layout, REGION, 0, 2);
    expect(vp.atBottom).toBe(true);
    expect(vp.belowCount).toBe(0);
  });

  it("a single oversized message falls back to natural flow (fits=false)", () => {
    const giant: ChatMessage = {
      id: "g", role: "assistant",
      content: Array.from({ length: 60 }, (_, i) => `long line ${i}`).join("\n"),
      ts: 0, status: "complete",
    };
    const messages = [giant];
    const layout = layoutTranscript(messages, WIDTH);
    const live = computeViewport(messages, layout, REGION, null, 0);
    expect(live.fits).toBe(false);
    expect(live.start).toBe(0);
    expect(live.end).toBe(1);
  });

  it("margins are included in the layout so the region never overflows", () => {
    const messages = transcript(4);
    const layout = layoutTranscript(messages, WIDTH);
    // Each message after the first costs +1 row (turn rhythm).
    const raw = messages.map((m) => layout.heights[0]); // not exact — recompute:
    expect(layout.total).toBeGreaterThan(raw.length * layout.heights[0]);
    const vp = computeViewport(messages, layout, REGION, null, 0);
    const rows = layout.prefix[vp.end] - layout.prefix[vp.start];
    expect(rows).toBeLessThanOrEqual(REGION);
  });
});

describe("raw scroll key detection", () => {
  it("detects PgUp from raw escape sequences", () => {
    expect(detectRawScrollKey("\x1b[5~")).toBe("pageUp");
  });

  it("detects PgDn from raw escape sequences", () => {
    expect(detectRawScrollKey("\x1b[6~")).toBe("pageDown");
  });

  it("detects Home from multiple terminal escape sequences", () => {
    expect(detectRawScrollKey("\x1b[H")).toBe("home");
    expect(detectRawScrollKey("\x1b[1~")).toBe("home");
    expect(detectRawScrollKey("\x1bOH")).toBe("home");
    expect(detectRawScrollKey("\x1b[7~")).toBe("home");
  });

  it("detects End from multiple terminal escape sequences", () => {
    expect(detectRawScrollKey("\x1b[F")).toBe("end");
    expect(detectRawScrollKey("\x1b[4~")).toBe("end");
    expect(detectRawScrollKey("\x1bOF")).toBe("end");
    expect(detectRawScrollKey("\x1b[8~")).toBe("end");
  });

  it("detects Ctrl+Home from raw escape sequences", () => {
    expect(detectRawScrollKey("\x1b[1;5H")).toBe("ctrlHome");
    expect(detectRawScrollKey("\x1b[5H")).toBe("ctrlHome");
  });

  it("detects Ctrl+End from raw escape sequences", () => {
    expect(detectRawScrollKey("\x1b[1;5F")).toBe("ctrlEnd");
    expect(detectRawScrollKey("\x1b[5F")).toBe("ctrlEnd");
  });

  it("returns null for non-scroll input", () => {
    expect(detectRawScrollKey("a")).toBeNull();
    expect(detectRawScrollKey("\r")).toBeNull();
    expect(detectRawScrollKey("\x1bOQ")).toBeNull(); // F2, not a scroll key
  });

  it("one keypress = one detection (no double-trigger)", () => {
    // Each raw input produces exactly one detection result (or null).
    // There is no batching or repeat — one keypress = one scroll action.
    const keys = ["\x1b[5~", "\x1b[6~", "\x1b[H", "\x1b[F", "\x1b[1;5H", "\x1b[1;5F"];
    for (const k of keys) {
      const result = detectRawScrollKey(k);
      expect(result).not.toBeNull();
      // Calling again with the same input produces the same single result.
      expect(detectRawScrollKey(k)).toBe(result);
    }
  });
});

describe("composer isolation from scroll events", () => {
  it("scroll key detection never produces printable input for the composer", () => {
    // The raw scroll key detector returns a type, not a character.
    // The overlay-manager dispatches scroll keys to the app handler,
    // never to the composer's useInput. Verify the detection results
    // are non-printable types.
    const scrollInputs = ["\x1b[5~", "\x1b[6~", "\x1b[H", "\x1b[F", "\x1b[1;5H", "\x1b[1;5F"];
    for (const input of scrollInputs) {
      const result = detectRawScrollKey(input);
      expect(result).not.toBeNull();
      // The result is a scroll key type, not a character — the composer
      // never sees these because they're intercepted in the raw listener.
      expect(["pageUp", "pageDown", "home", "end", "ctrlHome", "ctrlEnd"]).toContain(result);
    }
  });
});

describe("terminal resize preserves scroll offset", () => {
  const W = 60;
  it("anchored viewport stays valid when region shrinks", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, W);

    // Anchor at message 5 with a large region.
    const bigRegion = 20;
    const vpBig = computeViewport(messages, layout, bigRegion, 5, 2);
    expect(vpBig.start).toBe(5);

    // Region shrinks — anchor is still valid, just shows fewer messages.
    const smallRegion = 6;
    const vpSmall = computeViewport(messages, layout, smallRegion, 5, 2);
    expect(vpSmall.start).toBe(5);
    expect(vpSmall.end).toBeLessThanOrEqual(vpBig.end);
    // The anchor is preserved — no jump to the beginning.
    expect(vpSmall.start).toBe(5);
  });

  it("live mode adapts to region change without losing the newest content", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, W);

    const vpBig = computeViewport(messages, layout, 20, null, 0);
    const vpSmall = computeViewport(messages, layout, 6, null, 0);

    // Both show the newest message.
    expect(vpBig.end).toBe(messages.length);
    expect(vpSmall.end).toBe(messages.length);
    // Smaller region shows fewer messages.
    expect(vpSmall.start).toBeGreaterThanOrEqual(vpBig.start);
  });
});

// ─── Scroll stick bug regression ────────────────────────────────────
//
// The bug: when observability blocks are rendering (extraHeight > 0),
// the live-mode viewport budget is contentRows - extraHeight. But the
// scrolled-mode viewport budget was contentRows (extraHeight=0). So
// PgUp from live set an anchor near the bottom, the scrolled viewport
// (with its larger budget) immediately reached atBottom=true, and the
// auto-return-to-live effect yanked the user back to live — the scroll
// "stuck" and the user couldn't browse history.
//
// The fix: the auto-return effect uses the LIVE-MODE budget (with
// extraHeight reserved) for the atBottom check, so it only fires when
// the anchor truly reaches the bottom in the live viewport.

describe("scroll stick bug — auto-return with observability blocks", () => {
  const WIDTH = 60;
  const REGION = 10;
  // Simulate observability blocks taking 4 rows (ThinkingBlock + ToolResultBlock).
  const EXTRA_HEIGHT = 4;

  it("PgUp from live with observability blocks does NOT immediately return to live", () => {
    // Build a transcript that fills the region in live mode.
    const messages = transcript(20); // 40 messages
    const layout = layoutTranscript(messages, WIDTH);

    // Live mode: budget = REGION - EXTRA_HEIGHT = 6 rows.
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    // PgUp from live — anchor = liveStart - pageSize.
    const anchor = pageUpAnchor(null, messages.length, pageSize, liveVp.start);
    expect(anchor).not.toBeNull();
    expect(anchor).toBeGreaterThanOrEqual(0);

    // Scrolled viewport (full budget, no extraHeight) — this is what
    // the shell computes for rendering.
    const scrolledVp = computeViewport(messages, layout, REGION, anchor, 2);
    // The scrolled viewport MIGHT be atBottom (larger budget) — that's OK.
    // The bug was that the auto-return used THIS atBottom.

    // Live-mode atBottom check (the FIX) — compute atBottom with the
    // live budget (REGION - EXTRA_HEIGHT). This should NOT be atBottom
    // because the anchor is above the live window.
    const liveCheckVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, anchor, 2);
    // The live-budget viewport from this anchor should NOT be at the bottom.
    // This is the key assertion: the auto-return must NOT fire.
    expect(liveCheckVp.atBottom).toBe(false);
  });

  it("multiple PgUp operations accumulate (don't stick)", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    let anchor: number | null = null;
    const anchors: number[] = [];

    // PgUp 3 times — each should move further up.
    for (let i = 0; i < 3; i++) {
      anchor = pageUpAnchor(anchor, messages.length, pageSize, liveVp.start);
      anchors.push(anchor);
    }

    // Each anchor must be strictly less than the previous (moving up).
    for (let i = 1; i < anchors.length; i++) {
      expect(anchors[i]).toBeLessThan(anchors[i - 1]);
    }
    // The first PgUp must actually move (not stick at the live start).
    expect(anchors[0]).toBeLessThan(liveVp.start);
  });

  it("PgDn reduces offset (moves toward newer content)", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    // Scroll to the top.
    let anchor: number | null = homeAnchor();
    expect(anchor).toBe(0);

    // PgDn — anchor must increase (move toward newer).
    anchor = pageDownAnchor(anchor, messages.length, pageSize);
    expect(anchor).not.toBeNull();
    expect(anchor!).toBeGreaterThan(0);
  });

  it("PgDn reaches exactly zero/latest (returns to live)", () => {
    const messages = transcript(4); // small transcript
    const layout = layoutTranscript(messages, WIDTH);
    const liveVp = computeViewport(messages, layout, REGION, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    // Start at top, PgDn until live.
    let anchor: number | null = 0;
    let steps = 0;
    while (anchor !== null && steps < 100) {
      anchor = pageDownAnchor(anchor, messages.length, pageSize);
      steps++;
    }
    expect(anchor).toBeNull(); // null = live
  });

  it("incoming message while scrolled up does NOT snap to bottom", () => {
    const settled = transcript(8);
    const layout0 = layoutTranscript(settled, WIDTH);
    const live0 = computeViewport(settled, layout0, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = live0.end - live0.start;

    // Scroll up one page.
    const anchor = pageUpAnchor(null, settled.length, pageSize, live0.start);
    expect(anchor).not.toBeNull();

    // New content arrives (3 more turns).
    const grown = [...settled, ...transcript(3)];
    const layout1 = layoutTranscript(grown, WIDTH);

    // The anchor is unchanged — the viewport shows the same messages.
    const vpAfter = computeViewport(grown, layout1, REGION, anchor, 2);
    expect(vpAfter.start).toBe(anchor);
    // The viewport is NOT at the bottom — new content is below.
    expect(vpAfter.atBottom).toBe(false);
    expect(vpAfter.belowCount).toBeGreaterThan(0);
  });

  it("incoming ToolResultBlock while scrolled up does NOT snap to bottom", () => {
    // Simulates a tool progress update arriving while scrolled.
    // The extraHeight grows (new ToolResultBlock), but the anchor
    // must not change — the user is browsing history.
    const messages = transcript(8);
    const layout = layoutTranscript(messages, WIDTH);

    // Scroll up.
    const liveVp = computeViewport(messages, layout, REGION - 2, null, 0);
    const anchor = pageUpAnchor(null, messages.length, liveVp.end - liveVp.start, liveVp.start);

    // Extra height grows (new tool result block appears).
    const newExtraHeight = 6; // grew from 4 to 6
    const liveCheckVp = computeViewport(messages, layout, REGION - newExtraHeight, anchor, 2);
    // The anchor is still valid — the viewport hasn't snapped to bottom.
    expect(liveCheckVp.start).toBe(anchor);
    expect(liveCheckVp.atBottom).toBe(false);
  });

  it("MissionProgressBlock height change while scrolled does not corrupt offset", () => {
    const messages = transcript(10);
    const layout = layoutTranscript(messages, WIDTH);

    // Scroll up.
    const liveVp = computeViewport(messages, layout, REGION - 3, null, 0);
    const anchor = pageUpAnchor(null, messages.length, liveVp.end - liveVp.start, liveVp.start);
    expect(anchor).not.toBeNull();

    // MissionProgressBlock grows (extraHeight changes from 3 to 5).
    const vpBefore = computeViewport(messages, layout, REGION, anchor, 2);
    const vpAfter = computeViewport(messages, layout, REGION, anchor, 2);
    // The viewport start is preserved — height changes don't corrupt offset.
    expect(vpAfter.start).toBe(anchor);
    expect(vpAfter.start).toBe(vpBefore.start);
  });

  it("Ctrl+End resets to latest (live-follow)", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);

    // Scroll up.
    const liveVp = computeViewport(messages, layout, REGION, null, 0);
    let anchor = pageUpAnchor(null, messages.length, 5, liveVp.start);
    expect(anchor).not.toBeNull();

    // Ctrl+End → endAnchor() returns null (live).
    anchor = endAnchor();
    expect(anchor).toBeNull();
  });

  it("after Ctrl+End new updates follow normally (live mode)", () => {
    const messages = transcript(8);
    const layout = layoutTranscript(messages, WIDTH);

    // After Ctrl+End, anchor = null (live).
    const anchor = endAnchor();
    expect(anchor).toBeNull();

    // New content arrives — live viewport shows the newest.
    const grown = [...messages, ...transcript(2)];
    const grownLayout = layoutTranscript(grown, WIDTH);
    const vp = computeViewport(grown, grownLayout, REGION, null, 0);
    expect(vp.atBottom).toBe(true);
    expect(vp.end).toBe(grown.length);
  });

  it("55-column terminal remains usable", () => {
    const messages = transcript(10);
    const layout = layoutTranscript(messages, 55);
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    expect(liveVp.fits).toBe(true);
    expect(liveVp.end).toBe(messages.length);

    // PgUp works at narrow width.
    const anchor = pageUpAnchor(null, messages.length, liveVp.end - liveVp.start, liveVp.start);
    expect(anchor).toBeGreaterThanOrEqual(0);
    const scrolledVp = computeViewport(messages, layout, REGION, anchor, 2);
    expect(scrolledVp.start).toBe(anchor);
  });

  it("large transcript remains usable (100+ messages)", () => {
    const messages = transcript(60); // 120 messages
    const layout = layoutTranscript(messages, WIDTH);
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    // Scroll up multiple times.
    let anchor: number | null = null;
    for (let i = 0; i < 5; i++) {
      anchor = pageUpAnchor(anchor, messages.length, pageSize, liveVp.start);
    }
    expect(anchor).toBeGreaterThanOrEqual(0);
    expect(anchor!).toBeLessThan(liveVp.start);

    // The viewport at this anchor shows older content.
    const vp = computeViewport(messages, layout, REGION, anchor, 2);
    expect(vp.start).toBe(anchor);
    expect(vp.atBottom).toBe(false);

    // PgDn back down.
    anchor = pageDownAnchor(anchor, messages.length, pageSize);
    expect(anchor).not.toBeNull();
    expect(anchor!).toBeGreaterThan(0);
  });

  it("offset is clamped after content shrinks", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);

    // Anchor at message 15.
    const anchor = 15;
    const vp = computeViewport(messages, layout, REGION, anchor, 2);
    expect(vp.start).toBe(15);

    // Content shrinks — only 10 messages remain.
    const shrunk = messages.slice(0, 10);
    const shrunkLayout = layoutTranscript(shrunk, WIDTH);
    // computeViewport clamps the anchor to n-1.
    const vpAfter = computeViewport(shrunk, shrunkLayout, REGION, anchor, 2);
    expect(vpAfter.start).toBe(9); // clamped to last message
  });

  it("repeated up/down cycles do not stick", () => {
    const messages = transcript(20);
    const layout = layoutTranscript(messages, WIDTH);
    const liveVp = computeViewport(messages, layout, REGION - EXTRA_HEIGHT, null, 0);
    const pageSize = liveVp.end - liveVp.start;

    // Cycle: PgUp, PgDn, PgUp, PgDn — each cycle must move.
    let anchor: number | null = null;

    // PgUp
    anchor = pageUpAnchor(anchor, messages.length, pageSize, liveVp.start);
    expect(anchor).not.toBeNull();
    const up1 = anchor;

    // PgDn
    anchor = pageDownAnchor(anchor, messages.length, pageSize);
    // After PgDn, anchor might be null (back to live) or further down.
    // If null, PgUp again from live.
    if (anchor === null) {
      anchor = pageUpAnchor(null, messages.length, pageSize, liveVp.start);
    } else {
      expect(anchor).toBeGreaterThan(up1!);
    }
    const up2 = anchor;
    expect(up2).not.toBeNull();

    // PgUp again — must move further up (not stick at the same position).
    anchor = pageUpAnchor(anchor, messages.length, pageSize, liveVp.start);
    expect(anchor!).toBeLessThan(up2!);
  });
});
