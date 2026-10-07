import { describe, expect, it } from "vitest";
import { LOCAL_TERMINAL_URL, resolveClientTerminalUrl } from "./terminal-url-client";

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

  it("fails closed (empty) in production when nothing is configured", () => {
    expect(resolveClientTerminalUrl(undefined, undefined, "production")).toBe("");
    expect(resolveClientTerminalUrl("", "", "production")).toBe("");
  });

  it("treats localhost as unconfigured in production instead of using any host", () => {
    expect(resolveClientTerminalUrl("http://localhost:4001", undefined, "production")).toBe("");
    expect(resolveClientTerminalUrl(undefined, "ws://localhost:4001", "production")).toBe("");
  });

  it("uses localhost only outside production", () => {
    expect(resolveClientTerminalUrl(undefined, undefined, "development")).toBe(LOCAL_TERMINAL_URL);
    expect(resolveClientTerminalUrl("http://localhost:5000", undefined, "development")).toBe(
      "http://localhost:5000",
    );
  });

  it("never yields a railway production host without explicit config", () => {
    for (const env of ["production", "development", "test"]) {
      expect(resolveClientTerminalUrl(undefined, undefined, env)).not.toMatch(/railway\.app/);
    }
  });
});
