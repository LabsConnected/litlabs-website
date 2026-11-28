/**
 * OverlayManager — single keyboard owner for the entire cockpit.
 *
 * Architecture:
 *
 *   Keyboard
 *      ↓
 *   OverlayManager (single useInput + raw F2 listener)
 *      ├─ Model Picker owns keys  (when overlay = "model-picker")
 *      ├─ Model Center owns keys  (when overlay = "model-center")
 *      ├─ Command Palette owns keys (when overlay = "command-palette")
 *      ├─ Approval owns keys      (when approval prompt is active)
 *      └─ No overlay → app shortcuts only (F2/K/L/C)
 *
 * F2 detection: Ink's useInput strips function-key input to '' because
 * F-keys are in nonAlphanumericKeys and the key object has no f2 field.
 * So we listen to the raw 'input' event from Ink's internal_eventEmitter
 * to catch F2 escape sequences before they're stripped.
 *
 * When an overlay is open, the prompt underneath receives ZERO keyboard
 * events. The CommandDock (and its TextInput) is unmounted during
 * overlays, so there is no competing useInput.
 *
 * Each overlay registers its key handler via useOverlayKeyboard().
 * The OverlayManager's single useInput dispatches to the active handler.
 */

import React, { createContext, useContext, useCallback, useRef, useEffect } from "react";
import { useInput, useStdin } from "ink";
import type { EventEmitter } from "node:events";
import * as fs from "fs";
import { isRawF2, detectRawScrollKey, type KeyInfo } from "./keyboard-utils.js";

// Debug instrumentation — set LITT_KEY_DEBUG=1 to trace key events to stderr.
// Writes to stderr (NOT stdout) so it doesn't corrupt the Ink render.
const KEY_DEBUG = process.env.LITT_KEY_DEBUG === "1";
function debugKey(info: string): void {
  if (!KEY_DEBUG) return;
  process.stderr.write(`[KEY] ${info}\n`);
}

/** A keyboard handler receives (input, key) and returns true if it consumed the event */
export type KeyboardHandler = (input: string, key: KeyInfo) => void;

interface OverlayKeyboardContextValue {
  /** Register a keyboard handler. Returns an unregister function. */
  register: (id: string, handler: KeyboardHandler) => () => void;
  /** The currently active owner ID */
  activeOwner: string | null;
}

const OverlayKeyboardContext = createContext<OverlayKeyboardContextValue | null>(null);

/**
 * Installs the Esc watchdog on the raw stdin stream — wraps read() so
 * every chunk Ink's parser consumes is filtered first, and polls for
 * bytes stranded while the 'readable' listener is detached. Returns a
 * teardown that restores the original read() and stops the poll.
 *
 * Only active while isBusy() is true — idle Esc must keep flowing to
 * the parser so the composer's own useInput can clear the draft.
 */
function installEscWatchdog(
  stdin: NodeJS.ReadStream,
  isBusy: () => boolean,
  dispatchEsc: () => void,
): () => void {
  const rw = stdin as unknown as { read(size?: number): unknown; unshift(c: unknown): void };
  const origRead = rw.read.bind(stdin);
  let inFilter = false;
  const splitEsc = (chunk: unknown): unknown => {
    const s = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
    if (!isBusy()) return chunk;
    if (s === "\x1b") {
      dispatchEsc();
      return origRead() ?? null;
    }
    if (s.length > 2 && s.charCodeAt(0) === 0x1b
      && s[1] !== "[" && s[1] !== "O" && s[1] !== "\x1b") {
      inFilter = true;
      try { dispatchEsc(); } finally { inFilter = false; }
      return s.slice(1);
    }
    return chunk;
  };
  rw.read = (size?: number) => {
    const chunk = origRead(size);
    if (inFilter || chunk == null) return chunk;
    return splitEsc(chunk);
  };

  const poll = setInterval(() => {
    let chunk: unknown;
    try { chunk = origRead(); } catch { return; }
    if (chunk == null) return;
    try {
      const rest = splitEsc(chunk);
      if (rest != null) rw.unshift(rest);
    } catch { /* ignore */ }
  }, 100);
  poll.unref?.();
  return () => {
    clearInterval(poll);
    rw.read = origRead;
  };
}

export interface OverlayKeyboardProviderProps {
  children: React.ReactNode;
  /** App-level shortcut handler (F2/K/L/C). Only active when no overlay owns keys. */
  appShortcutHandler: KeyboardHandler;
  /** While true, a leading \x1b glued to text is treated as Esc + that text. */
  busyRef?: React.MutableRefObject<boolean>;
}

export function OverlayKeyboardProvider({
  children,
  appShortcutHandler,
  busyRef,
}: OverlayKeyboardProviderProps): React.ReactElement {
  // useStdin returns PublicProps which doesn't expose internal_eventEmitter,
  // but the actual context value (Props) does. Cast to access it.
  // This is the same EventEmitter that useInput listens to for 'input' events.
  const { stdin, internal_eventEmitter, isRawModeSupported } = useStdin() as unknown as {
    stdin: NodeJS.ReadStream;
    internal_eventEmitter: EventEmitter;
    isRawModeSupported: boolean;
  };
  // Map of registered handlers, keyed by owner ID
  const handlersRef = useRef<Map<string, KeyboardHandler>>(new Map());
  // Stack of owner IDs — top of stack gets the keys
  const ownerStackRef = useRef<string[]>([]);
  // The app shortcut handler (kept in a ref so it's always current)
  const appHandlerRef = useRef<KeyboardHandler>(appShortcutHandler);
  // Active owner for context consumers
  const [activeOwner, setActiveOwner] = React.useState<string | null>(null);

  useEffect(() => {
    appHandlerRef.current = appShortcutHandler;
  }, [appShortcutHandler]);

  const register = useCallback((id: string, handler: KeyboardHandler): (() => void) => {
    handlersRef.current.set(id, handler);
    // Push onto stack if not already there
    if (!ownerStackRef.current.includes(id)) {
      ownerStackRef.current.push(id);
    }
    setActiveOwner(ownerStackRef.current[ownerStackRef.current.length - 1] ?? null);

    return () => {
      handlersRef.current.delete(id);
      ownerStackRef.current = ownerStackRef.current.filter(o => o !== id);
      setActiveOwner(ownerStackRef.current[ownerStackRef.current.length - 1] ?? null);
    };
  }, []);

  const ESC_KEY: KeyInfo = {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    return: false, escape: true, tab: false, backspace: false, delete: false,
    ctrl: false, meta: false, shift: false,
    pageUp: false, pageDown: false, home: false, end: false,
  } as KeyInfo;
  const dispatchEsc = useCallback(() => {
    const stack = ownerStackRef.current;
    const top = stack[stack.length - 1];
    const handler = top ? handlersRef.current.get(top) : null;
    (handler ?? appHandlerRef.current)("\x1b", ESC_KEY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Esc watchdog ───
  // Ink 7's input parser can silently swallow a lone Esc byte on
  // Windows/ConPTY: input writes may coalesce so "\x1b" + typed text
  // reach the parser in one chunk (or while a previous \x1b is held in
  // `pending`), producing a meta-key — observed live: \x1b+'r' → meta-r,
  // Esc never fired, 'r' was eaten, "read" became "ead", and a running
  // mission kept going invisibly past its 45s deadline.
  //
  // Two-layer fix, both below the parser:
  //  1) Wrap stdin.read() — every chunk Ink's parser consumes passes
  //     this filter first. A leading \x1b glued to text (len > 2 — a
  //     real Alt+key is exactly 2 bytes) while busy is split into
  //     Esc + text; a lone \x1b dispatches Escape directly.
  //  2) A 100ms poll drains bytes that sit unread when the 'readable'
  //     listener is momentarily detached (raw-mode ref-count dips) —
  //     anything non-Esc is unshifted back untouched.
  useEffect(() => {
    if (!isRawModeSupported || !stdin || typeof stdin.read !== "function") return;
    return installEscWatchdog(stdin, () => busyRef?.current ?? false, dispatchEsc);
  }, [stdin, isRawModeSupported, busyRef, dispatchEsc]);

  // ─── F2 + scroll key raw listener ───
  // Ink's useInput strips F-key input to '' (nonAlphanumericKeys), and the
  // key object has no f2 field. So we listen to the raw 'input' event from
  // Ink's internal_eventEmitter to catch F2 escape sequences before stripping.
  // F2 opens Model Center — but ONLY when no overlay owns the keyboard.
  //
  // We also catch PgUp/PgDn/Home/End/Ctrl+Home/Ctrl+End here because Ink's
  // useInput may not reliably detect these on all terminals (same issue).
  // Scroll keys work even while busy (browsing history during a run).
  useEffect(() => {
    const onRawInput = (data: string | Buffer) => {
      const s = typeof data === "string" ? data : data.toString("utf8");
      const stack = ownerStackRef.current;
      const topOwner = stack[stack.length - 1] ?? null;
      if (KEY_DEBUG) {
        // Log ALL raw input so we can see what F2/Tab/arrows/Enter/Esc arrive as
        debugKey(`raw input=${JSON.stringify(s)} activeOverlay=${topOwner ?? "none"}`);
      }

      // Also log to file when LITT_INPUT_DEBUG is set — for first-backspace tracing
      if (process.env.LITT_INPUT_DEBUG === "1") {
        try {
          const f = process.env.LITT_INPUT_DEBUG_FILE ?? (process.platform === "android" ? "/sdcard/litt-input-debug.log" : "./litt-input-debug.log");
          const hex = Buffer.from(s, "utf8").toString("hex");
          fs.appendFileSync(f, `[${new Date().toISOString()}] RAW input=${JSON.stringify(s)} hex=${hex} topOwner=${topOwner ?? "none"}\n`);
        } catch { /* ignore */ }
      }

      // Bare Esc — Ink's keypress parser can hold a lone \x1b waiting
      // for an escape-sequence continuation (observed live: held ~11s,
      // then merged with the next typed char into meta-r — the Esc
      // keypress NEVER fired and the running turn kept going). A raw
      // single-byte \x1b chunk is an unambiguous Escape — dispatch it
      // now. If useInput also emits escape for the same byte, the app
      // handler's busy-state guard makes the second dispatch a no-op.
      if (s === "\x1b") {
        const escKey = {
          upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
          return: false, escape: true, tab: false, backspace: false, delete: false,
          ctrl: false, meta: false, shift: false,
          pageUp: false, pageDown: false, home: false, end: false,
        } as KeyInfo;
        if (topOwner) {
          const handler = handlersRef.current.get(topOwner);
          if (handler) { handler(s, escKey); return; }
        }
        appHandlerRef.current(s, escKey);
        return;
      }

      // F2 — opens Model Center (only when no overlay is active)
      if (isRawF2(data)) {
        if (stack.length > 0) return;
        debugKey(`F2 detected → dispatching to app handler (activeOverlay=none)`);
        appHandlerRef.current("\x1bOQ", { upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, return: false, escape: false, tab: false, backspace: false, delete: false, ctrl: false, meta: false, shift: false, pageUp: false, pageDown: false } as KeyInfo);
        return;
      }

      // Scroll keys — PgUp/PgDn/Home/End/Ctrl+Home/Ctrl+End
      // Work even while busy and when no overlay is active.
      const scrollKey = detectRawScrollKey(data);
      if (scrollKey) {
        if (stack.length > 0) return; // Don't scroll while overlay is open
        debugKey(`scroll key ${scrollKey} detected → dispatching to app handler`);
        const syntheticKey: KeyInfo = {
          upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
          return: false, escape: false, tab: false, backspace: false, delete: false,
          ctrl: scrollKey === "ctrlHome" || scrollKey === "ctrlEnd",
          meta: false, shift: false,
          pageUp: scrollKey === "pageUp",
          pageDown: scrollKey === "pageDown",
          home: scrollKey === "home" || scrollKey === "ctrlHome",
          end: scrollKey === "end" || scrollKey === "ctrlEnd",
        };
        appHandlerRef.current(s, syntheticKey);
        return;
      }
    };
    internal_eventEmitter.on("input", onRawInput);
    return () => {
      internal_eventEmitter.removeListener("input", onRawInput);
    };
  }, [internal_eventEmitter]);

  // SINGLE useInput for the entire app
  useInput(useCallback((input: string, key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; return: boolean; escape: boolean; tab: boolean; backspace: boolean; delete: boolean; ctrl: boolean; meta: boolean; shift: boolean; pageUp: boolean; pageDown: boolean; home: boolean; end: boolean }) => {
    const keyInfo: KeyInfo = key;
    const stack = ownerStackRef.current;
    const topOwner = stack[stack.length - 1];

    if (KEY_DEBUG) {
      debugKey(`useInput input=${JSON.stringify(input)} return=${key.return} escape=${key.escape} tab=${key.tab} up=${key.upArrow} down=${key.downArrow} ctrl=${key.ctrl} activeOverlay=${topOwner ?? "none"}`);
    }

    // Also log to file when LITT_INPUT_DEBUG is set — for first-backspace tracing
    if (process.env.LITT_INPUT_DEBUG === "1") {
      try {
        const f = process.env.LITT_INPUT_DEBUG_FILE ?? (process.platform === "android" ? "/sdcard/litt-input-debug.log" : "./litt-input-debug.log");
        fs.appendFileSync(f, `[${new Date().toISOString()}] OVERLAY useInput input=${JSON.stringify(input)} backspace=${key.backspace} ctrl=${key.ctrl} meta=${key.meta} tab=${key.tab} escape=${key.escape} topOwner=${topOwner ?? "none"}\n`);
      } catch { /* ignore */ }
    }

    if (topOwner) {
      // An overlay owns the keyboard — dispatch ONLY to it
      const handler = handlersRef.current.get(topOwner);
      if (handler) {
        handler(input, keyInfo);
        return;
      }
    }

    // No overlay — dispatch to app shortcut handler (Ctrl+K/L/C/D/N/R/O,
    // Ctrl+C, Tab=Plan/Act, ?=help). F2 is handled by the raw listener
    // above (Ink strips F-key input). Transcript scroll keys
    // (PgUp/PgDn/Home/End) also route to the app handler; printable
    // chars and Up/Down go to the composer's useInput.
    if (keyInfo.ctrl || keyInfo.escape || keyInfo.tab
      || keyInfo.pageUp || keyInfo.pageDown || keyInfo.home || keyInfo.end) {
      appHandlerRef.current(input, keyInfo);
    }
  }, []));

  return (
    <OverlayKeyboardContext.Provider value={{ register, activeOwner }}>
      {children}
    </OverlayKeyboardContext.Provider>
  );
}

/**
 * Register a keyboard handler for an overlay.
 * The handler only receives events when this overlay is the top of the stack.
 *
 * @param id — unique owner ID (e.g. "model-picker", "command-palette")
 * @param handler — keyboard handler
 */
export function useOverlayKeyboard(id: string, handler: KeyboardHandler): void {
  const ctx = useContext(OverlayKeyboardContext);

  // Keep handler in a ref so we always call the latest version
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  });

  useEffect(() => {
    if (!ctx) return; // No provider — fall back gracefully
    return ctx.register(id, (input, key) => handlerRef.current(input, key));
  }, [id, ctx]);
}

/**
 * Check if a specific overlay is the active keyboard owner.
 */
export function useIsActiveOwner(id: string): boolean {
  const ctx = useContext(OverlayKeyboardContext);
  return ctx?.activeOwner === id;
}
