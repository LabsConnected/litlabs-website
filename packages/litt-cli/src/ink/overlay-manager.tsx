/**
 * OverlayManager — single keyboard owner for the entire cockpit.
 *
 * Architecture:
 *
 *   Keyboard
 *      ↓
 *   OverlayManager (single useInput)
 *      ├─ Model Picker owns keys  (when overlay = "model-picker")
 *      ├─ Model Center owns keys  (when overlay = "model-center")
 *      ├─ Command Palette owns keys (when overlay = "command-palette")
 *      ├─ Approval owns keys      (when approval prompt is active)
 *      └─ No overlay → app shortcuts only (Ctrl+M/K/L/C)
 *
 * When an overlay is open, the prompt underneath receives ZERO keyboard
 * events. The CommandDock (and its TextInput) is unmounted during
 * overlays, so there is no competing useInput.
 *
 * Each overlay registers its key handler via useOverlayKeyboard().
 * The OverlayManager's single useInput dispatches to the active handler.
 */

import React, { createContext, useContext, useCallback, useRef, useEffect } from "react";
import { useInput } from "ink";
import { isEnter, isEscape, type KeyInfo } from "./keyboard-utils.js";

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
  /** App-level shortcut handler (Ctrl+M/K/L/C). Only active when no overlay owns keys. */
  appShortcutHandler: KeyboardHandler;
}

export function OverlayKeyboardProvider({
  children,
  appShortcutHandler,
}: OverlayKeyboardProviderProps): React.ReactElement {
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

  // SINGLE useInput for the entire app
  useInput(useCallback((input: string, key: { upArrow: boolean; downArrow: boolean; leftArrow: boolean; rightArrow: boolean; return: boolean; escape: boolean; tab: boolean; backspace: boolean; delete: boolean; ctrl: boolean; meta: boolean; shift: boolean; pageUp: boolean; pageDown: boolean }) => {
    const keyInfo: KeyInfo = key;
    const stack = ownerStackRef.current;
    const topOwner = stack[stack.length - 1];

    if (topOwner) {
      // An overlay owns the keyboard — dispatch ONLY to it
      const handler = handlersRef.current.get(topOwner);
      if (handler) {
        handler(input, keyInfo);
        return;
      }
    }

    // No overlay — dispatch to app shortcut handler (Ctrl+M/K/L/C, Ctrl+C)
    // But only for control keys, not printable characters (those go to TextInput)
    if (keyInfo.ctrl || keyInfo.escape) {
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
