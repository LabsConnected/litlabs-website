/**
 * terminal-teardown — the ONE place LiTT returns the terminal to a
 * known-good state.
 *
 * Why this module exists
 * ----------------------
 * LiTT is a TUI. It (via Ink) puts the terminal into raw mode, hides the
 * native cursor, and enables bracketed-paste mode. If the process dies on
 * a path that skips Ink's React cleanup — `process.exit()` from the SIGINT
 * handler, SIGTERM, an uncaught exception, a cancelled agent run — those
 * modes leak into the parent shell. The user then sees escape sequences
 * echoed into PowerShell (`[<35;9;1M`, `[200~…`) or a shell with no
 * cursor and no line editing.
 *
 * The mouse-reporting modes (1000/1002/1003/1005/1006/1015/1016) are
 * disabled here too even though LiTT never enables them. Terminal modes
 * are global process-external state: whoever leaves them on poisons the
 * shell, and a TUI that exits should hand back a terminal it would be
 * happy to start in. Disabling a mode that is already off is a no-op on
 * every terminal, so this costs nothing and closes the whole class of bug.
 *
 * What is NOT reset unconditionally, and why
 * ------------------------------------------
 *   - Alternate screen (`?1049l`) — only when LiTT actually entered it
 *     (`markAlternateScreenEntered()`). Leaving the alt screen we never
 *     entered would restore a saved cursor position we never saved.
 *   - Kitty keyboard protocol pop (`CSI < u`) — only when LiTT pushed
 *     (`markKittyProtocolPushed()`). The kitty flags are a *stack*: an
 *     unconditional pop would clobber a push made by the parent program
 *     that launched us. Ink pops its own push on unmount.
 *
 * Idempotency
 * -----------
 * `restoreTerminal()` re-emits the full sequence every time it is called
 * and never throws. It is deliberately NOT once-only: a "first call wins"
 * guard would let an early call (say, an error boundary) silently disarm
 * the real teardown that runs later. Emitting the disable sequences twice
 * is harmless; skipping them once is not.
 */

/** Mouse reporting modes, in the order a reset should clear them. */
export const MOUSE_DISABLE_SEQUENCES = [
  "\x1b[?1000l", // X11 normal tracking (button press/release)
  "\x1b[?1001l", // highlight tracking
  "\x1b[?1002l", // button-event tracking (drag)
  "\x1b[?1003l", // any-event tracking (all motion)
  "\x1b[?1004l", // focus in/out reporting
  "\x1b[?1005l", // UTF-8 extended coordinates
  "\x1b[?1006l", // SGR extended coordinates
  "\x1b[?1015l", // urxvt extended coordinates
  "\x1b[?1016l", // SGR pixel coordinates
] as const;

/** Bracketed paste — Ink enables this via usePaste(). */
export const BRACKETED_PASTE_DISABLE = "\x1b[?2004l";
/** Show the native cursor — Ink hides it while the software cursor renders. */
export const SHOW_CURSOR = "\x1b[?25h";
/** Leave the alternate screen buffer. */
export const EXIT_ALTERNATE_SCREEN = "\x1b[?1049l";
/** Pop the kitty keyboard protocol flags LiTT pushed. */
export const KITTY_PROTOCOL_POP = "\x1b[<u";
/** Reset pending SGR attributes so no stray color bleeds into the prompt. */
export const RESET_ATTRIBUTES = "\x1b[0m";

export interface RestoreOptions {
  /** Emit `?1049l`. Defaults to whatever `markAlternateScreenEntered()` recorded. */
  alternateScreen?: boolean;
  /** Emit `CSI < u`. Defaults to whatever `markKittyProtocolPushed()` recorded. */
  kittyProtocol?: boolean;
}

/** Minimal shape of the streams we touch — keeps this unit-testable. */
export interface TerminalStreams {
  stdout: { isTTY?: boolean; write(chunk: string): unknown };
  stdin: { isTTY?: boolean; setRawMode?(mode: boolean): unknown };
}

let alternateScreenEntered = false;
let kittyProtocolPushed = false;
let restoreCount = 0;

/** Record that LiTT switched to the alternate screen buffer. */
export function markAlternateScreenEntered(entered = true): void {
  alternateScreenEntered = entered;
}

/** Record that LiTT pushed kitty keyboard protocol flags. */
export function markKittyProtocolPushed(pushed = true): void {
  kittyProtocolPushed = pushed;
}

/** How many times restoreTerminal() has run. Diagnostics + tests only. */
export function getRestoreCount(): number {
  return restoreCount;
}

/** Reset module state. Tests only. */
export function resetTerminalTeardownStateForTests(): void {
  alternateScreenEntered = false;
  kittyProtocolPushed = false;
  restoreCount = 0;
}

/**
 * Build the escape-sequence payload for a restore. Pure — no I/O.
 */
export function buildRestoreSequence(options: RestoreOptions = {}): string {
  const alt = options.alternateScreen ?? alternateScreenEntered;
  const kitty = options.kittyProtocol ?? kittyProtocolPushed;

  const parts: string[] = [...MOUSE_DISABLE_SEQUENCES, BRACKETED_PASTE_DISABLE];
  if (kitty) parts.push(KITTY_PROTOCOL_POP);
  if (alt) parts.push(EXIT_ALTERNATE_SCREEN);
  parts.push(SHOW_CURSOR, RESET_ATTRIBUTES);

  return parts.join("");
}

/**
 * Return the terminal to a known-good state.
 *
 * Never throws. Safe to call any number of times, from any exit path.
 * Returns true when a restore payload was written to a TTY.
 */
export function restoreTerminal(
  options: RestoreOptions = {},
  streams: TerminalStreams = process as unknown as TerminalStreams,
): boolean {
  restoreCount++;

  // Raw mode first: even if the write below fails, the parent shell gets
  // its line discipline back.
  try {
    const { stdin } = streams;
    if (stdin?.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
  } catch {
    // best-effort — a detached/closed stdin must not break teardown
  }

  try {
    const { stdout } = streams;
    if (!stdout?.isTTY) return false;
    stdout.write(buildRestoreSequence(options));
    return true;
  } catch {
    // best-effort — stdout may already be closed on the exit path
    return false;
  }
}

/** Process-ish surface we hook. Injectable so tests never touch the real process. */
export interface TeardownProcess {
  on(event: string, listener: (...args: never[]) => void): unknown;
  off?(event: string, listener: (...args: never[]) => void): unknown;
  removeListener?(event: string, listener: (...args: never[]) => void): unknown;
  exit?(code?: number): unknown;
}

/**
 * Signals that terminate the process and therefore must restore the
 * terminal first. SIGINT is deliberately absent: LiTT's RuntimeSession
 * owns SIGINT (Ctrl+C cancels a running agent rather than exiting) and
 * calls restoreTerminal() itself on the paths that do exit. Registering a
 * competing SIGINT listener here would also be futile — RuntimeSession
 * calls process.removeAllListeners("SIGINT") when it installs its handler.
 */
export const TEARDOWN_SIGNALS = ["SIGTERM", "SIGHUP", "SIGBREAK", "SIGQUIT"] as const;

export interface InstallTeardownOptions {
  streams?: TerminalStreams;
  proc?: TeardownProcess;
}

/**
 * Install terminal teardown on every process exit path.
 *
 * Covers: normal exit (`exit`), process.exit() from anywhere (also `exit`),
 * SIGTERM/SIGHUP/SIGBREAK/SIGQUIT, uncaught exceptions and unhandled
 * rejections. Returns a disposer that removes every listener it added.
 */
export function installTerminalTeardown(
  options: InstallTeardownOptions = {},
): () => void {
  const proc = options.proc ?? (process as unknown as TeardownProcess);
  const streams = options.streams;
  const registered: Array<[string, (...args: never[]) => void]> = [];

  const restore = (): void => {
    restoreTerminal({}, streams ?? (process as unknown as TerminalStreams));
  };

  const add = (event: string, listener: (...args: never[]) => void): void => {
    proc.on(event, listener);
    registered.push([event, listener]);
  };

  add("exit", restore);

  for (const signal of TEARDOWN_SIGNALS) {
    add(signal, (() => {
      restore();
      // Re-signalling ourselves would need the default disposition back;
      // exiting with the conventional 128+n code is the portable choice
      // (and SIGBREAK/SIGQUIT have no default action on Windows).
      proc.exit?.(signalExitCode(signal));
    }) as (...args: never[]) => void);
  }

  add("uncaughtException", ((error: unknown) => {
    restore();
    // Restore first, THEN let the failure be seen. Printing before the
    // reset would render the stack into a raw-mode terminal.
    console.error(error);
    proc.exit?.(1);
  }) as unknown as (...args: never[]) => void);

  add("unhandledRejection", ((reason: unknown) => {
    restore();
    console.error(reason);
    proc.exit?.(1);
  }) as unknown as (...args: never[]) => void);

  return () => {
    for (const [event, listener] of registered) {
      const remove = proc.off ?? proc.removeListener;
      remove?.call(proc, event, listener);
    }
    registered.length = 0;
  };
}

/** 128 + signal number, the conventional shell exit code. */
export function signalExitCode(signal: string): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGQUIT":
      return 131;
    case "SIGTERM":
      return 143;
    case "SIGBREAK":
      return 149;
    default:
      return 1;
  }
}
