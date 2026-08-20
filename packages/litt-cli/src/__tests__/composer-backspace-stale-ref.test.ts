/**
 * Composer Backspace stale-ref regression tests.
 *
 * Root cause being tested:
 *   When multiple useInput calls fire in the SAME macrotask (same stdin
 *   read — e.g. fast typing + immediate Backspace), the Composer's
 *   valueRef/caretRef must be updated SYNCHRONOUSLY in the handler.
 *   If they are only updated in useEffect (which runs after commit),
 *   the Backspace handler reads stale refs (value="" pos=0), hits the
 *   `if (pos === 0) return` guard, and becomes a no-op.
 *
 *   Esc "fixed" the original bug because Esc arrives in a SEPARATE
 *   stdin read (separate macrotask), giving useEffect time to flush
 *   the refs. After Esc, subsequent Backspace presses worked.
 *
 * These tests simulate the Composer's input handler logic directly,
 * verifying that synchronous ref updates make Backspace work even
 * when typing and Backspace arrive in the same macrotask.
 */

import { describe, it, expect } from "vitest";
import { isBackspace, isEnter, isEscape, isPrintable, type KeyInfo } from "../ink/keyboard-utils.js";

// ─── Simulated Composer handler ───
// Mirrors the exact logic in composer.tsx's useInput callback,
// including the synchronous ref updates that fix the stale-ref bug.

interface ComposerState {
  value: string;
  caret: number;
}

function createSimulatedComposer() {
  // Refs — these represent valueRef.current and caretRef.current.
  // The bug was that these were only updated in useEffect (deferred),
  // so consecutive useInput calls in the same macrotask read stale values.
  const valueRef = { current: "" };
  const caretRef = { current: 0 };

  // React state — represents the useState setters. In the real component,
  // setCaret triggers a re-render and useEffect updates the refs.
  // We simulate the "useEffect runs after macrotask" timing by deferring
  // ref updates to a flush() call.
  let stateValue = "";
  let stateCaret = 0;
  const pendingRefUpdate = { value: "", caret: 0, dirty: false };

  function setCaret(n: number) {
    stateCaret = n;
    pendingRefUpdate.caret = n;
    pendingRefUpdate.dirty = true;
  }
  function setValue(v: string) {
    stateValue = v;
    pendingRefUpdate.value = v;
    pendingRefUpdate.dirty = true;
  }
  // Simulates useEffect running after the macrotask completes
  function flush() {
    if (pendingRefUpdate.dirty) {
      valueRef.current = pendingRefUpdate.value;
      caretRef.current = pendingRefUpdate.caret;
      pendingRefUpdate.dirty = false;
    }
  }

  // The handler — mirrors composer.tsx exactly
  function handleInput(input: string, key: KeyInfo, syncRefs: boolean) {
    const current = valueRef.current;
    const pos = caretRef.current;

    if (isEnter(key, input)) {
      const text = current.trim();
      // submit — no state change
      return;
    }

    if (isEscape(key, input)) {
      if (current) {
        setValue("");
        setCaret(0);
        if (syncRefs) {
          valueRef.current = "";
          caretRef.current = 0;
        }
      }
      return;
    }

    if (isBackspace(key)) {
      if (pos === 0) return; // ← THE BUG: returns no-op with stale pos
      const next = current.slice(0, pos - 1) + current.slice(pos);
      const nextCaret = Math.max(0, pos - 1);
      setValue(next);
      setCaret(nextCaret);
      if (syncRefs) {
        valueRef.current = next;
        caretRef.current = nextCaret;
      }
      return;
    }

    if (input && !key.ctrl && !key.meta && key.tab === false) {
      const next = current.slice(0, pos) + input + current.slice(pos);
      const nextCaret = pos + input.length;
      setValue(next);
      setCaret(nextCaret);
      if (syncRefs) {
        valueRef.current = next;
        caretRef.current = nextCaret;
      }
      return;
    }
  }

  return {
    // State accessors
    get value() { return stateValue; },
    get caret() { return stateCaret; },
    get refValue() { return valueRef.current; },
    get refCaret() { return caretRef.current; },
    // Handler with syncRefs=true (FIXED) or syncRefs=false (BUGGY)
    handleInput,
    // Flush pending useEffect ref updates
    flush,
  };
}

// ─── Key constructors ───

function printableKey(ch: string): { input: string; key: KeyInfo } {
  return { input: ch, key: makeKey({}) };
}

function backspaceKey(): { input: string; key: KeyInfo } {
  return { input: "", key: makeKey({ backspace: true }) };
}

function deleteKey(): { input: string; key: KeyInfo } {
  return { input: "", key: makeKey({ delete: true }) };
}

function escapeKey(): { input: string; key: KeyInfo } {
  return { input: "", key: makeKey({ escape: true }) };
}

function enterKey(): { input: string; key: KeyInfo } {
  return { input: "", key: makeKey({ return: true }) };
}

function makeKey(overrides: Partial<KeyInfo>): KeyInfo {
  return {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    return: false,
    escape: false,
    tab: false,
    backspace: false,
    delete: false,
    ctrl: false,
    meta: false,
    shift: false,
    pageUp: false,
    pageDown: false,
    home: false,
    end: false,
    ...overrides,
  };
}

// ─── Tests ───

describe("Composer Backspace stale-ref regression", () => {
  describe("BUGGY behavior (refs only updated in useEffect)", () => {
    it("first Backspace after typing in same macrotask is a no-op", () => {
      const c = createSimulatedComposer();
      // Ink delivers "abc" as a single useInput call (input="abc"),
      // then "\x7f" as a separate call in the SAME macrotask.
      // The printable handler updates state but NOT refs (buggy mode).
      c.handleInput("abc", printableKey("abc").key, false);
      // Backspace in SAME macrotask — refs are stale (still "")
      c.handleInput("", backspaceKey().key, false);
      // State was set to "abc" but ref was "" when backspace ran → pos=0 → no-op
      expect(c.value).toBe("abc"); // state correct
      expect(c.refValue).toBe(""); // ref stale — THIS IS THE BUG
      // After flush, refs catch up but backspace already missed
      c.flush();
      expect(c.refValue).toBe("abc");
      expect(c.value).toBe("abc"); // backspace was a no-op — "abc" not "ab"
    });

    it("Esc fixes it because it arrives in a separate macrotask", () => {
      const c = createSimulatedComposer();
      // Type "abc" in macrotask 1 (single call, as Ink delivers it)
      c.handleInput("abc", printableKey("abc").key, false);
      // Macrotask 1 ends — useEffect flushes refs
      c.flush();
      expect(c.refValue).toBe("abc");
      // Esc in macrotask 2 — refs are current
      c.handleInput("", escapeKey().key, false);
      c.flush();
      expect(c.value).toBe("");
      // Now type "xy" in macrotask 3
      c.handleInput("xy", printableKey("xy").key, false);
      c.flush();
      // Backspace in macrotask 4 — refs are current, works correctly
      c.handleInput("", backspaceKey().key, false);
      c.flush();
      expect(c.value).toBe("x"); // backspace worked after Esc
    });
  });

  describe("FIXED behavior (synchronous ref updates)", () => {
    it("first Backspace after typing in same macrotask works", () => {
      const c = createSimulatedComposer();
      // Ink delivers "abc" as one call, then backspace as another — same macrotask
      c.handleInput("abc", printableKey("abc").key, true);
      c.handleInput("", backspaceKey().key, true);
      // Backspace saw current ref value="abc" pos=3 → deleted 'c'
      expect(c.value).toBe("ab");
      expect(c.refValue).toBe("ab");
      expect(c.caret).toBe(2);
      expect(c.refCaret).toBe(2);
    });

    it("Esc is NOT required before Backspace works", () => {
      const c = createSimulatedComposer();
      // Type "abcdef" + Backspace immediately — no Esc needed
      c.handleInput("abcdef", printableKey("abcdef").key, true);
      c.handleInput("", backspaceKey().key, true);
      expect(c.value).toBe("abcde");
      expect(c.refValue).toBe("abcde");
    });

    it("repeated Backspace in same macrotask works", () => {
      const c = createSimulatedComposer();
      // Type "abc"
      c.handleInput("abc", printableKey("abc").key, true);
      // Backspace twice in same macrotask
      c.handleInput("", backspaceKey().key, true);
      c.handleInput("", backspaceKey().key, true);
      expect(c.value).toBe("a");
      expect(c.refValue).toBe("a");
    });

    it("Backspace works after overlay close (simulated)", () => {
      const c = createSimulatedComposer();
      // Type "hello"
      c.handleInput("hello", printableKey("hello").key, true);
      // Simulate overlay open/close — Esc clears, then type again
      c.handleInput("", escapeKey().key, true);
      expect(c.value).toBe("");
      // Type "world" after overlay close
      c.handleInput("world", printableKey("world").key, true);
      // Backspace works immediately
      c.handleInput("", backspaceKey().key, true);
      expect(c.value).toBe("worl");
    });

    it("no double deletion — single Backspace removes exactly one char", () => {
      const c = createSimulatedComposer();
      c.handleInput("abcdef", printableKey("abcdef").key, true);
      const lenBefore = c.value.length;
      c.handleInput("", backspaceKey().key, true);
      expect(c.value.length).toBe(lenBefore - 1);
      expect(c.value).toBe("abcde");
    });

    it("Delete key also works with synchronous refs", () => {
      const c = createSimulatedComposer();
      c.handleInput("abc", printableKey("abc").key, true);
      // Delete key (key.delete=true) — isBackspace returns true for it too
      c.handleInput("", deleteKey().key, true);
      expect(c.value).toBe("ab");
    });

    it("type + backspace + type in same macrotask preserves correct state", () => {
      const c = createSimulatedComposer();
      // "jkl" + Backspace + "mn" — Ink splits into 3 events in same macrotask
      c.handleInput("jkl", printableKey("jkl").key, true); // → "jkl"
      c.handleInput("", backspaceKey().key, true);         // → "jk"
      c.handleInput("mn", printableKey("mn").key, true);   // → "jkmn"
      expect(c.value).toBe("jkmn");
      expect(c.refValue).toBe("jkmn");
      expect(c.caret).toBe(4);
    });

    it("first Composer interaction accepts text", () => {
      const c = createSimulatedComposer();
      c.handleInput("a", printableKey("a").key, true);
      expect(c.value).toBe("a");
      expect(c.refValue).toBe("a");
      expect(c.caret).toBe(1);
    });

    it("Enter does not corrupt state", () => {
      const c = createSimulatedComposer();
      for (const ch of "hello") {
        c.handleInput(ch, printableKey(ch).key, true);
      }
      c.handleInput("", enterKey().key, true);
      // Enter submits but doesn't change value/caret
      expect(c.value).toBe("hello");
    });
  });

  describe("keyboard-utils recognition", () => {
    it("isBackspace recognizes key.backspace=true", () => {
      expect(isBackspace(makeKey({ backspace: true }))).toBe(true);
    });

    it("isBackspace recognizes key.delete=true", () => {
      expect(isBackspace(makeKey({ delete: true }))).toBe(true);
    });

    it("isBackspace does not match non-backspace keys", () => {
      expect(isBackspace(makeKey({}))).toBe(false);
      expect(isBackspace(makeKey({ escape: true }))).toBe(false);
      expect(isBackspace(makeKey({ return: true }))).toBe(false);
    });

    it("isPrintable correctly classifies printable chars", () => {
      expect(isPrintable("a", makeKey({}))).toBe(true);
      // Multi-char input is paste, not single printable — isPrintable is false
      expect(isPrintable("abc", makeKey({}))).toBe(false);
    });

    it("isPrintable rejects ctrl/meta combos", () => {
      expect(isPrintable("a", makeKey({ ctrl: true }))).toBe(false);
      expect(isPrintable("a", makeKey({ meta: true }))).toBe(false);
    });

    it("isEscape recognizes escape key", () => {
      expect(isEscape(makeKey({ escape: true }), "")).toBe(true);
      expect(isEscape(makeKey({}), "")).toBe(false);
    });

    it("isEnter recognizes return key", () => {
      expect(isEnter(makeKey({ return: true }), "")).toBe(true);
      expect(isEnter(makeKey({}), "")).toBe(false);
    });
  });
});
