/**
 * Input key normalization — ONE canonical layer that converts raw
 * terminal input + Ink's key object into a normalized LiTT key event.
 *
 * Architecture:
 *
 *   keyboard → terminal emulator → stdin → raw TTY → Ink useInput
 *     → normalizeKey(input, key)  ← THIS LAYER
 *     → editor command
 *     → composer state
 *     → Ink render
 *
 * Terminal escape sequences never leak past this layer. Every component
 * downstream receives a NormalizedKeyEvent with a clear `kind` and
 * optional `text` payload.
 *
 * Backspace representations:
 *   BS  = \x08 / 0x08 / ^H  (conhost, Ctrl+H, some serial/remote)
 *   DEL = \x7f / 0x7F / ^?  (Windows Terminal, xterm, iTerm2, Termux)
 *
 * NORMAL BACKSPACE ALWAYS MEANS: delete exactly one grapheme before
 * the cursor. It must NEVER trigger word deletion. Word deletion is
 * only from explicit bindings (Ctrl+W, Alt+Backspace).
 */

/** Ink's key object shape (subset we care about) */
export interface KeyInfo {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return: boolean;
  enter?: boolean;
  escape: boolean;
  tab: boolean;
  backspace: boolean;
  delete: boolean;
  ctrl: boolean;
  meta?: boolean;
  shift?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  home?: boolean;
  end?: boolean;
}

/** Canonical normalized key kinds — terminal-agnostic */
export type NormalizedKeyKind =
  | "BACKSPACE"          // delete one grapheme before cursor
  | "DELETE"             // delete one grapheme after cursor (forward)
  | "DELETE_WORD_LEFT"   // Ctrl+W / Alt+Backspace — delete one word left
  | "DELETE_TO_START"    // Ctrl+U — delete from cursor to start of line
  | "DELETE_TO_END"      // Ctrl+K — delete from cursor to end of line
  | "MOVE_LEFT"          // Left arrow — move one grapheme left
  | "MOVE_RIGHT"         // Right arrow — move one grapheme right
  | "MOVE_HOME"          // Home / Ctrl+A — move to start of line
  | "MOVE_END"           // End / Ctrl+E — move to end of line
  | "MOVE_WORD_LEFT"     // Alt+B — move one word left (future)
  | "MOVE_WORD_RIGHT"    // Alt+F — move one word right (future)
  | "SUBMIT"             // Enter / Return
  | "CANCEL"             // Ctrl+C
  | "ESCAPE"             // Escape
  | "TAB"                // Tab
  | "SHIFT_TAB"          // Shift+Tab
  | "UP"                 // Up arrow
  | "DOWN"               // Down arrow
  | "PAGE_UP"            // PgUp
  | "PAGE_DOWN"          // PgDn
  | "INSERT_TEXT"        // printable character(s) / paste
  | "UNKNOWN";           // unrecognized — ignore

/** A normalized key event — the single input type all components receive */
export interface NormalizedKeyEvent {
  kind: NormalizedKeyKind;
  /** For INSERT_TEXT: the text to insert (may be multi-char for paste) */
  text?: string;
  /** Raw input bytes for diagnostics (never used for logic) */
  raw?: string;
}

// ─── Raw byte constants ──────────────────────────────────────────────

/** DEL byte — 0x7F — what most terminals send for Backspace */
const DEL = "\u007f";
/** BS byte — 0x08 — what conhost/Ctrl+H sends */
const BS = "\b";

// ─── Raw escape sequence detection (for keys Ink may not classify) ──

// Home/End sequences across terminals
const HOME_SEQUENCES = new Set(["\x1b[H", "\x1b[1~", "\x1bOH", "\x1b[7~"]);
const END_SEQUENCES = new Set(["\x1b[F", "\x1b[4~", "\x1bOF", "\x1b[8~"]);
const DELETE_SEQUENCES = new Set(["\x1b[3~"]);

/**
 * Normalize a raw Ink input event into a canonical NormalizedKeyEvent.
 *
 * @param input - the raw input string from Ink's useInput
 * @param key - Ink's parsed key object
 */
export function normalizeKey(input: string, key: KeyInfo): NormalizedKeyEvent {
  // ─── Control key combinations (check first — they have empty input) ───

  // Ctrl+C — cancel
  if (key.ctrl && (input === "\x03" || input === "c")) {
    return { kind: "CANCEL", raw: input };
  }

  // Ctrl+W — delete word left
  if (key.ctrl && input === "w") {
    return { kind: "DELETE_WORD_LEFT", raw: input };
  }

  // Ctrl+U — delete to start of line
  if (key.ctrl && input === "u") {
    return { kind: "DELETE_TO_START", raw: input };
  }

  // Ctrl+K — delete to end of line
  if (key.ctrl && input === "k") {
    return { kind: "DELETE_TO_END", raw: input };
  }

  // Ctrl+A — move to start (Home equivalent)
  if (key.ctrl && input === "a") {
    return { kind: "MOVE_HOME", raw: input };
  }

  // Ctrl+E — move to end (End equivalent)
  if (key.ctrl && input === "e") {
    return { kind: "MOVE_END", raw: input };
  }

  // ─── Special keys (key flags from Ink) ───

  // Enter / Return
  if (key.return === true || (key as { enter?: boolean }).enter === true
      || input === "\r" || input === "\n") {
    return { kind: "SUBMIT", raw: input };
  }

  // Escape
  if (key.escape === true || input === "\u001b" || input === "\x1b") {
    return { kind: "ESCAPE", raw: input };
  }

  // Tab
  if (key.tab === true) {
    return { kind: key.shift ? "SHIFT_TAB" : "TAB", raw: input };
  }

  // Up / Down arrows
  if (key.upArrow === true) return { kind: "UP", raw: input };
  if (key.downArrow === true) return { kind: "DOWN", raw: input };

  // Left / Right arrows
  if (key.leftArrow === true) return { kind: "MOVE_LEFT", raw: input };
  if (key.rightArrow === true) return { kind: "MOVE_RIGHT", raw: input };

  // ─── Backspace ──────────────────────────────────────────────────
  // Both BS (0x08) and DEL (0x7F) mean "delete one grapheme before
  // cursor." We check key flags first, then raw bytes as fallback.
  // The length-1 guard prevents pasted text containing DEL from being
  // mistaken for a keypress.
  //
  // IMPORTANT: Alt+Backspace should be DELETE_WORD_LEFT (same as Ctrl+W)
  // but Ink may not classify it — check meta + backspace.
  if (key.meta && (key.backspace || input === DEL || input === BS)) {
    return { kind: "DELETE_WORD_LEFT", raw: input };
  }
  if (key.backspace === true || (input.length === 1 && (input === DEL || input === BS))) {
    return { kind: "BACKSPACE", raw: input };
  }

  // ─── Delete (forward delete) ────────────────────────────────────
  // Ink classifies ESC [ 3 ~ as key.delete. Also check raw sequence.
  if (key.delete === true || DELETE_SEQUENCES.has(input)) {
    return { kind: "DELETE", raw: input };
  }

  // ─── Home / End (raw escape sequences — Ink may not classify) ───
  if (key.home === true || HOME_SEQUENCES.has(input)) {
    return { kind: "MOVE_HOME", raw: input };
  }
  if (key.end === true || END_SEQUENCES.has(input)) {
    return { kind: "MOVE_END", raw: input };
  }

  // Page Up / Down
  if (key.pageUp === true) return { kind: "PAGE_UP", raw: input };
  if (key.pageDown === true) return { kind: "PAGE_DOWN", raw: input };

  // ─── Printable text / paste ─────────────────────────────────────
  // Must NOT be a control key, meta key, or special key. Paste arrives
  // as multi-char input. Single-char printable is normal typing.
  if (input && !key.ctrl && !key.meta
      && !key.return && !key.escape && !key.tab
      && !key.backspace && !key.delete
      && !key.upArrow && !key.downArrow
      && !key.leftArrow && !key.rightArrow) {
    // Filter out control characters (0x00-0x1F except \t which is tab)
    const code = input.charCodeAt(0);
    if (input.length > 1 || (code >= 0x20 && code !== 0x7f)) {
      return { kind: "INSERT_TEXT", text: input, raw: input };
    }
  }

  return { kind: "UNKNOWN", raw: input };
}

// ─── Diagnostic helpers (for `litt doctor input`) ───────────────────

/**
 * Describe a raw key event for diagnostics.
 * Returns a human-readable string with the normalized kind, raw
 * sequence, and hex bytes — WITHOUT exposing any secrets.
 */
export function describeKeyEvent(input: string, key: KeyInfo): string {
  const evt = normalizeKey(input, key);
  const hex = Array.from(input, ch =>
    ch.charCodeAt(0).toString(16).padStart(2, "0")
  ).join(" ");
  const seq = JSON.stringify(input);
  return `key=${evt.kind} sequence=${seq} hex=${hex}`;
}
