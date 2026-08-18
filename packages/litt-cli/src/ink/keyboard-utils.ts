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

/** Is this Backspace or Delete? */
export function isBackspace(key: KeyInfo): boolean {
  return key.backspace === true || key.delete === true
    || (key as { delete?: boolean }).delete === true;
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
