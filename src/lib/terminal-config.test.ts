import { afterEach, describe, expect, it, vi } from "vitest";
import { getTerminalServerUrl } from "./terminal-url";
import {
  TerminalNotConfiguredError,
  requireTerminalBaseUrl,
  resolveTerminalBaseUrl,
  terminalNotConfiguredResponse,
} from "./terminal-config";

const KEYS = [
  "TERMINAL_PUBLIC_URL",
  "NEXT_PUBLIC_TERMINAL_WS_URL",
  "NEXT_PUBLIC_TERMINAL_HTTP_URL",
  "TERMINAL_SERVER_INTERNAL_URL",
] as const;

function clean(nodeEnv: string) {
  for (const k of KEYS) vi.stubEnv(k, "");
  vi.stubEnv("NODE_ENV", nodeEnv);
}

afterEach(() => vi.unstubAllEnvs());

describe("getTerminalServerUrl (no implicit production fallback)", () => {
  it("returns empty in production when nothing is configured", () => {
    clean("production");
    expect(getTerminalServerUrl()).toBe("");
  });

  it("returns localhost only outside production", () => {
    clean("development");
    expect(getTerminalServerUrl()).toBe("http://localhost:4001");
  });

  it("honours the documented env priority", () => {
    clean("production");
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_HTTP_URL", "https://http.example.com/");
    expect(getTerminalServerUrl()).toBe("https://http.example.com");
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_WS_URL", "wss://ws.example.com/");
    expect(getTerminalServerUrl()).toBe("https://ws.example.com");
    vi.stubEnv("TERMINAL_PUBLIC_URL", "https://public.example.com/");
    expect(getTerminalServerUrl()).toBe("https://public.example.com");
  });
});

describe("terminal-config (fail closed)", () => {
  it("throws TerminalNotConfiguredError (503) in production with no config", () => {
    clean("production");
    expect(resolveTerminalBaseUrl()).toBe("");
    expect(() => requireTerminalBaseUrl()).toThrow(TerminalNotConfiguredError);
    try {
      requireTerminalBaseUrl();
    } catch (e) {
      expect((e as TerminalNotConfiguredError).status).toBe(503);
    }
  });

  it("returns a 503 JSON response when unconfigured, null when configured", async () => {
    clean("production");
    const res = terminalNotConfiguredResponse();
    expect(res?.status).toBe(503);
    expect((await res!.json()).code).toBe("terminal_not_configured");

    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "http://terminal.internal:4001/");
    expect(terminalNotConfiguredResponse()).toBeNull();
    expect(requireTerminalBaseUrl()).toBe("http://terminal.internal:4001");
  });

  it("prefers the internal URL and falls back to the public one", () => {
    clean("production");
    vi.stubEnv("NEXT_PUBLIC_TERMINAL_WS_URL", "wss://pub.example.com");
    expect(requireTerminalBaseUrl()).toBe("https://pub.example.com");
    vi.stubEnv("TERMINAL_SERVER_INTERNAL_URL", "http://int:1");
    expect(requireTerminalBaseUrl()).toBe("http://int:1");
  });

  it("uses localhost only in development", () => {
    clean("development");
    expect(requireTerminalBaseUrl()).toBe("http://localhost:4001");
  });
});
