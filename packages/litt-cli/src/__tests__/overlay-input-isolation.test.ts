/**
 * Overlay input isolation regression tests.
 *
 * Enforces the keyboard ownership contract from the live-input-blocker fix:
 *
 *   overlay === none
 *       composer/global cockpit input ACTIVE
 *       model overlay input INACTIVE
 *
 *   overlay === model-center
 *       composer input INACTIVE
 *       global submit shortcuts INACTIVE
 *       ModelCenter input ACTIVE
 *
 *   overlay === model-picker
 *       composer input INACTIVE
 *       ModelPicker input ACTIVE
 *
 * The OverlayManager uses a single useInput + an owner stack. When an
 * overlay registers, it is pushed onto the stack and receives ALL key
 * events. When no overlay is registered, the app shortcut handler
 * receives ctrl/escape keys (and F2 via the raw listener).
 *
 * These tests verify the arbitration logic without rendering Ink, by
 * simulating the register/unregister/dispatch flow that the
 * OverlayKeyboardProvider uses internally.
 *
 * Contract enforced:
 *   - one overlay handler active at a time
 *   - no composer leakage while an overlay is open
 *   - one navigation event per keypress (handler called exactly once)
 *   - focus restored after unregister (Esc close)
 *   - F2 raw detection does not fire while an overlay owns the keyboard
 */

import { describe, it, expect, vi } from "vitest";
import { isRawF2, isEnter, isEscape, isTab, isUpArrow, isDownArrow, type KeyInfo } from "../ink/keyboard-utils.js";

// ─── Simulated OverlayManager arbitration ───
// This mirrors the exact logic in overlay-manager.tsx:
//   - handlersRef: Map<id, handler>
//   - ownerStackRef: string[]
//   - dispatch: top of stack gets the event; else app handler gets ctrl/esc
//   - F2 raw listener: only fires when stack is empty

interface SimulatedOverlayManager {
  register: (id: string, handler: (input: string, key: KeyInfo) => void) => () => void;
  dispatch: (input: string, key: KeyInfo) => void;
  dispatchRaw: (data: string | Buffer) => void;
  activeOwner: () => string | null;
}

function createSimulatedOverlayManager(appHandler: (input: string, key: KeyInfo) => void): SimulatedOverlayManager {
  const handlers = new Map<string, (input: string, key: KeyInfo) => void>();
  const stack: string[] = [];

  return {
    register(id, handler) {
      handlers.set(id, handler);
      if (!stack.includes(id)) stack.push(id);
      return () => {
        handlers.delete(id);
        const idx = stack.indexOf(id);
        if (idx >= 0) stack.splice(idx, 1);
      };
    },
    dispatch(input, key) {
      const top = stack[stack.length - 1];
      if (top) {
        const h = handlers.get(top);
        if (h) { h(input, key); return; }
      }
      // No overlay — app handler gets ctrl/esc only
      if (key.ctrl || key.escape) appHandler(input, key);
    },
    dispatchRaw(data) {
      if (!isRawF2(data)) return;
      if (stack.length > 0) return; // overlay owns keyboard — F2 suppressed
      // Synthetic F2 key — app handler checks isRawF2(input)
      appHandler("\x1bOQ", {
        upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
        return: false, escape: false, tab: false, backspace: false, delete: false,
        ctrl: false, meta: false, shift: false, pageUp: false, pageDown: false,
      });
    },
    activeOwner() { return stack[stack.length - 1] ?? null; },
  };
}

function makeKey(overrides: Partial<KeyInfo> = {}): KeyInfo {
  return {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    return: false, escape: false, tab: false, backspace: false, delete: false,
    ctrl: false, meta: false, shift: false, pageUp: false, pageDown: false,
    ...overrides,
  };
}

describe("overlay input isolation", () => {
  it("no overlay → app handler receives ctrl keys, not printable chars", () => {
    const appHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    // Printable char 'a' should NOT reach app handler
    mgr.dispatch("a", makeKey());
    expect(appHandler).not.toHaveBeenCalled();

    // Ctrl+C should reach app handler
    mgr.dispatch("c", makeKey({ ctrl: true }));
    expect(appHandler).toHaveBeenCalledTimes(1);

    // Escape should reach app handler
    appHandler.mockClear();
    mgr.dispatch("\x1b", makeKey({ escape: true }));
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  it("one overlay handler active at a time", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const unregister = mgr.register("model-center", overlayHandler);
    expect(mgr.activeOwner()).toBe("model-center");

    // Any key goes to the overlay, NOT the app handler
    mgr.dispatch("a", makeKey());
    mgr.dispatch("\r", makeKey({ return: true }));
    mgr.dispatch("c", makeKey({ ctrl: true }));

    expect(overlayHandler).toHaveBeenCalledTimes(3);
    expect(appHandler).not.toHaveBeenCalled();

    unregister();
  });

  it("no composer leakage while an overlay is open", () => {
    // While model-center is open, printable chars must NOT reach the app
    // handler (which would forward to the composer). They go to the overlay.
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const unregister = mgr.register("model-center", overlayHandler);

    // Simulate typing "hello" — all should go to overlay, none to app
    for (const ch of "hello") {
      mgr.dispatch(ch, makeKey());
    }
    expect(overlayHandler).toHaveBeenCalledTimes(5);
    expect(appHandler).not.toHaveBeenCalled();

    // Enter should also go to overlay, not submit chat
    overlayHandler.mockClear();
    mgr.dispatch("\r", makeKey({ return: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);
    expect(appHandler).not.toHaveBeenCalled();

    unregister();
  });

  it("one navigation event per keypress (arrows)", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);
    const unregister = mgr.register("model-center", overlayHandler);

    // One upArrow → exactly one call
    mgr.dispatch("", makeKey({ upArrow: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    // One downArrow → exactly one call
    overlayHandler.mockClear();
    mgr.dispatch("", makeKey({ downArrow: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    unregister();
  });

  it("one Tab event per keypress", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);
    const unregister = mgr.register("model-center", overlayHandler);

    mgr.dispatch("\t", makeKey({ tab: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    unregister();
  });

  it("one Enter event per keypress", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);
    const unregister = mgr.register("model-center", overlayHandler);

    mgr.dispatch("\r", makeKey({ return: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    unregister();
  });

  it("one Esc event per keypress", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);
    const unregister = mgr.register("model-center", overlayHandler);

    mgr.dispatch("\x1b", makeKey({ escape: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    unregister();
  });

  it("focus restored after Esc close (unregister)", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const unregister = mgr.register("model-center", overlayHandler);
    expect(mgr.activeOwner()).toBe("model-center");

    // Esc closes the overlay
    mgr.dispatch("\x1b", makeKey({ escape: true }));
    expect(overlayHandler).toHaveBeenCalledTimes(1);

    // The overlay handler calls unregister (simulating onCancel)
    unregister();
    expect(mgr.activeOwner()).toBe(null);

    // Now ctrl keys go to the app handler again
    appHandler.mockClear();
    mgr.dispatch("c", makeKey({ ctrl: true }));
    expect(appHandler).toHaveBeenCalledTimes(1);

    // And printable chars go to neither (they go to TextInput)
    appHandler.mockClear();
    mgr.dispatch("a", makeKey());
    expect(appHandler).not.toHaveBeenCalled();
  });

  it("no dead keyboard after close — app handler active again", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const unregister = mgr.register("model-picker", overlayHandler);
    unregister();

    // After close, app handler should receive ctrl/esc
    mgr.dispatch("k", makeKey({ ctrl: true }));
    expect(appHandler).toHaveBeenCalledTimes(1);

    appHandler.mockClear();
    mgr.dispatch("\x1b", makeKey({ escape: true }));
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  it("no duplicate listener — registering same id twice does not stack", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    // First registration
    const unsub1 = mgr.register("model-center", overlayHandler);
    // Second registration with same id (should not duplicate on stack)
    const overlayHandler2 = vi.fn();
    const unsub2 = mgr.register("model-center", overlayHandler2);

    // Only one key event delivered (to the latest handler)
    mgr.dispatch("\r", makeKey({ return: true }));
    expect(overlayHandler).not.toHaveBeenCalled();
    expect(overlayHandler2).toHaveBeenCalledTimes(1);

    unsub1();
    unsub2();
  });

  it("F2 does not fire while an overlay owns the keyboard", () => {
    const appHandler = vi.fn();
    const overlayHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const unregister = mgr.register("model-center", overlayHandler);

    // Press F2 — should be suppressed because model-center is open
    mgr.dispatchRaw("\x1bOQ");
    expect(appHandler).not.toHaveBeenCalled();
    expect(overlayHandler).not.toHaveBeenCalled(); // F2 raw listener doesn't forward to overlay

    unregister();
  });

  it("F2 fires when no overlay owns the keyboard", () => {
    const appHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    // No overlay open — F2 should reach the app handler
    mgr.dispatchRaw("\x1bOQ");
    expect(appHandler).toHaveBeenCalledTimes(1);
    // The app handler receives the F2 escape sequence as input
    expect(appHandler.mock.calls[0][0]).toBe("\x1bOQ");
    expect(isRawF2(appHandler.mock.calls[0][0])).toBe(true);
  });

  it("F2 fires with all terminal escape sequence variants", () => {
    const appHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    const variants = ["\x1bOQ", "\x1b[12~", "\x1b[Q", "\x1bQ", "\x1b[[B"];
    for (const v of variants) {
      appHandler.mockClear();
      mgr.dispatchRaw(v);
      expect(appHandler).toHaveBeenCalledTimes(1);
    }
  });

  it("model-picker and model-center are mutually exclusive keyboard owners", () => {
    const appHandler = vi.fn();
    const centerHandler = vi.fn();
    const pickerHandler = vi.fn();
    const mgr = createSimulatedOverlayManager(appHandler);

    // Open model-center
    const unsubCenter = mgr.register("model-center", centerHandler);
    expect(mgr.activeOwner()).toBe("model-center");

    // Open model-picker on top (e.g. user typed /model while center was open)
    const unsubPicker = mgr.register("model-picker", pickerHandler);
    expect(mgr.activeOwner()).toBe("model-picker");

    // Keys go to picker, not center
    mgr.dispatch("\r", makeKey({ return: true }));
    expect(pickerHandler).toHaveBeenCalledTimes(1);
    expect(centerHandler).not.toHaveBeenCalled();

    // Close picker — center is active again
    unsubPicker();
    expect(mgr.activeOwner()).toBe("model-center");

    centerHandler.mockClear();
    mgr.dispatch("\r", makeKey({ return: true }));
    expect(centerHandler).toHaveBeenCalledTimes(1);

    unsubCenter();
  });
});

// ─── Verify the key helpers used by overlays are exact (no double-fire) ───
describe("overlay key helpers exactness", () => {
  it("isTab is true for tab and only tab", () => {
    expect(isTab(makeKey({ tab: true }))).toBe(true);
    expect(isTab(makeKey())).toBe(false);
    expect(isTab(makeKey({ return: true }))).toBe(false);
  });

  it("isEnter is true for return and only return", () => {
    expect(isEnter(makeKey({ return: true }), "")).toBe(true);
    expect(isEnter(makeKey(), "\r")).toBe(true);
    expect(isEnter(makeKey(), "a")).toBe(false);
  });

  it("isEscape is true for escape and only escape", () => {
    expect(isEscape(makeKey({ escape: true }), "")).toBe(true);
    expect(isEscape(makeKey(), "\x1b")).toBe(true);
    expect(isEscape(makeKey(), "a")).toBe(false);
  });

  it("isUpArrow / isDownArrow are mutually exclusive", () => {
    expect(isUpArrow(makeKey({ upArrow: true }))).toBe(true);
    expect(isDownArrow(makeKey({ upArrow: true }))).toBe(false);
    expect(isDownArrow(makeKey({ downArrow: true }))).toBe(true);
    expect(isUpArrow(makeKey({ downArrow: true }))).toBe(false);
  });
});
