// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

/**
 * Regression test for the terminal paste duplication bug.
 *
 * Root cause: attachCustomKeyEventHandler returning false only stops
 * xterm's own keydown processing — it does NOT call event.preventDefault(),
 * so the browser still fires its native paste event on xterm's hidden
 * textarea. Both the browser's native paste AND our manual term.paste()
 * fire, doubling the input (e.g. "pnpm mobile:checkpnpm mobile:check").
 *
 * Fix: call event.preventDefault() on every intercepted key.
 *
 * This test verifies the handler logic in isolation by simulating
 * the exact keydown events that xterm would pass to
 * attachCustomKeyEventHandler.
 */

// Simulate the xterm Terminal interface we depend on
interface MockTerminal {
  paste: (text: string) => void;
  hasSelection: () => boolean;
  getSelection: () => string;
  clearSelection: () => void;
}

// Simulate a KeyboardEvent
interface MockKeyboardEvent {
  type: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  key: string;
  preventDefault: () => void;
}

function createMockTerminal(overrides: Partial<MockTerminal> = {}): MockTerminal {
  return {
    paste: vi.fn(),
    hasSelection: vi.fn(() => false),
    getSelection: vi.fn(() => ""),
    clearSelection: vi.fn(),
    ...overrides,
  };
}

function createMockEvent(overrides: Partial<MockKeyboardEvent> = {}): MockKeyboardEvent {
  return {
    type: "keydown",
    ctrlKey: false,
    shiftKey: false,
    key: "v",
    preventDefault: vi.fn(),
    ...overrides,
  };
}

/**
 * This is the EXACT handler logic from TerminalPanel.tsx.
 * If this logic changes, update both this test and the component.
 */
function createKeyHandler(term: MockTerminal) {
  return (event: MockKeyboardEvent): boolean => {
    if (event.type !== "keydown") return true;

    const key = event.key.toLowerCase();

    if (event.ctrlKey && !event.shiftKey && key === "v") {
      event.preventDefault();
      navigator.clipboard.readText().then((text: string) => term.paste(text)).catch(() => {});
      return false;
    }

    if (event.ctrlKey && event.shiftKey && key === "v") {
      event.preventDefault();
      navigator.clipboard.readText().then((text: string) => term.paste(text)).catch(() => {});
      return false;
    }

    if (event.ctrlKey && !event.shiftKey && key === "c") {
      if (term.hasSelection()) {
        event.preventDefault();
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      return true;
    }

    if (event.ctrlKey && event.shiftKey && key === "c") {
      if (term.hasSelection()) {
        event.preventDefault();
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        return false;
      }
      return true;
    }

    return true;
  };
}

// Mock navigator.clipboard
const mockClipboardText = "pnpm mobile:check";
vi.stubGlobal("navigator", {
  clipboard: {
    readText: vi.fn().mockResolvedValue(mockClipboardText),
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("terminal paste duplication regression", () => {
  it("Ctrl+V calls preventDefault (prevents browser native paste double-firing)", async () => {
    const term = createMockTerminal();
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, key: "v" });

    const result = handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("Ctrl+Shift+V calls preventDefault", async () => {
    const term = createMockTerminal();
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, shiftKey: true, key: "v" });

    const result = handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("Ctrl+C with selection calls preventDefault (copy, not SIGINT)", () => {
    const term = createMockTerminal({ hasSelection: () => true, getSelection: () => "selected text" });
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, key: "c" });

    const result = handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("Ctrl+C without selection does NOT call preventDefault (lets SIGINT through)", () => {
    const term = createMockTerminal({ hasSelection: () => false });
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, key: "c" });

    const result = handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("Ctrl+Shift+C with selection calls preventDefault", () => {
    const term = createMockTerminal({ hasSelection: () => true, getSelection: () => "selected" });
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, shiftKey: true, key: "c" });

    const result = handler(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(false);
  });

  it("non-clipboard keys do NOT call preventDefault", () => {
    const term = createMockTerminal();
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, key: "a" });

    const result = handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("keyup events pass through unchanged", () => {
    const term = createMockTerminal();
    const handler = createKeyHandler(term);
    const event = createMockEvent({ type: "keyup", ctrlKey: true, key: "v" });

    const result = handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it("paste produces exactly one term.paste call, not two", async () => {
    const term = createMockTerminal();
    const handler = createKeyHandler(term);
    const event = createMockEvent({ ctrlKey: true, key: "v" });

    handler(event);

    // Wait for the async clipboard read to resolve
    await vi.waitFor(() => {
      expect(term.paste).toHaveBeenCalledTimes(1);
    });

    expect(term.paste).toHaveBeenCalledWith(mockClipboardText);
  });
});
