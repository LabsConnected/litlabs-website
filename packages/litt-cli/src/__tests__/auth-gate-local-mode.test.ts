/**
 * Auth gate regression tests — local-default / local-only mode.
 *
 * Tests the extracted `requiresAuth` pure function that decides whether
 * the auth gate engages for a given command.
 *
 * Key invariants:
 *   - The DEFAULT execution target is LOCAL — cockpit launches without auth.
 *   - LITT_LOCAL_ONLY=1 (or legacy LITT_LOCAL_MODE=1) = emergency mode.
 *   - Remote/cloud features remain auth-gated at the provider/capability level.
 */

import { describe, it, expect } from "vitest";
import { requiresAuth } from "../index.js";

// Signature: requiresAuth(command, hasByokKey, localOnly, localTarget, clerkToken)

describe("auth gate: requiresAuth", () => {
  // ─── Logged-out allowed commands ───────────────────────────────

  it("allows login without auth", () => {
    expect(requiresAuth("login", false, false, false, false)).toBe(false);
  });

  it("allows logout without auth", () => {
    expect(requiresAuth("logout", false, false, false, false)).toBe(false);
  });

  it("allows whoami without auth", () => {
    expect(requiresAuth("whoami", false, false, false, false)).toBe(false);
  });

  it("allows doctor without auth", () => {
    expect(requiresAuth("doctor", false, false, false, false)).toBe(false);
  });

  it("allows version without auth", () => {
    expect(requiresAuth("version", false, false, false, false)).toBe(false);
  });

  it("allows help without auth", () => {
    expect(requiresAuth("help", false, false, false, false)).toBe(false);
  });

  // ─── DEFAULT: cockpit with LOCAL target does NOT require auth ───

  it("does NOT require auth for cockpit with localTarget=true (default)", () => {
    // The default is LOCAL — cockpit launches without auth
    expect(requiresAuth("cockpit", false, false, true, false)).toBe(false);
  });

  it("does NOT require auth for shell with localTarget=true", () => {
    expect(requiresAuth("shell", false, false, true, false)).toBe(false);
  });

  it("does NOT require auth for tui with localTarget=true", () => {
    expect(requiresAuth("tui", false, false, true, false)).toBe(false);
  });

  // ─── --remote: cockpit requires auth ───────────────────────────

  it("requires auth for cockpit with localTarget=false (--remote)", () => {
    // --remote means the cockpit needs remote capability → auth required
    expect(requiresAuth("cockpit", false, false, false, false)).toBe(true);
  });

  it("requires auth for shell with localTarget=false", () => {
    expect(requiresAuth("shell", false, false, false, false)).toBe(true);
  });

  // ─── LITT_LOCAL_ONLY=1 (emergency mode) ────────────────────────

  it("does NOT require auth for cockpit in local-only emergency mode", () => {
    expect(requiresAuth("cockpit", false, true, false, false)).toBe(false);
  });

  it("does NOT require auth for cockpit in local-only + localTarget", () => {
    expect(requiresAuth("cockpit", false, true, true, false)).toBe(false);
  });

  // ─── Local-only does NOT bypass auth for non-cockpit commands ──

  it("still requires auth for ask in local-only mode (no BYOK key)", () => {
    expect(requiresAuth("ask", false, true, false, false)).toBe(true);
  });

  it("does NOT require auth for ask in local-only mode WITH BYOK key", () => {
    expect(requiresAuth("ask", true, true, false, false)).toBe(false);
  });

  // ─── BYOK key allows BYOK-allowed commands ─────────────────────

  it("does NOT require auth for ask with BYOK key", () => {
    expect(requiresAuth("ask", true, false, false, false)).toBe(false);
  });

  it("requires auth for ask without BYOK key", () => {
    expect(requiresAuth("ask", false, false, false, false)).toBe(true);
  });

  it("does NOT require auth for build with BYOK key", () => {
    expect(requiresAuth("build", true, false, false, false)).toBe(false);
  });

  // ─── BYOK key does NOT bypass auth for cockpit with remote target ──

  it("requires auth for cockpit with remote target even with BYOK key", () => {
    expect(requiresAuth("cockpit", true, false, false, false)).toBe(true);
  });

  // ─── LITT_CLERK_TOKEN test bypass ──────────────────────────────

  it("does NOT require auth when LITT_CLERK_TOKEN is set", () => {
    expect(requiresAuth("cockpit", false, false, false, true)).toBe(false);
  });

  it("does NOT require auth for any command when LITT_CLERK_TOKEN is set", () => {
    expect(requiresAuth("ask", false, false, false, true)).toBe(false);
  });

  // ─── Unknown commands require auth ─────────────────────────────

  it("requires auth for unknown commands", () => {
    expect(requiresAuth("unknown-command", false, false, false, false)).toBe(true);
  });

  it("requires auth for unknown commands even in local-only mode", () => {
    expect(requiresAuth("unknown-command", false, true, false, false)).toBe(true);
  });

  // ─── Core new behavior: DEFAULT LOCAL ──────────────────────────

  it("cockpit default (localTarget=true, no emergency): no auth needed", () => {
    // This is the new default: plain `litt` starts LOCAL without auth
    expect(requiresAuth("cockpit", false, false, true, false)).toBe(false);
  });

  it("cockpit --remote (localTarget=false): auth required", () => {
    // --remote needs auth since it requires remote capability
    expect(requiresAuth("cockpit", false, false, false, false)).toBe(true);
  });
});
