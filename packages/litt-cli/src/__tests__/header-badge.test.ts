/**
 * Header badge truthfulness tests.
 *
 * Tests that the header primary badge correctly reflects the CONFIGURED
 * executionTarget, not just the remote transport connection state.
 *
 * Bug being fixed:
 *   LITT_LOCAL_MODE=1 + remote transport connected → header showed
 *   "● REMOTE" even though the cockpit's execution target is LOCAL.
 *
 * Fix:
 *   executionTarget === "local"  → primary badge is ALWAYS "● LOCAL"
 *   executionTarget === "remote" → primary badge reflects actual
 *   remote transport state (● REMOTE / ○ REMOTE… / ✗ REMOTE ERR)
 *
 * Since Header is an Ink React component, we test the badge derivation
 * logic directly via deriveTransport + the executionTarget decision
 * that Header uses. This mirrors the component's rendering branches
 * without requiring a full Ink render harness.
 */

import { describe, it, expect } from "vitest";
import { deriveTransport } from "../lib/transport-projection.js";
import type { ExecutionTarget } from "../lib/execution-target.js";

/**
 * Mirror of the Header component's badge decision logic.
 * Returns the primary badge label and whether REMOTE is shown as primary.
 *
 * executionTarget === "local"  → LOCAL is primary, REMOTE is never primary
 * executionTarget === "remote" → remote transport state is primary
 *
 * SIGNED OUT is a SECONDARY badge — it does NOT suppress the primary
 * LOCAL/REMOTE badge. This reflects the LOCAL-default architecture:
 * the user should see ● LOCAL even when signed out.
 */
function deriveHeaderBadge(
  executionTarget: ExecutionTarget,
  localRuntime: string,
  remoteRuntime: string,
  signedIn?: boolean,
): { primaryLabel: string; primaryIsRemote: boolean; secondaryLabel: string; signedOut: boolean } {
  const transport = deriveTransport({ localRuntime, remoteRuntime, signedIn });
  const signedOut = signedIn === false;

  if (executionTarget === "local") {
    // LOCAL target: primary badge is always LOCAL, never REMOTE
    const primaryLabel = localRuntime === "ready" ? "LOCAL"
      : localRuntime === "error" ? "LOCAL ERR" : "LOCAL…";
    return {
      primaryLabel,
      primaryIsRemote: false,
      secondaryLabel: transport.footerLabel,
      signedOut,
    };
  }

  // executionTarget === "remote": show actual remote transport state
  if (transport.showRemote) {
    return {
      primaryLabel: transport.headerLabel,
      primaryIsRemote: true,
      secondaryLabel: transport.footerLabel,
      signedOut,
    };
  }

  // Remote target but no remote transport → fall back to local tools indicator
  return {
    primaryLabel: transport.footerLabel,
    primaryIsRemote: false,
    secondaryLabel: transport.footerLabel,
    signedOut,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("header badge: executionTarget truthfulness", () => {
  // ─── Case 1: local + remote connected → LOCAL, not REMOTE ──────

  it("executionTarget=local + remoteRuntime=connected => header says LOCAL, not REMOTE", () => {
    const badge = deriveHeaderBadge("local", "ready", "connected", true);
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
    // The remote transport being connected must NOT make the header say REMOTE
    expect(badge.primaryLabel).not.toContain("REMOTE");
  });

  // ─── Case 2: local + localRuntime=ready → LOCAL + TOOLS ────────

  it("executionTarget=local + localRuntime=ready => LOCAL + TOOLS truthful", () => {
    const badge = deriveHeaderBadge("local", "ready", "offline", true);
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
    expect(badge.secondaryLabel).toBe("TOOLS");
  });

  // ─── Case 3: remote + remote connected → REMOTE ────────────────

  it("executionTarget=remote + remoteRuntime=connected => REMOTE", () => {
    const badge = deriveHeaderBadge("remote", "ready", "connected", true);
    expect(badge.primaryLabel).toBe("REMOTE");
    expect(badge.primaryIsRemote).toBe(true);
  });

  // ─── Case 4: remote + remote connecting → transitional state ───

  it("executionTarget=remote + remoteRuntime=connecting => appropriate remote transitional state", () => {
    const badge = deriveHeaderBadge("remote", "ready", "connecting", true);
    expect(badge.primaryIsRemote).toBe(true);
    // Should show a transitional label, not claim REMOTE is established
    expect(badge.primaryLabel).toBe("REMOTE…");
    expect(badge.primaryLabel).not.toBe("REMOTE");
  });

  it("executionTarget=remote + remoteRuntime=reconnecting => REMOTE↻", () => {
    const badge = deriveHeaderBadge("remote", "ready", "reconnecting", true);
    expect(badge.primaryIsRemote).toBe(true);
    expect(badge.primaryLabel).toBe("REMOTE↻");
  });

  it("executionTarget=remote + remoteRuntime=error => REMOTE ERR", () => {
    const badge = deriveHeaderBadge("remote", "ready", "error", true);
    expect(badge.primaryIsRemote).toBe(true);
    expect(badge.primaryLabel).toBe("REMOTE ERR");
  });

  // ─── Case 5: signedOut behavior — SIGNED OUT is secondary, not primary ──

  it("signedIn=false + executionTarget=local => LOCAL primary, SIGNED OUT secondary", () => {
    const badge = deriveHeaderBadge("local", "ready", "connected", false);
    // PRIMARY badge is LOCAL (the execution target), NOT SIGNED OUT
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
    // SIGNED OUT is a secondary indicator
    expect(badge.signedOut).toBe(true);
  });

  it("signedIn=false + executionTarget=remote => SIGNED OUT secondary (transport blocked)", () => {
    const badge = deriveHeaderBadge("remote", "ready", "connected", false);
    // When signed out, transport projection blocks REMOTE (showRemote=false),
    // so the primary badge falls back to the local tools indicator.
    // SIGNED OUT is shown as a secondary indicator.
    expect(badge.signedOut).toBe(true);
    // The primary badge is NOT "SIGNED OUT" — that's secondary now
    expect(badge.primaryLabel).not.toBe("SIGNED OUT");
  });

  // ─── Critical: remote connected must NOT override LOCAL ────────

  it("remote connected + executionTarget=local: REMOTE never appears as primary", () => {
    // This is the exact bug: remote transport connected, but executionTarget=local
    const badge = deriveHeaderBadge("local", "ready", "connected", true);
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
    // The key assertion: a connected remote transport does NOT make
    // the header claim REMOTE when the execution target is LOCAL
    expect(badge.primaryLabel).not.toMatch(/REMOTE/);
  });

  it("remote connecting + executionTarget=local: REMOTE never appears as primary", () => {
    const badge = deriveHeaderBadge("local", "ready", "connecting", true);
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
  });

  it("remote offline + executionTarget=local: LOCAL shown (no remote to confuse)", () => {
    const badge = deriveHeaderBadge("local", "ready", "offline", true);
    expect(badge.primaryLabel).toBe("LOCAL");
    expect(badge.primaryIsRemote).toBe(false);
  });

  // ─── Local runtime states ──────────────────────────────────────

  it("executionTarget=local + localRuntime=starting => LOCAL…", () => {
    const badge = deriveHeaderBadge("local", "starting", "offline", true);
    expect(badge.primaryLabel).toBe("LOCAL…");
  });

  it("executionTarget=local + localRuntime=error => LOCAL ERR", () => {
    const badge = deriveHeaderBadge("local", "error", "offline", true);
    expect(badge.primaryLabel).toBe("LOCAL ERR");
  });
});
