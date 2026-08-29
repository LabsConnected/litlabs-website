/**
 * Capability gate tests — local-only mode + signed-out local mode.
 *
 * Tests the `shouldBlockModelPath` pure function with the new 3-parameter
 * signature: (signedIn, executionTarget, localOnly).
 *
 * The gate blocks when:
 *   - localOnly === true (emergency mode: hard block), OR
 *   - signedIn === false AND executionTarget === "local" (signed-out local)
 *
 * The gate allows when:
 *   - signedIn === true AND localOnly === false (authenticated, not locked)
 *   - executionTarget === "remote" AND localOnly === false (remote mode)
 *   - signedIn === null/undefined (auth not yet resolved)
 */

import { describe, it, expect } from "vitest";
import { shouldBlockModelPath, CAPABILITY_GATE_MESSAGE, LOCAL_ONLY_GATE_MESSAGE } from "../lib/capability-gate.js";

describe("capability gate: shouldBlockModelPath", () => {
  // ─── Emergency mode: localOnly=true always blocks ──────────────

  it("blocks when localOnly=true + signed in + local target", () => {
    expect(shouldBlockModelPath(true, "local", true)).toBe(true);
  });

  it("blocks when localOnly=true + signed out + local target", () => {
    expect(shouldBlockModelPath(false, "local", true)).toBe(true);
  });

  it("blocks when localOnly=true even with remote target", () => {
    // localOnly hard-blocks regardless of target — emergency mode
    expect(shouldBlockModelPath(true, "remote", true)).toBe(true);
  });

  // ─── Signed-out local mode: blocks ─────────────────────────────

  it("blocks when signed out + local target + localOnly=false", () => {
    expect(shouldBlockModelPath(false, "local", false)).toBe(true);
  });

  // ─── Authenticated local mode: allows (can switch to remote) ───

  it("does NOT block when signed in + local target + localOnly=false", () => {
    // This is the key new behavior: LOCAL is the default, but the user
    // is authenticated — they can use BYOK model or switch to /remote
    expect(shouldBlockModelPath(true, "local", false)).toBe(false);
  });

  // ─── Remote mode: allows (when not localOnly) ──────────────────

  it("does NOT block when signed in + remote target + localOnly=false", () => {
    expect(shouldBlockModelPath(true, "remote", false)).toBe(false);
  });

  it("does NOT block when signed out + remote target + localOnly=false", () => {
    // Remote target with signed-out: the auth gate at index.ts handles
    // this (cockpit with --remote requires auth). The capability gate
    // doesn't block here — the provider call will fail with auth error.
    expect(shouldBlockModelPath(false, "remote", false)).toBe(false);
  });

  // ─── Unknown auth state: do NOT block ──────────────────────────

  it("does NOT block when auth state is null (not yet resolved)", () => {
    expect(shouldBlockModelPath(null, "local", false)).toBe(false);
  });

  it("does NOT block when auth state is undefined", () => {
    expect(shouldBlockModelPath(undefined, "local", false)).toBe(false);
  });

  // ─── Messages ──────────────────────────────────────────────────

  it("CAPABILITY_GATE_MESSAGE mentions cloud/model access", () => {
    expect(CAPABILITY_GATE_MESSAGE).toContain("cloud/model access");
  });

  it("CAPABILITY_GATE_MESSAGE does not leak provider errors", () => {
    expect(CAPABILITY_GATE_MESSAGE).not.toContain("429");
    expect(CAPABILITY_GATE_MESSAGE).not.toContain("OpenAI");
    expect(CAPABILITY_GATE_MESSAGE).not.toContain("OpenRouter");
  });

  it("LOCAL_ONLY_GATE_MESSAGE mentions local-only mode", () => {
    expect(LOCAL_ONLY_GATE_MESSAGE).toContain("Local-only mode");
    expect(LOCAL_ONLY_GATE_MESSAGE).toContain("LITT_LOCAL_ONLY");
  });

  // ─── State-based, NOT keyword-based ────────────────────────────

  it("gate decision is independent of prompt wording", () => {
    // The gate doesn't see the prompt — it's a pure state check
    const blockRailway = shouldBlockModelPath(false, "local", false);
    const blockChat = shouldBlockModelPath(false, "local", false);
    expect(blockRailway).toBe(blockChat);
    expect(blockRailway).toBe(true);
  });
});
