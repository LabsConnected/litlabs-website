/**
 * Keyboard utilities — robust key detection across all terminals.
 *
 * Windows Terminal, macOS Terminal, and Linux terminals all send
 * slightly different byte sequences for the same keys. These helpers
 * normalize detection so we never miss an Enter or Esc.
 *
 * The golden rule: NEVER depend on `input === "\r"` alone.
 * Some terminals send `\r`, some send `\n`, some send `\r\n`.
 * Ink's `key.return` is usually reliable but not guaranteed on
 * every Windows Terminal configuration. We check both.
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

/**
 * Is this an Enter/Return keypress?
 * Checks key.return, key.enter (if exposed), and raw input \r / \n.
 */
export function isEnter(key: KeyInfo, input: string): boolean {
  return key.return === true || (key as { enter?: boolean }).enter === true
    || input === "\r" || input === "\n" || input === "\r\n";
}

/** Is this an Escape keypress? */
export function isEscape(key: KeyInfo, input: string): boolean {
  return key.escape === true || input === "\u001b" || input === "\x1b";
}

/** Is this the Tab key? (not shift+tab) */
export function isTab(key: KeyInfo): boolean {
  return key.tab === true;
}

/** Is this Up arrow? */
export function isUpArrow(key: KeyInfo): boolean {
  return key.upArrow === true;
}

/** Is this Down arrow? */
export function isDownArrow(key: KeyInfo): boolean {
  return key.downArrow === true;
}

/**
 * Raw bytes that mean "erase the character before the caret".
 *   0x7F (DEL) — what a physical Backspace sends on Windows Terminal,
 *                macOS Terminal, iTerm2 and every xterm-family terminal.
 *   0x08 (BS)  — what conhost/Ctrl+H and some remote/serial sessions send.
 */
const BACKSPACE_BYTES = new Set(["\u007f", "\b"]);

/**
 * Is this Backspace or Delete?
 *
 * Ink classifies both 0x7F and 0x08 as `key.backspace`, and `ESC [ 3 ~`
 * as `key.delete` — so the key flags are the primary signal.
 *
 * The optional `input` is a deliberate second line of defense. `key`
 * alone means we are fully at the mercy of Ink's parser: if a chunk ever
 * reaches us unclassified (an unrecognized terminal, a partially-parsed
 * escape chunk, a future Ink change), every backspace becomes a silent
 * no-op and the composer simply stops erasing — the exact failure this
 * function exists to prevent. Matching the raw byte too costs nothing
 * and makes that failure mode unreachable.
 *
 * The length-1 guard keeps pasted text that happens to contain a DEL
 * byte from being mistaken for a keypress.
 */
export function isBackspace(key: KeyInfo, input?: string): boolean {
  if (key.backspace === true || key.delete === true) return true;
  return input !== undefined && input.length === 1 && BACKSPACE_BYTES.has(input);
}

/** Is this a Ctrl+key combination? */
export function isCtrl(input: string, key: KeyInfo, ch: string): boolean {
  return key.ctrl === true && input === ch;
}

// ─── Function key detection (raw escape sequences) ───
// Ink's useInput strips function-key input to '' because F-keys are in
// nonAlphanumericKeys. The key object has no f1/f2/... fields. So we must
// detect F-keys from the RAW stdin data before Ink processes it.
//
// F2 escape sequences across terminals:
//   \x1bOQ     — xterm/gnome (most common: Windows Terminal, iTerm2, gnome)
//   \x1b[12~   — xterm/rxvt (vt220-style)
//   \x1b[Q     — xterm ESC [ letter variant
//   \x1bQ      — xterm ESC letter variant
//   \x1b[[B    — Cygwin

/** F2 raw escape sequences (checked against raw stdin data) */
const F2_SEQUENCES = [
  "\x1bOQ",
  "\x1b[12~",
  "\x1b[Q",
  "\x1bQ",
  "\x1b[[B",
];

/** Check if raw stdin data is an F2 keypress */
export function isRawF2(data: string | Buffer): boolean {
  const s = typeof data === "string" ? data : data.toString("utf8");
  return F2_SEQUENCES.includes(s);
}

// ─── Scroll key detection (raw escape sequences) ───
// Ink's useInput may not reliably detect PgUp/PgDn/Home/End on all
// terminals (same issue as F2). We detect them from raw stdin data.
//
// Escape sequences across terminals:
//   PgUp:   \x1b[5~   (xterm/rxvt/vt220)
//   PgDn:   \x1b[6~   (xterm/rxvt/vt220)
//   Home:   \x1b[H    \x1b[1~   \x1bOH   (xterm normal/app mode, vt220)
//   End:    \x1b[F    \x1b[4~   \x1bOF   (xterm normal/app mode, vt220)
//   Ctrl+Home: \x1b[1;5H  \x1b[5H  (xterm modifier encoding)
//   Ctrl+End:  \x1b[1;5F  \x1b[5F  (xterm modifier encoding)

const PGUP_SEQUENCES = ["\x1b[5~"];
const PGDN_SEQUENCES = ["\x1b[6~"];
const HOME_SEQUENCES = ["\x1b[H", "\x1b[1~", "\x1bOH", "\x1b[7~"];
const END_SEQUENCES = ["\x1b[F", "\x1b[4~", "\x1bOF", "\x1b[8~"];
const CTRL_HOME_SEQUENCES = ["\x1b[1;5H", "\x1b[5H"];
const CTRL_END_SEQUENCES = ["\x1b[1;5F", "\x1b[5F"];

/** Raw scroll key type */
export type RawScrollKey = "pageUp" | "pageDown" | "home" | "end" | "ctrlHome" | "ctrlEnd";

/** Detect scroll keys from raw stdin data. Returns the key type or null. */
export function detectRawScrollKey(data: string | Buffer): RawScrollKey | null {
  const s = typeof data === "string" ? data : data.toString("utf8");
  if (PGUP_SEQUENCES.includes(s)) return "pageUp";
  if (PGDN_SEQUENCES.includes(s)) return "pageDown";
  if (CTRL_HOME_SEQUENCES.includes(s)) return "ctrlHome";
  if (CTRL_END_SEQUENCES.includes(s)) return "ctrlEnd";
  if (HOME_SEQUENCES.includes(s)) return "home";
  if (END_SEQUENCES.includes(s)) return "end";
  return null;
}

/**
 * Is this a printable character (not a control key, not a special key)?
 * Used to determine if input should go to a text field.
 */
export function isPrintable(input: string, key: KeyInfo): boolean {
  if (key.ctrl || key.meta) return false;
  if (key.return || key.escape || key.tab || key.backspace || key.delete) return false;
  if (key.upArrow || key.downArrow) return false;
  if (input.length !== 1) return false;
  // Control characters (0x00-0x1F, 0x7F)
  const code = input.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) return false;
  return true;
}
