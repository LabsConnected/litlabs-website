import { describe, it, expect } from "vitest";
import {
  resolveTerminalCommandBase,
  TerminalCommandConfigError,
} from "./terminal-command-url";

/**
 * TERMINAL_SERVER_INTERNAL_URL is the single authoritative source.
 *
 * Regression origin: production commit 698bea5e ran with the variable unset.
 * The resolver fell through to NEXT_PUBLIC_TERMINAL_WS_URL
 * ("wss://terminal.litlabs.net"), fetch() rejected the scheme, and every
 * slash command returned a generic 502.
 */
describe("resolveTerminalCommandBase", () => {
  it("accepts an https origin", () => {
    expect(
      resolveTerminalCommandBase({
        TERMINAL_SERVER_INTERNAL_URL: "https://terminal.litlabs.net",
      }),
    ).toBe("https://terminal.litlabs.net");
  });

  it("accepts the private http origin production actually uses", () => {
    expect(
      resolveTerminalCommandBase({
        TERMINAL_SERVER_INTERNAL_URL: "http://litlabs-terminal-server.railway.internal:8080",
      }),
    ).toBe("http://litlabs-terminal-server.railway.internal:8080");
  });

  it("strips trailing slashes so the joined path is not doubled", () => {
    expect(
      resolveTerminalCommandBase({
        TERMINAL_SERVER_INTERNAL_URL: "https://terminal.litlabs.net///",
      }),
    ).toBe("https://terminal.litlabs.net");
  });

  it("fails closed when the variable is missing", () => {
    expect(() => resolveTerminalCommandBase({})).toThrow(TerminalCommandConfigError);
    expect(() => resolveTerminalCommandBase({})).toThrow(/TERMINAL_SERVER_INTERNAL_URL/);
  });

  it("fails closed when the variable is whitespace only", () => {
    expect(() =>
      resolveTerminalCommandBase({ TERMINAL_SERVER_INTERNAL_URL: "   " }),
    ).toThrow(TerminalCommandConfigError);
  });

  it("fails closed when missing even outside production", () => {
    // There is no local-dev default: a silent 127.0.0.1 fallback hides a
    // half-configured environment. .env.example ships the variable.
    expect(() =>
      resolveTerminalCommandBase({ NODE_ENV: "development" }),
    ).toThrow(TerminalCommandConfigError);
  });

  it.each([["wss://terminal.litlabs.net"], ["ws://127.0.0.1:4001"]])(
    "rejects %s instead of rewriting it",
    (value: string) => {
      expect(() =>
        resolveTerminalCommandBase({ TERMINAL_SERVER_INTERNAL_URL: value }),
      ).toThrow(/must be an http\(s\) URL/);
    },
  );

  it("rejects other non-HTTP schemes", () => {
    for (const value of ["file:///etc/passwd", "ftp://example.net"]) {
      expect(() =>
        resolveTerminalCommandBase({ TERMINAL_SERVER_INTERNAL_URL: value }),
      ).toThrow(TerminalCommandConfigError);
    }
  });

  it("fails closed on a malformed value", () => {
    expect(() =>
      resolveTerminalCommandBase({ TERMINAL_SERVER_INTERNAL_URL: "terminal.litlabs.net" }),
    ).toThrow(/not a valid absolute URL/);
  });

  // ── No fallback chain ────────────────────────────────────────────
  it("does not fall back to TERMINAL_SERVER_URL", () => {
    expect(() =>
      resolveTerminalCommandBase({
        TERMINAL_SERVER_URL: "https://terminal.litlabs.net",
      }),
    ).toThrow(TerminalCommandConfigError);
  });

  it("does not fall back to NEXT_PUBLIC_TERMINAL_HTTP_URL", () => {
    expect(() =>
      resolveTerminalCommandBase({
        NEXT_PUBLIC_TERMINAL_HTTP_URL: "https://terminal.litlabs.net",
      }),
    ).toThrow(TerminalCommandConfigError);
  });

  it("never falls back to the websocket URL", () => {
    expect(() =>
      resolveTerminalCommandBase({
        NEXT_PUBLIC_TERMINAL_WS_URL: "wss://terminal.litlabs.net",
        NEXT_PUBLIC_TERMINAL_HTTP_URL: "https://terminal.litlabs.net",
        TERMINAL_SERVER_URL: "https://terminal.litlabs.net",
      }),
    ).toThrow(TerminalCommandConfigError);
  });

  it("never echoes credentials from the configured value", () => {
    try {
      resolveTerminalCommandBase({
        TERMINAL_SERVER_INTERNAL_URL: "wss://svc:sup3rs3cret@terminal.litlabs.net",
      });
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("sup3rs3cret");
    }
  });
});
