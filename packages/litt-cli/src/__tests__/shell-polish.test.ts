/**
 * Shell polish pass — pure-function regression coverage.
 *
 * Covers the new typography/layout system:
 *   - wrapText / truncate / singleLine / shortModelName (text-wrap)
 *   - routingFooter — collapsed routing display (Model · seconds)
 *   - estimateMessageHeight — message sizing for the fixed region
 *   - fitContent — the bounded region keeps the composer stationary
 *   - MissionResultBlock logic is data-driven (header truth) via the
 *     summary helpers (ChangeSummary/VerificationSummary return null
 *     when no evidence exists — DONE is never invented).
 */

import { describe, it, expect } from "vitest";
import { wrapText, truncateTail, truncateHead, singleLine, shortModelName, CONTENT_MEASURE } from "../ink/text-wrap.js";
import { routingFooter, estimateMessageHeight } from "../ink/chat-transcript.js";
import { fitContent } from "../ink/shell/transcript.js";
import type { ChatMessage, ActivityEntry } from "../ink/cockpit-store.js";
import { ChangeSummary, VerificationSummary } from "../ink/shell/summary.js";

// ─── text-wrap ──────────────────────────────────────────────────────

describe("wrapText", () => {
  it("returns single line when it fits", () => {
    expect(wrapText("hello world", 40)).toEqual(["hello world"]);
  });

  it("word-wraps at the width", () => {
    expect(wrapText("one two three four", 8)).toEqual(["one two", "three", "four"]);
  });

  it("preserves explicit newlines", () => {
    expect(wrapText("line one\nline two", 40)).toEqual(["line one", "line two"]);
  });

  it("breaks long words (URLs/paths)", () => {
    const lines = wrapText("https://example.com/very/long/path", 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(12);
  });

  it("handles empty strings", () => {
    expect(wrapText("", 40)).toEqual([]);
  });

  it("clamps absurd widths to a sane minimum", () => {
    expect(wrapText("abc", 2)).toEqual(["abc"]);
  });
});

describe("truncate helpers", () => {
  it("truncateTail preserves the tail", () => {
    expect(truncateTail("feat/litt-terminal-runtime-ui", 18)).toBe("…" + "feat/litt-terminal-runtime-ui".slice(-17));
  });

  it("truncateHead preserves the head", () => {
    expect(truncateHead("very-long-model-name", 10)).toBe("very-long…");
  });

  it("singleLine collapses whitespace", () => {
    expect(singleLine("a\n  b\nc")).toBe("a b c");
  });
});

describe("shortModelName", () => {
  it("strips provider prefixes from ids", () => {
    expect(shortModelName("openai/gpt-5.6-luna")).toBe("GPT 5.6 Luna");
    expect(shortModelName("anthropic/claude-sonnet-4.6")).toBe("Claude Sonnet 4.6");
  });

  it("passes display labels through untouched", () => {
    expect(shortModelName("GPT-5.6 Luna")).toBe("GPT-5.6 Luna");
    expect(shortModelName("Claude Sonnet 5")).toBe("Claude Sonnet 5");
  });

  it("handles null/empty", () => {
    expect(shortModelName(null)).toBe("");
    expect(shortModelName(undefined)).toBe("");
  });
});

// ─── routingFooter — collapsed routing display ──────────────────────

describe("routingFooter", () => {
  const base: ChatMessage = {
    id: "1", role: "assistant", content: "ok", ts: 0, status: "complete",
    requestedModel: "LiTT Auto", resolvedModel: "GPT-5.6 Luna",
    servedModel: null, fallbackReason: null,
  };

  it("collapses to friendly model · seconds on complete turns", () => {
    const msg = { ...base, servedModel: "openai/gpt-5.6-luna", durationMs: 9000 };
    expect(routingFooter(msg)).toBe("GPT 5.6 Luna · 9.0s");
  });

  it("shows the model alone while streaming (no duration yet)", () => {
    const msg = { ...base, status: "streaming" as const };
    expect(routingFooter(msg)).toBe("GPT-5.6 Luna");
  });

  it("never shows REQUESTED → RESOLVED → SERVED in normal conversation", () => {
    const msg = { ...base, durationMs: 9000 };
    const footer = routingFooter(msg);
    expect(footer).not.toContain("REQUESTED");
    expect(footer).not.toContain("RESOLVED");
    expect(footer).not.toContain("SERVED");
  });

  it("error turns have no routing footer — the error text is the message", () => {
    const msg = { ...base, status: "error" as const, content: "Agent error" };
    expect(routingFooter(msg)).toBeNull();
  });

  it("falls back to resolved/requested labels when served is unknown", () => {
    const msg = { ...base, servedModel: null, durationMs: 500 };
    expect(routingFooter(msg)).toBe("GPT-5.6 Luna · 0.5s");
  });
});

// ─── estimateMessageHeight ──────────────────────────────────────────

describe("estimateMessageHeight", () => {
  it("user message: label + wrapped body lines", () => {
    const msg: ChatMessage = { id: "1", role: "user", content: "hello", ts: 0, status: "complete" };
    expect(estimateMessageHeight(msg, 40)).toBe(2);
  });

  it("assistant message: label + wrapped body + footer", () => {
    const msg: ChatMessage = {
      id: "1", role: "assistant", content: "line one\nline two", ts: 0, status: "complete",
      resolvedModel: "GPT-5.6 Luna", durationMs: 9000,
    };
    // label(1) + body(2) + footer(1)
    expect(estimateMessageHeight(msg, 40)).toBe(4);
  });

  it("multi-line body counts wrapped lines", () => {
    const msg: ChatMessage = {
      id: "1", role: "assistant",
      content: "a ".repeat(60) + "b ".repeat(60), // wraps at 40 → many lines
      ts: 0, status: "complete",
    };
    const wrapped = wrapText(msg.content, 40).length;
    expect(estimateMessageHeight(msg, 40)).toBe(1 + wrapped);
  });
});

// ─── fitContent — bounded region ────────────────────────────────────

describe("fitContent", () => {
  const userMsg = (i: number): ChatMessage => ({ id: `u${i}`, role: "user", content: `question ${i}`, ts: i, status: "complete" });
  const asstMsg = (i: number): ChatMessage => ({
    id: `a${i}`, role: "assistant", content: `answer ${i}`, ts: i, status: "complete",
    resolvedModel: "GPT-5.6 Luna", durationMs: 9000,
  });
  const event = (i: number): ActivityEntry => ({ id: `e${i}`, ts: i, type: "tool.completed", text: `check ${i}` });

  it("keeps the newest messages when the region is small", () => {
    const messages = [userMsg(0), asstMsg(0), userMsg(1), asstMsg(1), userMsg(2), asstMsg(2)];
    const fit = fitContent(messages, [], 8, 40);
    expect(fit.fits).toBe(true);
    expect(fit.messages.length).toBeLessThan(messages.length);
    // The newest message is always present.
    expect(fit.messages[fit.messages.length - 1].id).toBe("a2");
  });

  it("single oversized message falls back to natural flow (fits=false)", () => {
    const giant: ChatMessage = {
      id: "g", role: "assistant",
      content: Array.from({ length: 60 }, (_, i) => `long line ${i}`).join("\n"),
      ts: 0, status: "complete",
    };
    const fit = fitContent([giant], [], 8, 40);
    expect(fit.fits).toBe(false);
    expect(fit.messages).toEqual([giant]);
  });

  it("adds events only when room remains", () => {
    const messages = [userMsg(0), asstMsg(0)];
    const events = [event(0), event(1), event(2)];
    const fit = fitContent(messages, events, 20, 40);
    expect(fit.events.length).toBeGreaterThan(0);
    expect(fit.events[fit.events.length - 1].id).toBe("e2"); // newest kept
  });

  it("drops events when the conversation fills the region exactly", () => {
    // One turn = 6 rows at width 40 (user 2 + margin 1 + assistant 3).
    // A region of exactly 6 leaves no room for events.
    const messages = [userMsg(0), asstMsg(0)];
    const events = [event(0)];
    const fit = fitContent(messages, events, 6, 40);
    expect(fit.fits).toBe(true);
    expect(fit.events.length).toBe(0);
  });

  it("never exceeds the budget for multi-turn content", () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) { messages.push(userMsg(i)); messages.push(asstMsg(i)); }
    const fit = fitContent(messages, [], 12, 60);
    expect(fit.fits).toBe(true);
    let total = 0;
    for (const m of fit.messages) total += estimateMessageHeight(m, 60);
    expect(total).toBeLessThanOrEqual(12);
  });
});

// ─── Summary honesty ────────────────────────────────────────────────

describe("summary blocks", () => {
  it("ChangeSummary returns null with no files touched and clean git", () => {
    const mission = {
      text: "t", runId: null, state: "COMPLETE" as const, startedAt: 0, endedAt: 0,
      filesTouched: [], commandsExecuted: [], testResults: null,
      typecheckPassed: null, buildPassed: null, runtimeProven: null,
    };
    expect(ChangeSummary({ mission, gitModified: 0, gitUntracked: 0 })).toBeNull();
  });

  it("VerificationSummary returns null when nothing was verified (no invented DONE)", () => {
    const mission = {
      text: "t", runId: null, state: "COMPLETE" as const, startedAt: 0, endedAt: 0,
      filesTouched: [], commandsExecuted: [], testResults: null,
      typecheckPassed: null, buildPassed: null, runtimeProven: null,
    };
    expect(VerificationSummary({ mission })).toBeNull();
  });
});

// ─── Reading measure ────────────────────────────────────────────────

describe("content measure", () => {
  it("fits the 72–88 column target", () => {
    expect(CONTENT_MEASURE).toBeGreaterThanOrEqual(72);
    expect(CONTENT_MEASURE).toBeLessThanOrEqual(88);
  });
});
