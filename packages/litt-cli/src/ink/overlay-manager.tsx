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
import { isEnter, isEscape, isRawF2, detectRawScrollKey, type KeyInfo } from "./keyboard-utils.js";

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

export interface OverlayKeyboardProviderProps {
  children: React.ReactNode;
  /** App-level shortcut handler (F2/K/L/C). Only active when no overlay owns keys. */
  appShortcutHandler: KeyboardHandler;
}

export function OverlayKeyboardProvider({
  children,
  appShortcutHandler,
}: OverlayKeyboardProviderProps): React.ReactElement {
  // useStdin returns PublicProps which doesn't expose internal_eventEmitter,
  // but the actual context value (Props) does. Cast to access it.
  // This is the same EventEmitter that useInput listens to for 'input' events.
  const { internal_eventEmitter } = useStdin() as unknown as { internal_eventEmitter: EventEmitter };
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
