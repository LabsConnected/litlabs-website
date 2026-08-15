/**
 * Tests for keyboard utilities — robust key detection across terminals.
 *
 * These tests verify that Enter, Esc, Tab, arrows, and printable chars
 * are detected correctly regardless of terminal (Windows/macOS/Linux).
 */

import { describe, it, expect } from "vitest";
import {
  isEnter,
  isEscape,
  isTab,
  isUpArrow,
  isDownArrow,
  isBackspace,
  isCtrl,
  isPrintable,
  type KeyInfo,
} from "../ink/keyboard-utils.js";

function key(overrides: Partial<KeyInfo> = {}): KeyInfo {
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
    ...overrides,
  };
}

describe("keyboard-utils", () => {
  describe("isEnter", () => {
    it("detects key.return", () => {
      expect(isEnter(key({ return: true }), "")).toBe(true);
    });

    it("detects key.enter (if exposed)", () => {
      expect(isEnter(key({ return: true, ...({ enter: true } as object) }), "")).toBe(true);
    });

    it("detects raw \\r input", () => {
      expect(isEnter(key(), "\r")).toBe(true);
    });

    it("detects raw \\n input", () => {
      expect(isEnter(key(), "\n")).toBe(true);
    });

    it("detects raw \\r\\n input (Windows Terminal)", () => {
      expect(isEnter(key(), "\r\n")).toBe(true);
    });

    it("does not detect regular characters", () => {
      expect(isEnter(key(), "a")).toBe(false);
    });

    it("does not detect empty input with no return flag", () => {
      expect(isEnter(key(), "")).toBe(false);
    });
  });

  describe("isEscape", () => {
    it("detects key.escape", () => {
      expect(isEscape(key({ escape: true }), "")).toBe(true);
    });

    it("detects raw \\u001b input", () => {
      expect(isEscape(key(), "\u001b")).toBe(true);
    });

    it("detects raw \\x1b input", () => {
      expect(isEscape(key(), "\x1b")).toBe(true);
    });

    it("does not detect regular characters", () => {
      expect(isEscape(key(), "a")).toBe(false);
    });
  });

  describe("isTab", () => {
    it("detects key.tab", () => {
      expect(isTab(key({ tab: true }))).toBe(true);
    });

    it("does not detect non-tab", () => {
      expect(isTab(key())).toBe(false);
    });
  });

  describe("isUpArrow / isDownArrow", () => {
    it("detects up arrow", () => {
      expect(isUpArrow(key({ upArrow: true }))).toBe(true);
      expect(isDownArrow(key({ upArrow: true }))).toBe(false);
    });

    it("detects down arrow", () => {
      expect(isDownArrow(key({ downArrow: true }))).toBe(true);
      expect(isUpArrow(key({ downArrow: true }))).toBe(false);
    });
  });

  describe("isBackspace", () => {
    it("detects key.backspace", () => {
      expect(isBackspace(key({ backspace: true }))).toBe(true);
    });

    it("detects key.delete", () => {
      expect(isBackspace(key({ delete: true }))).toBe(true);
    });
  });

  describe("isCtrl", () => {
    it("detects ctrl+c", () => {
      expect(isCtrl("c", key({ ctrl: true }), "c")).toBe(true);
    });

    it("detects ctrl+m", () => {
      expect(isCtrl("m", key({ ctrl: true }), "m")).toBe(true);
    });

    it("does not detect without ctrl", () => {
      expect(isCtrl("c", key(), "c")).toBe(false);
    });

    it("does not detect wrong character", () => {
      expect(isCtrl("c", key({ ctrl: true }), "m")).toBe(false);
    });
  });

  describe("isPrintable", () => {
    it("detects regular printable characters", () => {
      expect(isPrintable("a", key())).toBe(true);
      expect(isPrintable("Z", key())).toBe(true);
      expect(isPrintable("1", key())).toBe(true);
      expect(isPrintable(" ", key())).toBe(true);
    });

    it("rejects control keys", () => {
      expect(isPrintable("a", key({ ctrl: true }))).toBe(false);
      expect(isPrintable("a", key({ meta: true }))).toBe(false);
    });

    it("rejects special keys", () => {
      expect(isPrintable("\r", key({ return: true }))).toBe(false);
      expect(isPrintable("\u001b", key({ escape: true }))).toBe(false);
      expect(isPrintable("\t", key({ tab: true }))).toBe(false);
    });

    it("rejects arrows", () => {
      expect(isPrintable("A", key({ upArrow: true }))).toBe(false);
      expect(isPrintable("B", key({ downArrow: true }))).toBe(false);
    });

    it("rejects multi-char input", () => {
      expect(isPrintable("abc", key())).toBe(false);
    });

    it("rejects control characters", () => {
      expect(isPrintable("\x00", key())).toBe(false);
      expect(isPrintable("\x1f", key())).toBe(false);
      expect(isPrintable("\x7f", key())).toBe(false);
    });
  });
});
