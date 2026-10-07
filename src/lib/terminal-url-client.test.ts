import { describe, expect, it } from "vitest";
import {
  LEGACY_PROD_TERMINAL_URL,
  LOCAL_TERMINAL_URL,
  resolveClientTerminalUrl,
} from "./terminal-url-client";

describe("resolveClientTerminalUrl", () => {
  it("prefers an explicit non-localhost HTTP URL in any environment", () => {
    for (const env of ["production", "development", "test"]) {
      expect(resolveClientTerminalUrl("https://t.example.com/", undefined, env)).toBe(
        "https://t.example.com",
      );
    }
  });

  it("rewrites a WS URL to HTTP when no HTTP URL is set", () => {
    expect(resolveClientTerminalUrl(undefined, "wss://t.example.com/", "production")).toBe(
      "https://t.example.com",
    );
  });

  it("keeps the legacy production fallback for production builds (unchanged)", () => {
    expect(resolveClientTerminalUrl(undefined, undefined, "production")).toBe(
      LEGACY_PROD_TERMINAL_URL,
    );
    expect(resolveClientTerminalUrl("http://localhost:4001", undefined, "production")).toBe(
      LEGACY_PROD_TERMINAL_URL,
    );
  });

  it("never falls back to the production host outside production builds", () => {
    expect(resolveClientTerminalUrl(undefined, undefined, "development")).toBe(LOCAL_TERMINAL_URL);
    expect(resolveClientTerminalUrl("http://localhost:5000", undefined, "development")).toBe(
      "http://localhost:5000",
    );
    expect(resolveClientTerminalUrl(undefined, undefined, "test")).not.toBe(LEGACY_PROD_TERMINAL_URL);
  });
});
