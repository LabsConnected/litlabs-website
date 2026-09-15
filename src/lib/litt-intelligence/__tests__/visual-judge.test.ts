/**
 * Regression tests for the LiTT visual-quality judge.
 *
 * Honesty rules under test:
 * - A scorecard only exists when the judge actually produced a scored
 *   review. Missing screenshot / failed call / unparseable output is a
 *   recorded "unavailable" outcome — never a fabricated passing score.
 * - Below-threshold scorecards (overall or any dimension floor) fail.
 */
import { describe, expect, it } from "vitest";
import {
  JUDGE_DIMENSIONS,
  JUDGE_DIMENSION_FLOOR,
  JUDGE_PASS_THRESHOLD,
  judgeScorecard,
  parseScorecard,
  runVisualJudge,
  type VisualScorecard,
} from "../visual-judge";

function makeCard(overrides?: Partial<VisualScorecard>): VisualScorecard {
  return {
    dimensions: JUDGE_DIMENSIONS.map((dimension, i) => ({
      dimension,
      score: 8,
      note: `note for ${dimension} ${i}`,
    })),
    overall: 8,
    summary: "A solid page.",
    prioritizedFixes: ["Tighten hero spacing."],
    at: new Date().toISOString(),
    model: "test-model",
    ...overrides,
  };
}

function cardJson(overrides?: Record<string, unknown>): string {
  const card = makeCard();
  return JSON.stringify({ ...card, ...overrides, at: undefined, model: undefined });
}

describe("parseScorecard", () => {
  it("parses strict JSON", () => {
    const card = parseScorecard(cardJson(), "m");
    expect(card.dimensions).toHaveLength(9);
    expect(card.overall).toBe(8);
    expect(card.model).toBe("m");
  });

  it("parses JSON wrapped in markdown fences", () => {
    const card = parseScorecard("```json\n" + cardJson() + "\n```", "m");
    expect(card.dimensions).toHaveLength(9);
  });

  it("throws when a dimension is missing", () => {
    const parsed = JSON.parse(cardJson());
    parsed.dimensions = parsed.dimensions.slice(0, 8);
    expect(() => parseScorecard(JSON.stringify(parsed), "m")).toThrow(/missing dimension/);
  });

  it("throws on unparseable output", () => {
    expect(() => parseScorecard("not json at all", "m")).toThrow(/parseable/);
  });

  it("throws when dimensions are absent", () => {
    expect(() => parseScorecard(JSON.stringify({ overall: 5 }), "m")).toThrow(/no dimensions/);
  });

  it("never lets the model overall exceed the true average by more than 1.5", () => {
    const parsed = JSON.parse(cardJson());
    parsed.dimensions = parsed.dimensions.map((d: { score: number }) => ({ ...d, score: 4 }));
    parsed.overall = 9.5; // model claims 9.5, true average is 4
    const card = parseScorecard(JSON.stringify(parsed), "m");
    expect(card.overall).toBeLessThanOrEqual(5.5);
  });

  it("clamps out-of-range scores", () => {
    const parsed = JSON.parse(cardJson());
    parsed.dimensions[0].score = 99;
    parsed.dimensions[1].score = -3;
    const card = parseScorecard(JSON.stringify(parsed), "m");
    expect(card.dimensions[0].score).toBe(10);
    expect(card.dimensions[1].score).toBe(0);
  });
});

describe("judgeScorecard thresholds", () => {
  it("passes a strong scorecard", () => {
    const verdict = judgeScorecard(makeCard());
    expect(verdict.passed).toBe(true);
    expect(verdict.reason).toMatch(/Pass/);
  });

  it("fails when overall is below the pass threshold", () => {
    const card = makeCard({
      dimensions: JUDGE_DIMENSIONS.map((dimension) => ({ dimension, score: 6, note: "meh" })),
      overall: 6,
    });
    const verdict = judgeScorecard(card);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain(String(JUDGE_PASS_THRESHOLD));
  });

  it("fails when any single dimension is under the floor, even with a high overall", () => {
    const card = makeCard({
      dimensions: JUDGE_DIMENSIONS.map((dimension) => ({
        dimension,
        score: dimension === "originality" ? JUDGE_DIMENSION_FLOOR - 0.5 : 9,
        note: "x",
      })),
      overall: 8.6,
    });
    const verdict = judgeScorecard(card);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toContain("originality");
  });

  it("passes exactly at the threshold and floor boundaries", () => {
    const card = makeCard({
      dimensions: JUDGE_DIMENSIONS.map((dimension) => ({
        dimension,
        score: JUDGE_DIMENSION_FLOOR,
        note: "x",
      })),
      overall: JUDGE_PASS_THRESHOLD,
    });
    expect(judgeScorecard(card).passed).toBe(true);
  });
});

describe("runVisualJudge honesty", () => {
  const ctx = {
    userRequest: "Build a dog grooming site",
    previewUrl: "https://preview.example/abc",
  };

  it("returns unavailable when no screenshot can be captured — never a fake score", async () => {
    const outcome = await runVisualJudge({
      screenshot: null,
      capture: async () => null,
      context: ctx,
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.scorecard).toBeUndefined();
    expect(outcome.reason).toMatch(/No screenshot/);
  });

  it("returns unavailable when the capture throws", async () => {
    const outcome = await runVisualJudge({
      screenshot: null,
      capture: async () => {
        throw new Error("browser exploded");
      },
      context: ctx,
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.scorecard).toBeUndefined();
  });

  it("returns unavailable when the judge call fails", async () => {
    const outcome = await runVisualJudge({
      screenshot: "data:image/png;base64,AAA",
      context: ctx,
      judgeCall: async () => {
        throw new Error("provider down");
      },
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toMatch(/provider down/);
  });

  it("returns unavailable when the judge returns unparseable output", async () => {
    const outcome = await runVisualJudge({
      screenshot: "data:image/png;base64,AAA",
      context: ctx,
      judgeCall: async () => ({ text: "looks fine to me!", model: "m" }),
    });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.reason).toMatch(/unparseable/);
  });

  it("returns a scored verdict when the judge produces a valid scorecard", async () => {
    const outcome = await runVisualJudge({
      screenshot: "data:image/png;base64,AAA",
      context: ctx,
      judgeCall: async () => ({ text: cardJson(), model: "judge-model" }),
    });
    expect(outcome.status).toBe("scored");
    expect(outcome.scorecard?.model).toBe("judge-model");
    expect(outcome.verdict?.passed).toBe(true);
  });

  it("surfaces a failing verdict without fabricating a pass", async () => {
    const parsed = JSON.parse(cardJson());
    parsed.overall = 5;
    parsed.dimensions = parsed.dimensions.map((d: { score: number }) => ({ ...d, score: 5 }));
    const outcome = await runVisualJudge({
      screenshot: "data:image/png;base64,AAA",
      context: ctx,
      judgeCall: async () => ({ text: JSON.stringify(parsed), model: "m" }),
    });
    expect(outcome.status).toBe("scored");
    expect(outcome.verdict?.passed).toBe(false);
  });
});
