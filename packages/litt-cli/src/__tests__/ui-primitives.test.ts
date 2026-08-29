/**
 * UI primitives tests — reusable visual building blocks.
 *
 * Tests the pure rendering helpers and width classification used by
 * the visual shell overhaul.
 */

import { describe, it, expect } from "vitest";
import {
  classifyWidth,
  truncateMid,
  truncateTail,
  type TerminalWidth,
} from "../ink/ui-primitives.js";

describe("ui-primitives: classifyWidth", () => {
  it("classifies < 60 as narrow (phone/Termux)", () => {
    expect(classifyWidth(55)).toBe("narrow");
    expect(classifyWidth(59)).toBe("narrow");
  });

  it("classifies 60-99 as normal (standard terminal)", () => {
    expect(classifyWidth(60)).toBe("normal");
    expect(classifyWidth(80)).toBe("normal");
    expect(classifyWidth(99)).toBe("normal");
  });

  it("classifies >= 100 as wide (desktop)", () => {
    expect(classifyWidth(100)).toBe("wide");
    expect(classifyWidth(120)).toBe("wide");
    expect(classifyWidth(200)).toBe("wide");
  });

  it("handles edge cases", () => {
    expect(classifyWidth(0)).toBe("narrow");
    expect(classifyWidth(1)).toBe("narrow");
  });
});

describe("ui-primitives: truncateMid", () => {
  it("returns short text unchanged", () => {
    expect(truncateMid("hello", 10)).toBe("hello");
  });

  it("truncates from the middle for long text", () => {
    const result = truncateMid("C:\\very\\long\\path\\to\\file.ts", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain("…");
    // Should keep start and end
    expect(result.startsWith("C:")).toBe(true);
    expect(result.endsWith("file.ts")).toBe(true);
  });

  it("handles very small max (just truncates)", () => {
    // max < 8: simple slice, no mid-truncation
    expect(truncateMid("hello world", 5)).toBe("hello");
  });
});

describe("ui-primitives: truncateTail", () => {
  it("returns short text unchanged", () => {
    expect(truncateTail("hello", 10)).toBe("hello");
  });

  it("truncates from the tail for long text", () => {
    const result = truncateTail("very-long-branch-name-feature", 15);
    expect(result.length).toBeLessThanOrEqual(15);
    expect(result).toContain("…");
    expect(result.startsWith("very-long")).toBe(true);
  });

  it("handles very small max", () => {
    expect(truncateTail("hello", 3)).toBe("he…");
  });
});
