/**
 * Auth gate regression tests — local-mode-without-auth.
 *
 * Tests the extracted `requiresAuth` pure function that decides whether
 * the auth gate engages for a given command.
 *
 * Key invariant: LITT_LOCAL_MODE=1 allows the cockpit to launch without
 * auth (local-only mode). Remote/cloud features remain auth-gated at the
 * provider level — they are never silently granted just because the
 * cockpit launched without auth.
 */

import { describe, it, expect } from "vitest";
import { requiresAuth } from "../index.js";

describe("auth gate: requiresAuth", () => {
  // ─── Logged-out allowed commands ───────────────────────────────

  it("allows login without auth", () => {
    expect(requiresAuth("login", false, false, false)).toBe(false);
  });

  it("allows logout without auth", () => {
    expect(requiresAuth("logout", false, false, false)).toBe(false);
  });

  it("allows whoami without auth", () => {
    expect(requiresAuth("whoami", false, false, false)).toBe(false);
  });

  it("allows doctor without auth", () => {
    expect(requiresAuth("doctor", false, false, false)).toBe(false);
  });

  it("allows version without auth", () => {
    expect(requiresAuth("version", false, false, false)).toBe(false);
  });

  it("allows help without auth", () => {
    expect(requiresAuth("help", false, false, false)).toBe(false);
  });

  // ─── Cockpit requires auth in normal (remote) mode ─────────────

  it("requires auth for cockpit in remote mode (no BYOK key)", () => {
    expect(requiresAuth("cockpit", false, false, false)).toBe(true);
  });

  it("requires auth for shell in remote mode (no BYOK key)", () => {
    expect(requiresAuth("shell", false, false, false)).toBe(true);
  });

  it("requires auth for tui in remote mode (no BYOK key)", () => {
    expect(requiresAuth("tui", false, false, false)).toBe(true);
  });

  // ─── LITT_LOCAL_MODE=1 bypasses auth for cockpit ───────────────

  it("does NOT require auth for cockpit in local-only mode", () => {
    expect(requiresAuth("cockpit", false, true, false)).toBe(false);
  });

  it("does NOT require auth for shell in local-only mode", () => {
    expect(requiresAuth("shell", false, true, false)).toBe(false);
  });

  it("does NOT require auth for tui in local-only mode", () => {
    expect(requiresAuth("tui", false, true, false)).toBe(false);
  });

  // ─── Local-only mode does NOT bypass auth for non-cockpit commands ──

  it("still requires auth for ask in local-only mode (no BYOK key)", () => {
    // ask is in BYOK_ALLOWED but requires a BYOK key
    expect(requiresAuth("ask", false, true, false)).toBe(true);
  });

  it("does NOT require auth for ask in local-only mode WITH BYOK key", () => {
    // BYOK key satisfies the gate for ask
    expect(requiresAuth("ask", true, true, false)).toBe(false);
  });

  // ─── BYOK key allows BYOK-allowed commands ─────────────────────

  it("does NOT require auth for ask with BYOK key (remote mode)", () => {
    expect(requiresAuth("ask", true, false, false)).toBe(false);
  });

  it("requires auth for ask without BYOK key (remote mode)", () => {
    expect(requiresAuth("ask", false, false, false)).toBe(true);
  });

  it("does NOT require auth for build with BYOK key", () => {
    expect(requiresAuth("build", true, false, false)).toBe(false);
  });

  it("does NOT require auth for test with BYOK key", () => {
    expect(requiresAuth("test", true, false, false)).toBe(false);
  });

  // ─── BYOK key does NOT bypass auth for cockpit ─────────────────

  it("requires auth for cockpit even with BYOK key (remote mode)", () => {
    // BYOK key only helps BYOK_ALLOWED commands, not the cockpit
    expect(requiresAuth("cockpit", true, false, false)).toBe(true);
  });

  // ─── LITT_CLERK_TOKEN test bypass ──────────────────────────────

  it("does NOT require auth when LITT_CLERK_TOKEN is set", () => {
    expect(requiresAuth("cockpit", false, false, true)).toBe(false);
  });

  it("does NOT require auth for any command when LITT_CLERK_TOKEN is set", () => {
    expect(requiresAuth("ask", false, false, true)).toBe(false);
  });

  // ─── Unknown commands require auth ─────────────────────────────

  it("requires auth for unknown commands", () => {
    expect(requiresAuth("unknown-command", false, false, false)).toBe(true);
  });

  it("requires auth for unknown commands even in local-only mode", () => {
    // Local-only bypass only applies to cockpit commands, not unknown ones
    expect(requiresAuth("unknown-command", false, true, false)).toBe(true);
  });

  // ─── Combined: local-only mode + no BYOK + no clerk token ──────

  it("cockpit in local-only mode with no key and no clerk token: no auth needed", () => {
    // This is the core P1 fix: local-only cockpit launches without any auth
    expect(requiresAuth("cockpit", false, true, false)).toBe(false);
  });

  it("cockpit in remote mode with no key and no clerk token: auth required", () => {
    // Without local-only mode, the cockpit still requires auth
    expect(requiresAuth("cockpit", false, false, false)).toBe(true);
  });
});
