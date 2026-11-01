import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { devTerminalConnectSrcEntries } from "../lib/terminal-csp";

// ─── Regression test: dev connect-src must allow the terminal WebSocket ──
//
// Root cause (2026-10): the dev-only connect-src entries hardcoded port
// 4001, but dev environments configure the terminal server on other ports
// (e.g. NEXT_PUBLIC_TERMINAL_WS_URL=ws://127.0.0.1:4011). The browser's WS
// dial — after resolveTerminalBrowserBaseUrl substitutes the page host —
// landed on ws://localhost:4011 and was CSP-blocked: the terminal could
// never connect.
//
// upgrade-insecure-requests is separately gated to production: on an http
// dev server it upgrades every subresource to https (no TLS in dev) and
// rewrites ws:// terminal dials to wss://.

describe("devTerminalConnectSrcEntries", () => {
  it("always includes the historical default port on every loopback host", () => {
    const entries = devTerminalConnectSrcEntries({});
    for (const host of ["localhost", "127.0.0.1"]) {
      expect(entries).toContain(`ws://${host}:4001`);
      expect(entries).toContain(`http://${host}:4001`);
    }
  });

  it("never emits bracketed IPv6 — it is not a valid CSP source", () => {
    const entries = devTerminalConnectSrcEntries({
      NEXT_PUBLIC_TERMINAL_WS_URL: "ws://[::1]:4011",
    });
    expect(entries.some((e) => e.includes("["))).toBe(false);
    // The ::1 configured port is still covered via the localhost entries.
    expect(entries).toContain("ws://localhost:4011");
    expect(entries).toContain("ws://127.0.0.1:4011");
  });

  it("derives the configured loopback terminal port (4011) for ws and http", () => {
    const entries = devTerminalConnectSrcEntries({
      NEXT_PUBLIC_TERMINAL_WS_URL: "ws://127.0.0.1:4011",
      NEXT_PUBLIC_TERMINAL_HTTP_URL: "http://127.0.0.1:4011",
    });
    for (const host of ["localhost", "127.0.0.1"]) {
      expect(entries).toContain(`ws://${host}:4011`);
      expect(entries).toContain(`http://${host}:4011`);
    }
    expect(entries).toContain("ws://localhost:4001");
  });

  it("honours LITT_TERMINAL_URL and TERMINAL_PUBLIC_URL too", () => {
    const entries = devTerminalConnectSrcEntries({
      LITT_TERMINAL_URL: "http://127.0.0.1:4022",
      TERMINAL_PUBLIC_URL: "http://localhost:4033",
    });
    expect(entries).toContain("ws://localhost:4022");
    expect(entries).toContain("ws://127.0.0.1:4033");
  });

  it("ignores non-loopback and malformed terminal URLs", () => {
    const entries = devTerminalConnectSrcEntries({
      NEXT_PUBLIC_TERMINAL_WS_URL: "wss://terminal.example.com",
      TERMINAL_PUBLIC_URL: "not a url",
    });
    expect(entries.some((e) => e.includes("terminal.example.com"))).toBe(false);
    expect(entries).toContain("ws://localhost:4001");
  });
});

describe("next.config.ts CSP source", () => {
  const configSource = readFileSync(join(__dirname, "../../next.config.ts"), "utf-8");

  it("splices the derived dev terminal entries into connect-src only in development", () => {
    expect(configSource).toContain("devTerminalConnectSrcEntries()");
    expect(configSource).toMatch(
      /process\.env\.NODE_ENV === "development" \? ` \$\{devTerminalConnectSrcEntries/,
    );
  });

  it("emits upgrade-insecure-requests only in production", () => {
    expect(configSource).toMatch(
      /process\.env\.NODE_ENV === "production"\s*\?\s*\["upgrade-insecure-requests"\]/,
    );
    expect(configSource).not.toMatch(/^\s*"upgrade-insecure-requests",\s*$/m);
  });
});
