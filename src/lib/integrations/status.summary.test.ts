import { describe, it, expect } from "vitest";
import { summarizeIntegrations } from "./status";
import type { IntegrationStatus } from "./types";

// Header stats must be computed FROM the rows. Regression coverage for the
// 2026-11-11 production audit: the header claimed "9 Platform ready,
// 0 Needs config, 9 User connected" while its own rows showed Vercel /
// Cloudflare R2 / Anthropic "Not configured" and Stripe in an error state.

function row(partial: Partial<IntegrationStatus> & { id: string }): IntegrationStatus {
  return {
    platformConfigured: true,
    userConnected: true,
    workspaceReady: true,
    state: "ready",
    displayName: partial.id,
    category: "ai",
    actions: [],
    ...partial,
  };
}

describe("summarizeIntegrations — header stats agree with the rows", () => {
  it("counts unconfigured OPTIONAL rows in Needs config", () => {
    const rows = [
      row({ id: "gemini" }),
      row({ id: "vercel", category: "optional", platformConfigured: false, userConnected: false, workspaceReady: false, state: "platform_missing" }),
      row({ id: "anthropic", category: "optional", platformConfigured: false, userConnected: false, workspaceReady: false, state: "platform_missing" }),
    ];
    const s = summarizeIntegrations(rows);
    expect(s.platformNeedsConfig).toBe(2);
    expect(s.platformReady).toBe(1);
  });

  it("does not count an error-state row as platform ready or user connected", () => {
    const rows = [
      row({ id: "gemini" }),
      // Stripe shape from the audit: key present, live probe failed.
      row({ id: "stripe", category: "optional", state: "error", details: "API key not verified", workspaceReady: false }),
    ];
    const s = summarizeIntegrations(rows);
    expect(s.platformReady).toBe(1);
    expect(s.userConnected).toBe(1);
    expect(s.userNotConnected).toBe(1);
  });

  it("connected + not connected always equals the row count", () => {
    const rows = [
      row({ id: "a" }),
      row({ id: "b", userConnected: false, state: "user_not_connected" }),
      row({ id: "c", state: "error" }),
      row({ id: "d", platformConfigured: false, userConnected: false, workspaceReady: false, state: "platform_missing" }),
    ];
    const s = summarizeIntegrations(rows);
    expect(s.userConnected + s.userNotConnected).toBe(rows.length);
    expect(s.userConnected).toBe(1);
    expect(s.platformReady + s.platformNeedsConfig).toBe(rows.length - 1); // error row is configured but not ready
  });
});
