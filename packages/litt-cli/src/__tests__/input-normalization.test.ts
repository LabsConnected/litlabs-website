/**
 * Regression tests for the input normalization layer and composer editor.
 *
 * Tests:
 *   - Raw sequence → normalized key (input-keys.ts)
 *   - Normalized key → editor state mutation (composer-editor.ts)
 *   - ASCII insertion, Backspace, Delete, word delete, cursor movement
 *   - Emoji / skin-tone / Unicode grapheme safety
 *   - Rapid backspace, empty buffer, paste
 */
import { describe, it, expect } from "vitest";
import { normalizeKey, type KeyInfo } from "../ink/input-keys.js";
import {
  applyKeyEvent, backspace, createComposerState, deleteForward,
  deleteWordLeft, deleteToEnd, deleteToStart, insertText, moveEnd,
  moveHome, moveLeft, moveRight, splitGraphemes,
} from "../ink/composer-editor.js";

// ─── Helpers ─────────────────────────────────────────────────────────

const noKey: KeyInfo = {
  upArrow: false, downArrow: false, return: false, escape: false,
  tab: false, backspace: false, delete: false, ctrl: false,
};

function key(overrides: Partial<KeyInfo>): KeyInfo {
  return { ...noKey, ...overrides };
}

// ─── Input normalization tests ───────────────────────────────────────

describe("normalizeKey", () => {
  it("DEL byte (0x7F) → BACKSPACE", () => {
    const evt = normalizeKey("\u007f", key({ backspace: true }));
    expect(evt.kind).toBe("BACKSPACE");
  });

  it("BS byte (0x08) → BACKSPACE", () => {
    const evt = normalizeKey("\b", key({ backspace: true }));
    expect(evt.kind).toBe("BACKSPACE");
  });

  it("DEL byte without key flag → BACKSPACE (fallback)", () => {
    const evt = normalizeKey("\u007f", noKey);
    expect(evt.kind).toBe("BACKSPACE");
  });

  it("BS byte without key flag → BACKSPACE (fallback)", () => {
    const evt = normalizeKey("\b", noKey);
    expect(evt.kind).toBe("BACKSPACE");
  });

  it("key.delete flag → DELETE (forward)", () => {
    const evt = normalizeKey("\x1b[3~", key({ delete: true }));
    expect(evt.kind).toBe("DELETE");
  });

  it("Ctrl+W → DELETE_WORD_LEFT", () => {
    const evt = normalizeKey("w", key({ ctrl: true }));
    expect(evt.kind).toBe("DELETE_WORD_LEFT");
  });

  it("Alt+Backspace → DELETE_WORD_LEFT", () => {
    const evt = normalizeKey("\u007f", key({ backspace: true, meta: true }));
    expect(evt.kind).toBe("DELETE_WORD_LEFT");
  });

  it("Ctrl+U → DELETE_TO_START", () => {
    const evt = normalizeKey("u", key({ ctrl: true }));
    expect(evt.kind).toBe("DELETE_TO_START");
  });

  it("Ctrl+K → DELETE_TO_END", () => {
    const evt = normalizeKey("k", key({ ctrl: true }));
    expect(evt.kind).toBe("DELETE_TO_END");
  });

  it("Ctrl+A → MOVE_HOME", () => {
    const evt = normalizeKey("a", key({ ctrl: true }));
    expect(evt.kind).toBe("MOVE_HOME");
  });

  it("Ctrl+E → MOVE_END", () => {
    const evt = normalizeKey("e", key({ ctrl: true }));
    expect(evt.kind).toBe("MOVE_END");
  });

  it("Left arrow → MOVE_LEFT", () => {
    const evt = normalizeKey("", key({ leftArrow: true }));
    expect(evt.kind).toBe("MOVE_LEFT");
  });

  it("Right arrow → MOVE_RIGHT", () => {
    const evt = normalizeKey("", key({ rightArrow: true }));
    expect(evt.kind).toBe("MOVE_RIGHT");
  });

  it("Home escape sequence → MOVE_HOME", () => {
    const evt = normalizeKey("\x1b[H", noKey);
    expect(evt.kind).toBe("MOVE_HOME");
  });

  it("End escape sequence → MOVE_END", () => {
    const evt = normalizeKey("\x1b[F", noKey);
    expect(evt.kind).toBe("MOVE_END");
  });

  it("Enter → SUBMIT", () => {
    expect(normalizeKey("\r", key({ return: true })).kind).toBe("SUBMIT");
    expect(normalizeKey("\n", noKey).kind).toBe("SUBMIT");
  });

  it("Escape → ESCAPE", () => {
    expect(normalizeKey("\u001b", key({ escape: true })).kind).toBe("ESCAPE");
  });

  it("Ctrl+C → CANCEL", () => {
    expect(normalizeKey("\x03", key({ ctrl: true })).kind).toBe("CANCEL");
    expect(normalizeKey("c", key({ ctrl: true })).kind).toBe("CANCEL");
  });

  it("Tab → TAB", () => {
    expect(normalizeKey("\t", key({ tab: true })).kind).toBe("TAB");
  });

  it("Printable char → INSERT_TEXT", () => {
    const evt = normalizeKey("a", noKey);
    expect(evt.kind).toBe("INSERT_TEXT");
    expect(evt.text).toBe("a");
  });

  it("Multi-char paste → INSERT_TEXT", () => {
    const evt = normalizeKey("hello world", noKey);
    expect(evt.kind).toBe("INSERT_TEXT");
    expect(evt.text).toBe("hello world");
  });

  it("Pasted text containing DEL byte is NOT treated as backspace", () => {
    // Length > 1, so the backspace fallback (length === 1) doesn't fire
    const evt = normalizeKey("hello\u007f", noKey);
    expect(evt.kind).toBe("INSERT_TEXT");
  });

  it("Normal backspace does NOT produce DELETE_WORD_LEFT", () => {
    const evt = normalizeKey("\u007f", key({ backspace: true }));
    expect(evt.kind).not.toBe("DELETE_WORD_LEFT");
    expect(evt.kind).toBe("BACKSPACE");
  });
});

// ─── Composer editor tests ───────────────────────────────────────────

describe("ComposerEditor", () => {
  // ─── ASCII insertion ────────────────────────────────────────────

  it("inserts ASCII at cursor", () => {
    const s = createComposerState("");
    const next = insertText(s, "hello");
    expect(next.text).toBe("hello");
    expect(next.caret).toBe(5);
  });

  it("inserts in the middle", () => {
    const s = createComposerState("helo", 2);
    const next = insertText(s, "l");
    expect(next.text).toBe("hello");
    expect(next.caret).toBe(3);
  });

  // ─── Backspace ──────────────────────────────────────────────────

  it("backspace at end deletes one char", () => {
    const s = createComposerState("hello", 5);
    const next = backspace(s);
    expect(next.text).toBe("hell");
    expect(next.caret).toBe(4);
  });

  it("backspace in middle deletes one char", () => {
    const s = createComposerState("hello", 2);
    const next = backspace(s);
    expect(next.text).toBe("hllo");
    expect(next.caret).toBe(1);
  });

  it("backspace at beginning is a no-op", () => {
    const s = createComposerState("hello", 0);
    const next = backspace(s);
    expect(next.text).toBe("hello");
    expect(next.caret).toBe(0);
  });

  it("backspace on empty buffer is a no-op", () => {
    const s = createComposerState("");
    const next = backspace(s);
    expect(next.text).toBe("");
    expect(next.caret).toBe(0);
  });

  it("normal backspace does NOT delete a word", () => {
    const s = createComposerState("hello world", 11);
    const next = backspace(s);
    expect(next.text).toBe("hello worl");
    expect(next.text).not.toBe("hello ");
  });

  it("rapid backspace deletes one at a time", () => {
    let s = createComposerState("abc", 3);
    s = backspace(s);
    expect(s.text).toBe("ab");
    s = backspace(s);
    expect(s.text).toBe("a");
    s = backspace(s);
    expect(s.text).toBe("");
  });

  // ─── Delete (forward) ───────────────────────────────────────────

  it("delete at cursor removes char after cursor", () => {
    const s = createComposerState("hello", 2);
    const next = deleteForward(s);
    expect(next.text).toBe("helo");
    expect(next.caret).toBe(2);
  });

  it("delete at end is a no-op", () => {
    const s = createComposerState("hello", 5);
    const next = deleteForward(s);
    expect(next.text).toBe("hello");
  });

  // ─── Word delete (Ctrl+W) ───────────────────────────────────────

  it("Ctrl+W deletes one word", () => {
    const s = createComposerState("hello world", 11);
    const next = deleteWordLeft(s);
    expect(next.text).toBe("hello ");
    expect(next.caret).toBe(6);
  });

  it("Ctrl+W on single word deletes it", () => {
    const s = createComposerState("hello", 5);
    const next = deleteWordLeft(s);
    expect(next.text).toBe("");
  });

  it("Ctrl+W with leading whitespace consumes it", () => {
    const s = createComposerState("hello   world", 13);
    const next = deleteWordLeft(s);
    expect(next.text).toBe("hello   ");
  });

  // ─── Delete to start / end ──────────────────────────────────────

  it("Ctrl+U deletes to start", () => {
    const s = createComposerState("hello world", 5);
    const next = deleteToStart(s);
    expect(next.text).toBe(" world");
    expect(next.caret).toBe(0);
  });

  it("Ctrl+K deletes to end", () => {
    const s = createComposerState("hello world", 5);
    const next = deleteToEnd(s);
    expect(next.text).toBe("hello");
    expect(next.caret).toBe(5);
  });

  // ─── Cursor movement ────────────────────────────────────────────

  it("move left", () => {
    const s = createComposerState("hello", 3);
    expect(moveLeft(s).caret).toBe(2);
  });

  it("move left at start is no-op", () => {
    const s = createComposerState("hello", 0);
    expect(moveLeft(s).caret).toBe(0);
  });

  it("move right", () => {
    const s = createComposerState("hello", 3);
    expect(moveRight(s).caret).toBe(4);
  });

  it("move right at end is no-op", () => {
    const s = createComposerState("hello", 5);
    expect(moveRight(s).caret).toBe(5);
  });

  it("Home moves to start", () => {
    const s = createComposerState("hello", 3);
    expect(moveHome(s).caret).toBe(0);
  });

  it("End moves to end", () => {
    const s = createComposerState("hello", 0);
    expect(moveEnd(s).caret).toBe(5);
  });

  // ─── Emoji / Unicode grapheme safety ────────────────────────────

  it("splitGraphemes splits simple emoji correctly", () => {
    const g = splitGraphemes("👍");
    expect(g).toEqual(["👍"]);
  });

  it("splitGraphemes keeps skin-tone emoji as ONE grapheme", () => {
    // 👍🏽 is a base emoji + skin-tone modifier
    const g = splitGraphemes("👍🏽");
    expect(g.length).toBe(1);
    expect(g[0]).toBe("👍🏽");
  });

  it("splitGraphemes keeps ZWJ family as ONE grapheme", () => {
    // 👨‍👩‍👧 is man + ZWJ + woman + ZWJ + girl
    const g = splitGraphemes("👨‍👩‍👧");
    expect(g.length).toBe(1);
  });

  it("backspace on emoji deletes the whole emoji", () => {
    const s = createComposerState("👍", 1);
    const next = backspace(s);
    expect(next.text).toBe("");
    expect(next.caret).toBe(0);
  });

  it("backspace on skin-tone emoji deletes the whole grapheme", () => {
    const s = createComposerState("👍🏽", 1);
    const next = backspace(s);
    expect(next.text).toBe("");
    expect(next.caret).toBe(0);
  });

  it("backspace on mixed text + emoji", () => {
    const s = createComposerState("hi👍", 3);
    const next = backspace(s);
    expect(next.text).toBe("hi");
    expect(next.caret).toBe(2);
  });

  it("backspace on accented Unicode does not leave broken characters", () => {
    // é can be a single code unit (U+00E9) or decomposed (e + combining accent)
    // Either way, backspace should delete the whole grapheme
    const decomposed = "e\u0301"; // e + combining acute accent
    const g = splitGraphemes(decomposed);
    expect(g.length).toBe(1);
    const s = createComposerState(decomposed, 1);
    const next = backspace(s);
    expect(next.text).toBe("");
  });

  it("cursor movement respects grapheme boundaries with emoji", () => {
    const s = createComposerState("a👍b", 3); // after the emoji
    const left = moveLeft(s);
    expect(left.caret).toBe(2); // before the emoji
    const left2 = moveLeft(left);
    expect(left2.caret).toBe(1); // after 'a'
  });

  // ─── Paste ──────────────────────────────────────────────────────

  it("single-line paste inserts at cursor", () => {
    const s = createComposerState("hello", 2);
    const next = insertText(s, "XX");
    expect(next.text).toBe("heXXllo");
    expect(next.caret).toBe(4);
  });

  it("large paste inserts correctly", () => {
    const s = createComposerState("");
    const big = "x".repeat(1000);
    const next = insertText(s, big);
    expect(next.text).toBe(big);
    expect(next.caret).toBe(1000);
  });

  // ─── applyKeyEvent integration ──────────────────────────────────

  it("applyKeyEvent INSERT_TEXT", () => {
    const s = createComposerState("");
    const next = applyKeyEvent(s, { kind: "INSERT_TEXT", text: "hi" });
    expect(next.text).toBe("hi");
  });

  it("applyKeyEvent BACKSPACE", () => {
    const s = createComposerState("hi", 2);
    const next = applyKeyEvent(s, { kind: "BACKSPACE" });
    expect(next.text).toBe("h");
  });

  it("applyKeyEvent DELETE_WORD_LEFT", () => {
    const s = createComposerState("hello world", 11);
    const next = applyKeyEvent(s, { kind: "DELETE_WORD_LEFT" });
    expect(next.text).toBe("hello ");
  });

  it("applyKeyEvent MOVE_HOME", () => {
    const s = createComposerState("hello", 3);
    const next = applyKeyEvent(s, { kind: "MOVE_HOME" });
    expect(next.caret).toBe(0);
  });

  it("applyKeyEvent non-editing key returns same state", () => {
    const s = createComposerState("hello", 3);
    const next = applyKeyEvent(s, { kind: "SUBMIT" });
    expect(next).toBe(s);
  });
});
