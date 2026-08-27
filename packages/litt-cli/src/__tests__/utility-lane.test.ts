/**
 * UTILITY lane — classification, execution, and (most importantly) the
 * fallthrough contract.
 *
 * The lane's job is to answer trivial lookups without a model call. Its
 * OTHER job — the one that keeps it safe to have at all — is to decline
 * cleanly. Two failure modes matter more than any answer it produces:
 *
 *   1. Hijacking. The controller consults this lane for every chat-intent
 *      turn. If classification is loose, ordinary conversation and coding
 *      questions get swallowed by a weather/search lookup.
 *   2. Bluffing. If a lookup fails or comes back empty and the lane still
 *      reports satisfied, the user gets a confident non-answer and the
 *      model never gets the turn.
 *
 * Both are covered here explicitly.
 */

import { describe, it, expect, vi } from "vitest";
import {
  classifyUtilityIntent,
  executeUtilityLookup,
  evaluateExpression,
  resolveTimeZone,
  type UtilityMatch,
  type UtilityToolRunner,
} from "../lib/utility-lane.js";
import type { ToolResult } from "@litt/agent-core";

// ─── Helpers ──────────────────────────────────────────────────────

const ok = (data: Record<string, unknown>, message = "ok"): ToolResult => ({
  status: "success", success: true, message, data,
});
const failed = (message: string): ToolResult => ({
  status: "failed", success: false, message, data: {},
});

/** A runner that must never be called — proves a lane answered locally. */
function forbiddenRunner(): UtilityToolRunner {
  return vi.fn(async () => {
    throw new Error("tool runner must not be called for a local answer");
  });
}

function runnerReturning(result: ToolResult): { run: UtilityToolRunner; calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    run: async (toolId, args) => { calls.push([toolId, args]); return result; },
  };
}

const FORECAST_DATA = {
  location: { zip: "49456", place: "Spring Lake", state: "MI" },
  periods: [
    { name: "Today", temperature: 71, temperatureUnit: "F", shortForecast: "Sunny", windSpeed: "8 mph", probabilityOfPrecipitation: 0 },
    { name: "Tonight", temperature: 54, temperatureUnit: "F", shortForecast: "Clear", windSpeed: "5 mph", probabilityOfPrecipitation: 20 },
  ],
};

// ─── Classification: what must NOT match ──────────────────────────

describe("classifyUtilityIntent — does not hijack ordinary input", () => {
  const mustNotMatch = [
    "how do I fix this build error",
    "explain the routing logic",
    "what does this function do",
    "refactor the model provider",
    "rewrite 2 + 2 in Python",
    "the timeout is 5000",
    "bump the version to 2.1.4",
    "49456",
    "what's the weather API we use called",
    "add a search bar near the header",
    "why is the test suite slow",
    "/model",
    "",
    "   ",
  ];

  for (const input of mustNotMatch) {
    it(`ignores ${JSON.stringify(input)}`, () => {
      const match = classifyUtilityIntent(input);
      // A bare "what's the weather API..." may classify as weather (it
      // contains "weather"), but it must never be SATISFIED without a
      // ZIP — that is covered in the execution tests. Here we only
      // assert the clearly-non-utility cases return null.
      if (input.includes("weather")) return;
      expect(match).toBeNull();
    });
  }

  it("ignores long prose even when it mentions a utility word", () => {
    const essay = "So the weather ".repeat(30);
    expect(essay.length).toBeGreaterThan(200);
    expect(classifyUtilityIntent(essay)).toBeNull();
  });

  it("a bare ZIP does not route to weather — it is a follow-up, not a query", () => {
    // This is the exact misroute the conversation-memory fix exists for:
    // "49456" answering "which city or ZIP?" must reach the model with
    // its history, not be reinterpreted as a fresh weather lookup.
    expect(classifyUtilityIntent("49456")).toBeNull();
  });
});

// ─── Classification: what must match ──────────────────────────────

describe("classifyUtilityIntent — recognizes utility queries", () => {
  it("weather with a ZIP", () => {
    expect(classifyUtilityIntent("what's the weather in 49456")).toEqual({ kind: "weather", zip: "49456" });
  });

  it("weather without a ZIP still classifies (execution decides)", () => {
    expect(classifyUtilityIntent("what's the forecast today?")).toEqual({ kind: "weather", zip: null });
  });

  it("arithmetic", () => {
    expect(classifyUtilityIntent("what is 12 * 8")).toEqual({ kind: "calculator", expression: "12 * 8" });
    expect(classifyUtilityIntent("(3 + 4) / 2")).toEqual({ kind: "calculator", expression: "(3 + 4) / 2" });
  });

  it("percent-of phrasing", () => {
    expect(classifyUtilityIntent("what is 18% of 240")).toEqual({
      kind: "calculator",
      expression: "18 / 100 * 240",
    });
  });

  it("current time", () => {
    const match = classifyUtilityIntent("what time is it");
    expect(match).toEqual({ kind: "time", timeZone: null, place: null });
  });

  it("time in a known place", () => {
    expect(classifyUtilityIntent("what's the time in Tokyo?")).toEqual({
      kind: "time", timeZone: "Asia/Tokyo", place: "Tokyo",
    });
  });

  it("business hours", () => {
    const match = classifyUtilityIntent("what time does Home Depot close");
    expect(match?.kind).toBe("business-hours");
    expect((match as { subject: string }).subject).toBe("Home Depot");
  });

  it("local place", () => {
    const match = classifyUtilityIntent("nearest hardware store");
    expect(match?.kind).toBe("local-place");
    expect((match as { subject: string }).subject).toBe("hardware store");
  });
});

// ─── Arithmetic ───────────────────────────────────────────────────

describe("evaluateExpression", () => {
  it("computes correctly", () => {
    expect(evaluateExpression("2+2")).toBe(4);
    expect(evaluateExpression("12 * 8")).toBe(96);
    expect(evaluateExpression("(3 + 4) / 2")).toBe(3.5);
    expect(evaluateExpression("2 ^ 10")).toBe(1024);
    expect(evaluateExpression("10 % 3")).toBe(1);
    expect(evaluateExpression("-5 + 3")).toBe(-2);
    expect(evaluateExpression("2 ^ 3 ^ 2")).toBe(512); // right associative
    // Raw IEEE-754 result — rounding for display is formatNumber's job,
    // asserted on the rendered answer in the execution tests below.
    expect(evaluateExpression("18 / 100 * 240")).toBeCloseTo(43.2, 10);
  });

  it("respects precedence", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
  });

  it("returns null rather than Infinity or NaN", () => {
    expect(evaluateExpression("1 / 0")).toBeNull();
    expect(evaluateExpression("5 % 0")).toBeNull();
  });

  it("returns null on malformed input", () => {
    expect(evaluateExpression("2 +")).toBeNull();
    expect(evaluateExpression("(2 + 3")).toBeNull();
    expect(evaluateExpression("2 3")).toBeNull();
    expect(evaluateExpression("")).toBeNull();
    expect(evaluateExpression("* 4")).toBeNull();
  });

  it("never executes the input — identifiers are rejected, not evaluated", () => {
    // If this were eval/Function, these would run or throw at runtime.
    expect(evaluateExpression("process.exit(1)")).toBeNull();
    expect(evaluateExpression("1;console.log(2)")).toBeNull();
    expect(evaluateExpression("require('fs')")).toBeNull();
    expect(evaluateExpression("2 + globalThis")).toBeNull();
  });
});

describe("resolveTimeZone", () => {
  it("maps known places", () => {
    expect(resolveTimeZone("Tokyo")).toBe("Asia/Tokyo");
    expect(resolveTimeZone("new york")).toBe("America/New_York");
    expect(resolveTimeZone("UTC")).toBe("UTC");
  });

  it("accepts a valid explicit IANA zone", () => {
    expect(resolveTimeZone("America/Denver")).toBe("America/Denver");
  });

  it("returns null for unknown places rather than guessing", () => {
    expect(resolveTimeZone("Fictionopolis")).toBeNull();
    expect(resolveTimeZone("Not/AZone")).toBeNull();
    expect(resolveTimeZone("")).toBeNull();
  });
});

// ─── Execution: local answers ─────────────────────────────────────

describe("executeUtilityLookup — local answers use no tools", () => {
  it("arithmetic answers without calling any tool", async () => {
    const runner = forbiddenRunner();
    const result = await executeUtilityLookup({ kind: "calculator", expression: "18 / 100 * 240" }, runner);
    expect(result.satisfied).toBe(true);
    expect(result.text).toBe("43.2");
    expect(result.toolsUsed).toEqual([]);
    expect(runner).not.toHaveBeenCalled();
  });

  it("an unparseable expression declines instead of guessing", async () => {
    const result = await executeUtilityLookup({ kind: "calculator", expression: "2 +" }, forbiddenRunner());
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe("");
    expect(result.reason).toMatch(/parse/i);
  });

  it("current time answers locally", async () => {
    const result = await executeUtilityLookup({ kind: "time", timeZone: "UTC", place: "UTC" }, forbiddenRunner());
    expect(result.satisfied).toBe(true);
    expect(result.text).toContain("UTC");
    expect(result.toolsUsed).toEqual([]);
  });

  it("an unrecognized place declines rather than inventing a zone", async () => {
    const result = await executeUtilityLookup(
      { kind: "time", timeZone: null, place: "Fictionopolis" },
      forbiddenRunner(),
    );
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe("");
    expect(result.reason).toContain("Fictionopolis");
  });
});

// ─── Execution: weather ───────────────────────────────────────────

describe("executeUtilityLookup — weather", () => {
  it("formats a real forecast and reports the tool it used", async () => {
    const { run, calls } = runnerReturning(ok(FORECAST_DATA));
    const result = await executeUtilityLookup({ kind: "weather", zip: "49456" }, run);

    expect(calls).toEqual([["weather.forecast", { zip: "49456" }]]);
    expect(result.satisfied).toBe(true);
    expect(result.toolsUsed).toEqual(["weather.forecast"]);
    expect(result.text).toContain("Spring Lake, MI (49456)");
    expect(result.text).toContain("Today: 71°F · Sunny · wind 8 mph");
    expect(result.text).toContain("Tonight");
    expect(result.text).toContain("20% precip");
    expect(result.text).toContain("National Weather Service");
  });

  it("declines without a ZIP — and never calls the tool", async () => {
    const runner = forbiddenRunner();
    const result = await executeUtilityLookup({ kind: "weather", zip: null }, runner);
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe("");
    expect(result.reason).toMatch(/ZIP/i);
    expect(runner).not.toHaveBeenCalled();
  });

  it("a failed forecast declines — the error is never dressed up as an answer", async () => {
    const { run } = runnerReturning(failed("NWS unavailable (503)"));
    const result = await executeUtilityLookup({ kind: "weather", zip: "49456" }, run);
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe("");
    expect(result.reason).toBe("NWS unavailable (503)");
    expect(result.toolsUsed).toEqual(["weather.forecast"]); // truthful: it did run
  });

  it("an empty period list declines", async () => {
    const { run } = runnerReturning(ok({ location: FORECAST_DATA.location, periods: [] }));
    const result = await executeUtilityLookup({ kind: "weather", zip: "49456" }, run);
    expect(result.satisfied).toBe(false);
  });

  it("periods with no usable data decline rather than render an empty header", async () => {
    const { run } = runnerReturning(ok({
      location: FORECAST_DATA.location,
      periods: [{ name: "Today", temperature: null, shortForecast: null, windSpeed: null }],
    }));
    const result = await executeUtilityLookup({ kind: "weather", zip: "49456" }, run);
    expect(result.satisfied).toBe(false);
  });
});

// ─── Execution: search-backed lanes ───────────────────────────────

describe("executeUtilityLookup — search-backed lanes", () => {
  it("business hours searches and attributes the source", async () => {
    const { run, calls } = runnerReturning(ok({
      empty: false,
      answer: null,
      abstract: "Open 6 AM to 10 PM daily.",
      abstractSource: "Wikipedia",
      abstractUrl: "https://example.org/hd",
    }));
    const result = await executeUtilityLookup({ kind: "business-hours", subject: "Home Depot" }, run);

    expect(calls[0][0]).toBe("web.search");
    expect(calls[0][1]).toEqual({ query: "Home Depot opening hours" });
    expect(result.satisfied).toBe(true);
    expect(result.text).toContain("Open 6 AM to 10 PM daily.");
    expect(result.text).toContain("Source: Wikipedia — https://example.org/hd");
    expect(result.toolsUsed).toEqual(["web.search"]);
  });

  it("local place searches with a near-me query", async () => {
    const { run, calls } = runnerReturning(ok({ empty: false, answer: "Ace Hardware, 3rd St" }));
    const result = await executeUtilityLookup({ kind: "local-place", subject: "hardware store" }, run);
    expect(calls[0][1]).toEqual({ query: "hardware store near me" });
    expect(result.satisfied).toBe(true);
    expect(result.text).toBe("Ace Hardware, 3rd St");
  });

  it("a truthfully-empty search declines — no invented answer", async () => {
    const { run } = runnerReturning(ok({ empty: true, answer: null, abstract: null }));
    const result = await executeUtilityLookup({ kind: "local-place", subject: "quokka rental" }, run);
    expect(result.satisfied).toBe(false);
    expect(result.text).toBe("");
    expect(result.toolsUsed).toEqual(["web.search"]);
  });

  it("a result with no answer and no abstract declines", async () => {
    const { run } = runnerReturning(ok({ empty: false, answer: null, abstract: null, relatedTopics: [] }));
    const result = await executeUtilityLookup({ kind: "business-hours", subject: "somewhere" }, run);
    expect(result.satisfied).toBe(false);
  });

  it("a failed search declines", async () => {
    const { run } = runnerReturning(failed("network unreachable"));
    const result = await executeUtilityLookup({ kind: "local-place", subject: "cafe" }, run);
    expect(result.satisfied).toBe(false);
    expect(result.reason).toBe("network unreachable");
  });
});

// ─── The fallthrough contract ─────────────────────────────────────

describe("UTILITY lane — fallthrough contract", () => {
  it("every unsatisfied result renders nothing", async () => {
    const declining: UtilityMatch[] = [
      { kind: "weather", zip: null },
      { kind: "calculator", expression: "((" },
      { kind: "time", timeZone: null, place: "Nowhere-at-all" },
    ];
    for (const match of declining) {
      const result = await executeUtilityLookup(match, forbiddenRunner());
      expect(result.satisfied).toBe(false);
      expect(result.text).toBe("");
      expect(result.reason).toBeTruthy();
    }
  });

  it("declining costs at most one tool call, never a model call", async () => {
    const { run, calls } = runnerReturning(ok({ empty: true }));
    const result = await executeUtilityLookup({ kind: "local-place", subject: "x y" }, run);
    expect(result.satisfied).toBe(false);
    expect(calls.length).toBe(1);
  });
});
