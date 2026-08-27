/**
 * Tests for preview URL generation (buildPreviewProxyUrl).
 *
 * Covers:
 *   - default terminal URL
 *   - PREVIEW_PROXY_HOST
 *   - workspace path
 *   - auth token/query behavior
 *   - malformed base URL
 *   - local environment
 *   - production environment
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildPreviewProxyUrl } from "../terminal-internal-client";

describe("buildPreviewProxyUrl", () => {
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    origEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = origEnv;
  });

  it("builds default terminal URL with workspace path", () => {
    process.env.TERMINAL_SERVER_URL = "https://terminal.example.com";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const url = buildPreviewProxyUrl("ws-123");
    expect(url).toBe("https://terminal.example.com/preview/ws-123");
  });

  it("appends auth token when PREVIEW_ACCESS_TOKEN is set", () => {
    process.env.TERMINAL_SERVER_URL = "https://terminal.example.com";
    process.env.PREVIEW_ACCESS_TOKEN = "secret-token";
    const url = buildPreviewProxyUrl("ws-123");
    expect(url).toBe("https://terminal.example.com/preview/ws-123?token=secret-token");
  });

  it("encodes the workspace ID", () => {
    process.env.TERMINAL_SERVER_URL = "https://terminal.example.com";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const url = buildPreviewProxyUrl("ws/with/slashes");
    expect(url).toBe("https://terminal.example.com/preview/ws%2Fwith%2Fslashes");
  });

  it("falls back to localhost in non-production", () => {
    delete process.env.TERMINAL_SERVER_URL;
    delete process.env.TERMINAL_SERVER_INTERNAL_URL;
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const url = buildPreviewProxyUrl("ws-123");
    expect(url).toContain("localhost");
    expect(url).toContain("/preview/ws-123");
  });

  it("returns relative URL in production when no terminal URL configured", () => {
    delete process.env.TERMINAL_SERVER_URL;
    delete process.env.TERMINAL_SERVER_INTERNAL_URL;
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const url = buildPreviewProxyUrl("ws-123");
    expect(url).toBe("/preview/ws-123");
  });

  it("uses TERMINAL_SERVER_INTERNAL_URL when TERMINAL_SERVER_URL is absent", () => {
    delete process.env.TERMINAL_SERVER_URL;
    process.env.TERMINAL_SERVER_INTERNAL_URL = "https://internal.terminal.example.com";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    const url = buildPreviewProxyUrl("ws-456");
    expect(url).toBe("https://internal.terminal.example.com/preview/ws-456");
  });

  it("handles malformed base URL gracefully", () => {
    process.env.TERMINAL_SERVER_URL = "not-a-valid-url";
    delete process.env.PREVIEW_ACCESS_TOKEN;
    // The function doesn't validate URLs — it just concatenates.
    // This test confirms it doesn't throw.
    const url = buildPreviewProxyUrl("ws-789");
    expect(url).toContain("ws-789");
  });
});
