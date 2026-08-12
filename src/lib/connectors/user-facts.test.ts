import { describe, it, expect } from "vitest";
import {
  buildFactsContextBlock,
  type UserFact,
} from "@/lib/connectors/user-facts";

// ── Helpers ────────────────────────────────────────────────────────────

function makeFact(overrides: Partial<UserFact> = {}): UserFact {
  return {
    id: "fact-1",
    userId: "user-1",
    key: "test_key",
    value: "test_value",
    source: "user_explicit",
    confidence: 0.9,
    confirmed: true,
    metadata: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("user-facts — buildFactsContextBlock", () => {
  it("returns empty string for empty facts array", () => {
    expect(buildFactsContextBlock([])).toBe("");
  });

  it("includes confirmed facts", () => {
    const facts = [makeFact({ key: "preferred_name", value: "Larry", confirmed: true, confidence: 0.5 })];
    const block = buildFactsContextBlock(facts);
    expect(block).toContain("preferred_name: Larry");
    expect(block).toContain("confirmed");
  });

  it("includes high-confidence unconfirmed facts", () => {
    const facts = [makeFact({ key: "ui_preference", value: "dark", confirmed: false, confidence: 0.8 })];
    const block = buildFactsContextBlock(facts);
    expect(block).toContain("ui_preference: dark");
    expect(block).toContain("confidence: 0.8");
  });

  it("excludes low-confidence unconfirmed facts", () => {
    const facts = [makeFact({ key: "guess", value: "maybe", confirmed: false, confidence: 0.3 })];
    const block = buildFactsContextBlock(facts);
    expect(block).toBe("");
  });

  it("handles non-string values by JSON-stringifying them", () => {
    const facts = [makeFact({ key: "preferences", value: { theme: "dark", lang: "en" }, confirmed: true })];
    const block = buildFactsContextBlock(facts);
    expect(block).toContain("preferences:");
    expect(block).toContain("theme");
    expect(block).toContain("dark");
  });

  it("includes multiple facts", () => {
    const facts = [
      makeFact({ id: "1", key: "name", value: "Larry", confirmed: true, confidence: 1.0 }),
      makeFact({ id: "2", key: "city", value: "Spring Lake", confirmed: true, confidence: 1.0 }),
    ];
    const block = buildFactsContextBlock(facts);
    expect(block).toContain("name: Larry");
    expect(block).toContain("city: Spring Lake");
  });

  it("starts with the USER FACTS header", () => {
    const facts = [makeFact({ confirmed: true })];
    const block = buildFactsContextBlock(facts);
    expect(block.startsWith("USER FACTS")).toBe(true);
  });
});
