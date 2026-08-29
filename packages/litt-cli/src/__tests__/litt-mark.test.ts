/**
 * LiTT mark tests — shard sigil state system.
 *
 * Tests the pure helpers (glyph/color/animation mapping) and the
 * holo→mark-state and target→mark-state mappings.
 */

import { describe, it, expect } from "vitest";
import {
  markGlyph,
  markColor,
  isAnimated,
  holoToMarkState,
  targetToMarkState,
  type MarkState,
} from "../ink/litt-mark.js";
import { COLORS } from "../ink/colors.js";

describe("litt-mark: glyphs per state", () => {
  it("idle uses hollow shard ◳", () => {
    expect(markGlyph("idle")).toBe("◳");
  });

  it("thinking uses half-filled shard ◬", () => {
    expect(markGlyph("thinking")).toBe("◬");
  });

  it("executing uses filled shard ◬", () => {
    expect(markGlyph("executing")).toBe("◬");
  });

  it("success uses filled shard ◬", () => {
    expect(markGlyph("success")).toBe("◬");
  });

  it("error uses filled shard ◬", () => {
    expect(markGlyph("error")).toBe("◬");
  });

  it("local uses filled shard ◬", () => {
    expect(markGlyph("local")).toBe("◬");
  });

  it("remote uses filled shard ◬", () => {
    expect(markGlyph("remote")).toBe("◬");
  });
});

describe("litt-mark: colors per state", () => {
  it("idle → brand purple", () => {
    expect(markColor("idle")).toBe(COLORS.brand);
  });

  it("thinking → brandBright", () => {
    expect(markColor("thinking")).toBe(COLORS.brandBright);
  });

  it("executing → working (purple)", () => {
    expect(markColor("executing")).toBe(COLORS.working);
  });

  it("success → green", () => {
    expect(markColor("success")).toBe(COLORS.success);
  });

  it("error → red", () => {
    expect(markColor("error")).toBe(COLORS.error);
  });

  it("local → green (stable local)", () => {
    expect(markColor("local")).toBe(COLORS.success);
  });

  it("remote → blue (cloud/signal)", () => {
    expect(markColor("remote")).toBe(COLORS.remote);
  });
});

describe("litt-mark: animation states", () => {
  it("idle is not animated", () => {
    expect(isAnimated("idle")).toBe(false);
  });

  it("thinking is animated", () => {
    expect(isAnimated("thinking")).toBe(true);
  });

  it("executing is animated", () => {
    expect(isAnimated("executing")).toBe(true);
  });

  it("success is not animated (settles)", () => {
    expect(isAnimated("success")).toBe(false);
  });

  it("error is not animated (sharp, steady)", () => {
    expect(isAnimated("error")).toBe(false);
  });
});

describe("litt-mark: holo state mapping", () => {
  it("IDLE → idle", () => {
    expect(holoToMarkState("IDLE")).toBe("idle");
  });

  it("READY → idle", () => {
    expect(holoToMarkState("READY")).toBe("idle");
  });

  it("THINKING → thinking", () => {
    expect(holoToMarkState("THINKING")).toBe("thinking");
  });

  it("UNDERSTANDING → thinking", () => {
    expect(holoToMarkState("UNDERSTANDING")).toBe("thinking");
  });

  it("PLANNING → thinking", () => {
    expect(holoToMarkState("PLANNING")).toBe("thinking");
  });

  it("RUNNING → executing", () => {
    expect(holoToMarkState("RUNNING")).toBe("executing");
  });

  it("READING → executing", () => {
    expect(holoToMarkState("READING")).toBe("executing");
  });

  it("TESTING → executing", () => {
    expect(holoToMarkState("TESTING")).toBe("executing");
  });

  it("VERIFYING → executing", () => {
    expect(holoToMarkState("VERIFYING")).toBe("executing");
  });

  it("COMPLETE → success", () => {
    expect(holoToMarkState("COMPLETE")).toBe("success");
  });

  it("FAILED → error", () => {
    expect(holoToMarkState("FAILED")).toBe("error");
  });

  it("APPROVAL → idle (pause, not work)", () => {
    expect(holoToMarkState("APPROVAL")).toBe("idle");
  });

  it("unknown → idle (safe default)", () => {
    expect(holoToMarkState("UNKNOWN_STATE")).toBe("idle");
  });
});

describe("litt-mark: execution target mapping", () => {
  it("local → local (green)", () => {
    expect(targetToMarkState("local")).toBe("local");
  });

  it("remote → remote (blue)", () => {
    expect(targetToMarkState("remote")).toBe("remote");
  });
});

describe("litt-mark: all states have valid glyphs and colors", () => {
  const states: MarkState[] = ["idle", "thinking", "executing", "success", "error", "local", "remote"];

  it("every state has a non-empty glyph", () => {
    for (const s of states) {
      expect(markGlyph(s).length).toBeGreaterThan(0);
    }
  });

  it("every state has a valid hex color", () => {
    for (const s of states) {
      expect(markColor(s)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
