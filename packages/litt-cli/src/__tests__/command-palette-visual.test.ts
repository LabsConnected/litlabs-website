/**
 * Command palette visual tests — palette actions and structure.
 *
 * Tests the command palette's action set (including /local and /remote)
 * and the fuzzy scoring logic.
 */

import { describe, it, expect } from "vitest";
import { fuzzyScore, normalizeCommandQuery, DEFAULT_ACTIONS } from "../ink/command-palette.js";

describe("command palette: DEFAULT_ACTIONS", () => {
  it("includes /local command", () => {
    const local = DEFAULT_ACTIONS.find(a => a.id === "/local");
    expect(local).toBeDefined();
    expect(local!.label).toContain("LOCAL");
  });

  it("includes /remote command", () => {
    const remote = DEFAULT_ACTIONS.find(a => a.id === "/remote");
    expect(remote).toBeDefined();
    expect(remote!.label).toContain("REMOTE");
  });

  it("groups /local and /remote in MODE group", () => {
    const local = DEFAULT_ACTIONS.find(a => a.id === "/local");
    const remote = DEFAULT_ACTIONS.find(a => a.id === "/remote");
    expect(local!.group).toBe("MODE");
    expect(remote!.group).toBe("MODE");
  });

  it("preserves existing commands", () => {
    expect(DEFAULT_ACTIONS.find(a => a.id === "/new")).toBeDefined();
    expect(DEFAULT_ACTIONS.find(a => a.id === "/run")).toBeDefined();
    expect(DEFAULT_ACTIONS.find(a => a.id === "/help")).toBeDefined();
    expect(DEFAULT_ACTIONS.find(a => a.id === "/exit")).toBeDefined();
  });

  it("has unique IDs", () => {
    const ids = DEFAULT_ACTIONS.map(a => a.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every action has id, label, and group", () => {
    for (const a of DEFAULT_ACTIONS) {
      expect(a.id).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.group).toBeTruthy();
    }
  });
});

describe("command palette: fuzzyScore", () => {
  it("returns high score for prefix match", () => {
    expect(fuzzyScore("local", "/local Switch to LOCAL mode")).toBeGreaterThan(0);
  });

  it("returns 0 for empty query", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("returns -1 for no match", () => {
    expect(fuzzyScore("xyz", "local")).toBe(-1);
  });

  it("prefix match scores higher than subsequence match", () => {
    const prefixScore = fuzzyScore("loc", "local");
    const subseqScore = fuzzyScore("lcl", "local");
    expect(prefixScore).toBeGreaterThan(subseqScore);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("LOCAL", "local")).toBeGreaterThan(0);
    expect(fuzzyScore("local", "LOCAL")).toBeGreaterThan(0);
  });
});

describe("command palette: leading-slash normalization (2026-08-29 regression)", () => {
  // Ctrl+K users may type slash-prefixed or bare command names — all of
  // these must find /doctor (previously "/doctor" showed "No matches").
  it.each(["doctor", "/doctor", "doc", "/doc"])(
    "query %s matches /doctor",
    (q) => {
      const nq = normalizeCommandQuery(q);
      const best = Math.max(
        ...DEFAULT_ACTIONS.map(
          (a) => Math.max(
            fuzzyScore(nq, a.label),
            fuzzyScore(nq, normalizeCommandQuery(a.id)),
          ),
        ),
      );
      expect(best).toBeGreaterThan(0);
      // /doctor specifically matches (not just some other command).
      const doctor = DEFAULT_ACTIONS.find((a) => a.id === "/doctor")!;
      expect(
        Math.max(
          fuzzyScore(nq, doctor.label),
          fuzzyScore(nq, normalizeCommandQuery(doctor.id)),
        ),
      ).toBeGreaterThan(0);
    },
  );

  it("normalization only affects matching — ids and labels stay intact", () => {
    expect(normalizeCommandQuery("/doctor")).toBe("doctor");
    expect(DEFAULT_ACTIONS.find((a) => a.id === "/doctor")!.id).toBe("/doctor");
  });

  it("non-matching queries still return -1 after normalization", () => {
    const nq = normalizeCommandQuery("/xyzzy");
    const best = Math.max(
      ...DEFAULT_ACTIONS.map(
        (a) => Math.max(
          fuzzyScore(nq, a.label),
          fuzzyScore(nq, normalizeCommandQuery(a.id)),
        ),
      ),
    );
    expect(best).toBe(-1);
  });
});
