import { describe, it, expect } from "vitest";
import {
  truncateToSpokenFallback,
  buildSpokenSummarySystemPrompt,
  buildSpokenSummaryUserContent,
  SPOKEN_DIRECT_MAX_CHARS,
  SPOKEN_FALLBACK_MAX_CHARS,
  SPOKEN_SUMMARY_MAX_WORDS,
} from "./spokenSummary";

describe("truncateToSpokenFallback", () => {
  it("returns short text unchanged", () => {
    const text = "Got it — deploying now.";
    expect(truncateToSpokenFallback(text)).toBe(text);
  });

  it("returns empty string for empty input", () => {
    expect(truncateToSpokenFallback("   ")).toBe("");
  });

  it("condenses a long reply to the first two sentences within the cap", () => {
    const text =
      "First sentence is short. Second sentence adds a bit more detail here. " +
      "Third sentence goes on and on with lots of extra words that nobody wants to hear read aloud " +
      "because it just keeps going past any reasonable limit for spoken output. " +
      "Fourth sentence is also quite long and should definitely be cut from the spoken version entirely.";
    const out = truncateToSpokenFallback(text);
    expect(out).toBe("First sentence is short. Second sentence adds a bit more detail here.");
    expect(out.length).toBeLessThanOrEqual(SPOKEN_FALLBACK_MAX_CHARS);
  });

  it("stops at the char cap even mid-way through the second sentence", () => {
    const longSecond = "Second sentence " + "with filler words ".repeat(40) + ".";
    const out = truncateToSpokenFallback(`Short first. ${longSecond} Third.`);
    expect(out).toBe("Short first.");
  });

  it("hard-cuts text with no sentence boundaries at the cap", () => {
    const text = "word ".repeat(200).trim();
    const out = truncateToSpokenFallback(text);
    expect(out.length).toBeLessThanOrEqual(SPOKEN_FALLBACK_MAX_CHARS);
    expect(out.length).toBeGreaterThan(0);
  });

  it("collapses whitespace", () => {
    const out = truncateToSpokenFallback("Hello.\n\n  World.  " + "x".repeat(400));
    expect(out).toContain("Hello. World.");
    expect(out).not.toContain("\n");
  });
});

describe("buildSpokenSummarySystemPrompt", () => {
  it("asks for 1–2 spoken sentences with the word cap", () => {
    const prompt = buildSpokenSummarySystemPrompt("litt");
    expect(prompt).toContain("1–2");
    expect(prompt).toContain(String(SPOKEN_SUMMARY_MAX_WORDS));
    expect(prompt).toContain("LiTT");
  });

  it("bans markdown/code/URLs and demands spoken English", () => {
    const prompt = buildSpokenSummarySystemPrompt("litt");
    expect(prompt).toMatch(/no markdown/i);
    expect(prompt).toMatch(/spoken/i);
  });

  it("uses the Spark persona for spark", () => {
    const prompt = buildSpokenSummarySystemPrompt("spark");
    expect(prompt).toContain("Spark");
    expect(prompt).not.toContain("lead AI copilot");
  });
});

describe("buildSpokenSummaryUserContent", () => {
  it("caps input at 4000 chars to bound cost", () => {
    const out = buildSpokenSummaryUserContent("x".repeat(5000));
    expect(out.length).toBe(4000);
  });
});

describe("spoken summary thresholds", () => {
  it("direct-speak threshold is sane", () => {
    expect(SPOKEN_DIRECT_MAX_CHARS).toBeGreaterThan(0);
    expect(SPOKEN_DIRECT_MAX_CHARS).toBeLessThanOrEqual(SPOKEN_FALLBACK_MAX_CHARS);
  });
});
