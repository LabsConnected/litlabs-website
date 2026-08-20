/**
 * Regression: duplicate activity markers in the shell transcript feed.
 *
 * Observed live bug:
 *   ✓ ✓ Run static validation
 *   → → Run automated tests
 *
 * Root cause: event-bridge.ts baked the semantic glyph ("→"/"✓"/"✗")
 * INTO entry.text, and then the transcript renderer (semanticOf() →
 * SEMANTIC_GLYPH) prepended the SAME glyph again at render time.
 *
 * Fix contract (presentation boundary):
 *   - State text is ICON-FREE. event-bridge.missionStepText() must not
 *     prepend any glyph.
 *   - The renderer owns the visual icon: semanticOf() classifies the
 *     entry, SEMANTIC_GLYPH maps the class to exactly one glyph.
 *   - One runtime event → one rendered row → exactly one glyph.
 *
 * These tests lock BOTH sides of the contract so a future change on
 * either side cannot reintroduce the duplicate.
 */
import { describe, it, expect } from "vitest";
import { missionStepText } from "../ink/event-bridge.js";
import { semanticOf, SEMANTIC_GLYPH } from "../ink/shell/transcript.js";
import type { ActivityEntry } from "../ink/cockpit-store.js";

/** Build a minimal ActivityEntry as event-bridge would produce it. */
function stepEntry(type: string, text: string): ActivityEntry {
  return { id: `act_${type}`, ts: 1000, type, text };
}

/** Mimic the transcript renderer's per-row composition: `{glyph} {text}`. */
function renderRow(entry: ActivityEntry): string {
  const sem = semanticOf(entry);
  const { glyph } = SEMANTIC_GLYPH[sem];
  return `${glyph} ${entry.text}`;
}

/** Count occurrences of a single char in a string. */
function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

describe("Activity marker dedup — source contract (event-bridge text is icon-free)", () => {
  it("missionStepText does not prepend →/✓/✗ for a step title", () => {
    const text = missionStepText({ title: "Run static validation", stepId: "s1" });
    expect(text).toBe("Run static validation");
    expect(text.startsWith("→")).toBe(false);
    expect(text.startsWith("✓")).toBe(false);
    expect(text.startsWith("✗")).toBe(false);
  });

  it("missionStepText falls back to stepId when title is absent", () => {
    expect(missionStepText({ stepId: "verify_build" })).toBe("verify_build");
  });

  it("missionStepText returns empty string when neither title nor stepId is present", () => {
    expect(missionStepText({})).toBe("");
  });

  it("missionStepText coerces non-string titles to strings", () => {
    // Defensive: runtime payloads occasionally carry numbers.
    expect(missionStepText({ title: 42 })).toBe("42");
  });
});

describe("Activity marker dedup — renderer contract (semanticOf + SEMANTIC_GLYPH)", () => {
  it("mission.step_started → working → →", () => {
    const entry = stepEntry("mission.step_started", "Run automated tests");
    expect(semanticOf(entry)).toBe("working");
    expect(SEMANTIC_GLYPH.working.glyph).toBe("→");
  });

  it("mission.step_passed → success → ✓", () => {
    const entry = stepEntry("mission.step_passed", "Run static validation");
    expect(semanticOf(entry)).toBe("success");
    expect(SEMANTIC_GLYPH.success.glyph).toBe("✓");
  });

  it("mission.step_failed → failed → ×", () => {
    const entry = stepEntry("mission.step_failed", "Run automated tests");
    expect(semanticOf(entry)).toBe("failed");
    expect(SEMANTIC_GLYPH.failed.glyph).toBe("×");
  });
});

describe("Activity marker dedup — end-to-end rendered row has exactly ONE glyph", () => {
  it("running row renders exactly one → (no → →)", () => {
    const text = missionStepText({ title: "Run automated tests" });
    const row = renderRow(stepEntry("mission.step_started", text));
    expect(row).toBe("→ Run automated tests");
    expect(countChar(row, "→")).toBe(1);
  });

  it("success row renders exactly one ✓ (no ✓ ✓)", () => {
    const text = missionStepText({ title: "Run static validation" });
    const row = renderRow(stepEntry("mission.step_passed", text));
    expect(row).toBe("✓ Run static validation");
    expect(countChar(row, "✓")).toBe(1);
  });

  it("failure row renders exactly one × (no × ×, and not ✗)", () => {
    const text = missionStepText({ title: "Run automated tests" });
    const row = renderRow(stepEntry("mission.step_failed", text));
    expect(row).toBe("× Run automated tests");
    expect(countChar(row, "×")).toBe(1);
    // The old source baked "✗"; ensure it is gone from the rendered row.
    expect(row.includes("✗")).toBe(false);
  });

  it("a step title that legitimately contains '→' in its body is not double-prefixed", () => {
    // The renderer adds exactly one leading glyph; it must not strip or
    // mangle a glyph that appears legitimately inside the title body.
    const text = missionStepText({ title: "Map A → B" });
    const row = renderRow(stepEntry("mission.step_started", text));
    expect(row).toBe("→ Map A → B");
    // Two → total: one renderer prefix + one in-body. NOT a duplicate prefix.
    expect(countChar(row, "→")).toBe(2);
    expect(row.startsWith("→ →")).toBe(false);
  });
});

describe("Activity marker dedup — no duplicate activity rows", () => {
  it("one mission.step_started event produces exactly one row", () => {
    const events: ActivityEntry[] = [
      stepEntry("mission.step_started", missionStepText({ title: "Run automated tests" })),
    ];
    const rows = events.map(renderRow);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe("→ Run automated tests");
  });

  it("a started→passed pair produces two distinct rows, one glyph each", () => {
    const events: ActivityEntry[] = [
      stepEntry("mission.step_started", missionStepText({ title: "Run static validation" })),
      stepEntry("mission.step_passed", missionStepText({ title: "Run static validation" })),
    ];
    const rows = events.map(renderRow);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe("→ Run static validation");
    expect(rows[1]).toBe("✓ Run static validation");
  });
});

describe("Activity marker dedup — existing agent tool dedup behavior remains intact", () => {
  /**
   * The tool-call dedup fix (SessionEventBridge suppresses tool_call/
   * tool_result for agent_ runs) is a separate concern from the marker
   * fix. This test asserts the renderer still classifies ordinary tool
   * events correctly so the two fixes do not collide.
   */
  it("tool.started → working → → (unchanged)", () => {
    const entry = stepEntry("tool.started", "project.status");
    expect(semanticOf(entry)).toBe("working");
    expect(renderRow(entry)).toBe("→ project.status");
  });

  it("tool.completed → success → ✓ (unchanged)", () => {
    const entry = stepEntry("tool.completed", "project.status · 58ms");
    expect(semanticOf(entry)).toBe("success");
    expect(renderRow(entry)).toBe("✓ project.status · 58ms");
  });

  it("tool.failed → failed → × (unchanged)", () => {
    const entry = stepEntry("tool.failed", "project.status — boom");
    expect(semanticOf(entry)).toBe("failed");
    expect(renderRow(entry)).toBe("× project.status — boom");
  });
});
