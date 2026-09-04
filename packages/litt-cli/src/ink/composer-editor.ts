/**
 * ComposerEditor — the single canonical editor-state implementation for
 * the LiTT composer input line.
 *
 * Responsible for:
 *   - text content
 *   - cursor position (grapheme-aware)
 *   - insertion (typing + paste)
 *   - Backspace (grapheme-safe — deletes ONE grapheme, never a word)
 *   - Delete (forward delete — one grapheme after cursor)
 *   - move left / right (grapheme-aware)
 *   - Home / End
 *   - delete word (Ctrl+W / Alt+Backspace — explicit only)
 *   - delete to start (Ctrl+U)
 *   - delete to end (Ctrl+K)
 *   - clear / reset
 *   - submit (returns text, does not mutate state)
 *
 * All operations are grapheme-safe using Intl.Segmenter where available,
 * with a safe UTF-16 fallback. Emoji, skin-tone modifiers, and accented
 * Unicode are never corrupted.
 *
 * This module is PURE — it has no React, no Ink, no terminal dependencies.
 * It is fully testable without mounting any component.
 */

import type { NormalizedKeyEvent } from "./input-keys.js";

// ─── Grapheme segmentation ───────────────────────────────────────────

/**
 * Intl.Segmenter with granularity: "grapheme" splits a string into
 * user-perceived characters (grapheme clusters). This correctly handles:
 *   - emoji (👍 is ONE grapheme)
 *   - skin-tone modifiers (👍🏽 is ONE grapheme)
 *   - ZWJ sequences (👨‍👩‍👧 is ONE grapheme)
 *   - accented Unicode (é can be ONE grapheme even if 2 code units)
 *
 * Fallback: if Intl.Segmenter is unavailable (old Node), we use a
 * surrogate-pair-aware split that at least keeps surrogate pairs intact.
 */

let _segmenter: Intl.Segmenter | null | undefined;

function getSegmenter(): Intl.Segmenter | null {
  if (_segmenter !== undefined) return _segmenter;
  try {
    _segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  } catch {
    _segmenter = null;
  }
  return _segmenter;
}

/** Split a string into grapheme clusters (user-perceived characters) */
export function splitGraphemes(str: string): string[] {
  const seg = getSegmenter();
  if (seg) {
    return Array.from(seg.segment(str), (s) => s.segment);
  }
  // Fallback: surrogate-pair-aware split
  const result: string[] = [];
  for (let i = 0; i < str.length; ) {
    const code = str.charCodeAt(i);
    // High surrogate (0xD800-0xDBFF) — take two code units
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        result.push(str.slice(i, i + 2));
        i += 2;
        continue;
      }
    }
    result.push(str[i]);
    i += 1;
  }
  return result;
}

// ─── Editor state ────────────────────────────────────────────────────

export interface ComposerState {
  /** The text content (as a string — internally managed via graphemes) */
  text: string;
  /** Cursor position in GRAPHEME index (not code-unit index) */
  caret: number;
}

export function createComposerState(text = "", caret?: number): ComposerState {
  const graphemes = splitGraphemes(text);
  return {
    text,
    caret: caret !== undefined ? Math.min(caret, graphemes.length) : graphemes.length,
  };
}

// ─── Editor operations ───────────────────────────────────────────────

/**
 * Clamp a caret into the valid range for its text.
 *
 * Defense in depth. The component is responsible for keeping the caret
 * reconciled with the controlled value (see ink/shell/composer.tsx), but
 * a caret that has drifted past the end must never be able to turn
 * Backspace into a silent no-op — that is the exact reported failure:
 * `{ text: "abc", caret: 9 }` would decrement the caret three times
 * before the first character disappeared.
 */
export function clampCaret(state: ComposerState): ComposerState {
  const max = splitGraphemes(state.text).length;
  if (state.caret >= 0 && state.caret <= max) return state;
  return { text: state.text, caret: state.caret < 0 ? 0 : max };
}

/**
 * Apply a normalized key event to the editor state.
 * Returns a NEW state (immutable — never mutates the input).
 *
 * The incoming caret is clamped first: every operation below is defined
 * only for a caret inside the text, and an out-of-range one silently
 * turns edits into no-ops instead of failing loudly.
 */
export function applyKeyEvent(rawState: ComposerState, evt: NormalizedKeyEvent): ComposerState {
  const state = clampCaret(rawState);
  switch (evt.kind) {
    case "INSERT_TEXT":
      return insertText(state, evt.text ?? "");
    case "BACKSPACE":
      return backspace(state);
    case "DELETE":
      return deleteForward(state);
    case "DELETE_WORD_LEFT":
      return deleteWordLeft(state);
    case "DELETE_TO_START":
      return deleteToStart(state);
    case "DELETE_TO_END":
      return deleteToEnd(state);
    case "MOVE_LEFT":
      return moveLeft(state);
    case "MOVE_RIGHT":
      return moveRight(state);
    case "MOVE_HOME":
      return moveHome(state);
    case "MOVE_END":
      return moveEnd(state);
    default:
      // SUBMIT, CANCEL, ESCAPE, TAB, UP, DOWN, etc. are handled by the
      // component (they have side effects beyond text editing).
      return state;
  }
}

/** Insert text at the cursor position (typing or paste) */
export function insertText(state: ComposerState, text: string): ComposerState {
  if (!text) return state;
  const graphemes = splitGraphemes(state.text);
  const insertGraphemes = splitGraphemes(text);
  const before = graphemes.slice(0, state.caret);
  const after = graphemes.slice(state.caret);
  const next = [...before, ...insertGraphemes, ...after];
  return {
    text: next.join(""),
    caret: state.caret + insertGraphemes.length,
  };
}

/** Backspace — delete exactly ONE grapheme before the cursor */
export function backspace(state: ComposerState): ComposerState {
  if (state.caret <= 0) return state;
  const graphemes = splitGraphemes(state.text);
  const next = [...graphemes.slice(0, state.caret - 1), ...graphemes.slice(state.caret)];
  return {
    text: next.join(""),
    caret: state.caret - 1,
  };
}

/** Forward delete — delete ONE grapheme after the cursor */
export function deleteForward(state: ComposerState): ComposerState {
  const graphemes = splitGraphemes(state.text);
  if (state.caret >= graphemes.length) return state;
  const next = [...graphemes.slice(0, state.caret), ...graphemes.slice(state.caret + 1)];
  return {
    text: next.join(""),
    caret: state.caret,
  };
}

/**
 * Delete one word to the left of the cursor (Ctrl+W / Alt+Backspace).
 * A "word" is a run of non-whitespace characters. Leading whitespace
 * before the word is also consumed (matching common terminal behavior).
 */
export function deleteWordLeft(state: ComposerState): ComposerState {
  if (state.caret <= 0) return state;
  const graphemes = splitGraphemes(state.text);
  let i = state.caret;

  // Skip whitespace going left
  while (i > 0 && /\s/.test(graphemes[i - 1])) i--;
  // Skip non-whitespace going left
  while (i > 0 && !/\s/.test(graphemes[i - 1])) i--;

  const next = [...graphemes.slice(0, i), ...graphemes.slice(state.caret)];
  return {
    text: next.join(""),
    caret: i,
  };
}

/** Delete from cursor to start of line (Ctrl+U) */
export function deleteToStart(state: ComposerState): ComposerState {
  if (state.caret <= 0) return state;
  const graphemes = splitGraphemes(state.text);
  return {
    text: graphemes.slice(state.caret).join(""),
    caret: 0,
  };
}

/** Delete from cursor to end of line (Ctrl+K) */
export function deleteToEnd(state: ComposerState): ComposerState {
  const graphemes = splitGraphemes(state.text);
  if (state.caret >= graphemes.length) return state;
  return {
    text: graphemes.slice(0, state.caret).join(""),
    caret: state.caret,
  };
}

/** Move cursor one grapheme left */
export function moveLeft(state: ComposerState): ComposerState {
  if (state.caret <= 0) return state;
  return { ...state, caret: state.caret - 1 };
}

/** Move cursor one grapheme right */
export function moveRight(state: ComposerState): ComposerState {
  const graphemes = splitGraphemes(state.text);
  if (state.caret >= graphemes.length) return state;
  return { ...state, caret: state.caret + 1 };
}

/** Move cursor to start (Home / Ctrl+A) */
export function moveHome(state: ComposerState): ComposerState {
  return { ...state, caret: 0 };
}

/** Move cursor to end (End / Ctrl+E) */
export function moveEnd(state: ComposerState): ComposerState {
  const graphemes = splitGraphemes(state.text);
  return { ...state, caret: graphemes.length };
}

/** Clear all text and reset cursor */
export function clear(state: ComposerState): ComposerState {
  return { text: "", caret: 0 };
}

// ─── Utility ─────────────────────────────────────────────────────────

/** Convert a grapheme caret index to a code-unit index (for rendering) */
export function graphemeToCodeUnit(text: string, graphemeIndex: number): number {
  const graphemes = splitGraphemes(text);
  let pos = 0;
  for (let i = 0; i < graphemeIndex && i < graphemes.length; i++) {
    pos += graphemes[i].length;
  }
  return pos;
}

/** Convert a code-unit index to a grapheme index */
export function codeUnitToGrapheme(text: string, codeUnitIndex: number): number {
  const graphemes = splitGraphemes(text);
  let pos = 0;
  let gIdx = 0;
  for (; gIdx < graphemes.length; gIdx++) {
    if (pos + graphemes[gIdx].length > codeUnitIndex) break;
    pos += graphemes[gIdx].length;
  }
  return gIdx;
}
