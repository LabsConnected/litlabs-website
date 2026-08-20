/**
 * Terminal UX hardening invariants — verifies the glyph ownership,
 * narrow terminal handling, and status footer degradation contracts.
 *
 * These tests lock the existing hardening so regressions are caught.
 */

import { describe, it, expect } from "vitest";
import { layoutBand, clampSize, type TerminalSize } from "../ink/use-terminal-size.js";
import { SEMANTIC_GLYPH, semanticOf } from "../ink/shell/transcript.js";
import type { ActivityEntry, ActivitySemantic } from "../ink/cockpit-store.js";

// ─── Layout band tests ─────────────────────────────────────────────

describe("layoutBand", () => {
  it("classifies >= 120 as wide", () => {
    expect(layoutBand(120)).toBe("wide");
    expect(layoutBand(200)).toBe("wide");
  });

  it("classifies 80-119 as standard", () => {
    expect(layoutBand(80)).toBe("standard");
    expect(layoutBand(119)).toBe("standard");
  });

  it("classifies < 80 as narrow", () => {
    expect(layoutBand(79)).toBe("narrow");
    expect(layoutBand(60)).toBe("narrow");
    expect(layoutBand(40)).toBe("narrow");
  });
});

describe("clampSize", () => {
  it("clamps negative/zero columns to minimum 20", () => {
    expect(clampSize({ columns: 0, rows: 24 }).columns).toBe(20);
    expect(clampSize({ columns: -5, rows: 24 }).columns).toBe(20);
  });

  it("clamps negative/zero rows to minimum 8", () => {
    expect(clampSize({ columns: 80, rows: 0 }.rows).rows).toBe(8);
    expect(clampSize({ columns: 80, rows: -1 }.rows).rows).toBe(8);
  });

  it("preserves valid sizes", () => {
    const size: TerminalSize = { columns: 80, rows: 24 };
    expect(clampSize(size)).toEqual(size);
  });
});

// ─── Semantic glyph ownership tests ────────────────────────────────

describe("SEMANTIC_GLYPH", () => {
  it("has exactly 5 semantic classes", () => {
    const keys = Object.keys(SEMANTIC_GLYPH) as ActivitySemantic[];
    expect(keys.length).toBe(5);
    expect(keys).toContain("working");
    expect(keys).toContain("success");
    expect(keys).toContain("warning");
    expect(keys).toContain("failed");
    expect(keys).toContain("decision");
  });

  it("each glyph is unique (no duplicate semantic glyphs)", () => {
    const glyphs = Object.values(SEMANTIC_GLYPH).map((g) => g.glyph);
    const unique = new Set(glyphs);
    expect(unique.size).toBe(glyphs.length);
  });

  it("working glyph is → (arrow)", () => {
    expect(SEMANTIC_GLYPH.working.glyph).toBe("→");
  });

  it("success glyph is ✓ (check)", () => {
    expect(SEMANTIC_GLYPH.success.glyph).toBe("✓");
  });

  it("failed glyph is × (cross)", () => {
    expect(SEMANTIC_GLYPH.failed.glyph).toBe("×");
  });
});

describe("semanticOf", () => {
  function makeEntry(type: string, text = "test"): ActivityEntry {
    return { id: "1", ts: 0, type, text } as ActivityEntry;
  }

  it("maps completion types to success", () => {
    expect(semanticOf(makeEntry("run.completed"))).toBe("success");
    expect(semanticOf(makeEntry("tool.completed"))).toBe("success");
    expect(semanticOf(makeEntry("mission.completed"))).toBe("success");
    expect(semanticOf(makeEntry("verification.passed"))).toBe("success");
    expect(semanticOf(makeEntry("agent.complete"))).toBe("success");
  });

  it("maps failure types to failed", () => {
    expect(semanticOf(makeEntry("run.failed"))).toBe("failed");
    expect(semanticOf(makeEntry("tool.failed"))).toBe("failed");
    expect(semanticOf(makeEntry("mission.failed"))).toBe("failed");
    expect(semanticOf(makeEntry("verification.failed"))).toBe("failed");
    expect(semanticOf(makeEntry("agent.stopped"))).toBe("failed");
  });

  it("maps timeout to warning", () => {
    expect(semanticOf(makeEntry("tool.timeout"))).toBe("warning");
  });

  it("maps plan-mode denials to decision (not failed)", () => {
    expect(semanticOf(makeEntry("info", "PLAN mode rejects: mutation not allowed"))).toBe("decision");
  });

  it("maps model.changed to decision", () => {
    expect(semanticOf(makeEntry("model.changed"))).toBe("decision");
  });

  it("maps started types to working", () => {
    expect(semanticOf(makeEntry("tool.started"))).toBe("working");
    expect(semanticOf(makeEntry("run.started"))).toBe("working");
    expect(semanticOf(makeEntry("mission.step_started"))).toBe("working");
  });
});
