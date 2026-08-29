/**
 * Capability gate regression tests — signed-out local-only mode.
 *
 * Tests the `shouldBlockModelPath` pure function that decides whether
 * the model/remote path must be blocked because the cockpit is in
 * signed-out local-only mode.
 *
 * The rule: signed out + local-only mode = no model/network path, period.
 *
 * This is a CAPABILITY gate based on session/auth/local-mode state,
 * NOT a keyword matcher. It does not inspect prompt wording.
 */

import { describe, it, expect } from "vitest";
import { shouldBlockModelPath } from "../lib/capability-gate.js";

describe("capability gate: shouldBlockModelPath", () => {
  // ─── Core rule: signed out + local mode = BLOCK ────────────────

  it("blocks when signed out + local mode", () => {
    expect(shouldBlockModelPath(false, "local")).toBe(true);
  });

  // ─── Authenticated mode: NEVER block ───────────────────────────

  it("does NOT block when signed in + local mode", () => {
    // BYOK local mode with auth — user can use local model provider
    expect(shouldBlockModelPath(true, "local")).toBe(false);
  });

  it("does NOT block when signed in + remote mode", () => {
    // Normal authenticated cloud mode
    expect(shouldBlockModelPath(true, "remote")).toBe(false);
  });

  it("does NOT block when signed out + remote mode", () => {
    // Remote mode requires auth at the gate (index.ts) — if somehow
    // reached, the gate doesn't block here; the provider call will fail
    // with a clear auth error. The capability gate is specifically for
    // the local-only signed-out case.
    expect(shouldBlockModelPath(false, "remote")).toBe(false);
  });

  // ─── Unknown auth state: do NOT block (avoid false positives) ──

  it("does NOT block when auth state is null (not yet resolved)", () => {
    // During the brief startup window before auth resolves, don't block
    expect(shouldBlockModelPath(null, "local")).toBe(false);
  });

  it("does NOT block when auth state is undefined (not provided)", () => {
    expect(shouldBlockModelPath(undefined, "local")).toBe(false);
  });

  // ─── The gate is state-based, NOT keyword-based ────────────────
  // These tests verify the gate's decision does not depend on any
  // prompt wording — it's purely auth + execution-target state.

  it("gate decision is independent of prompt wording (Railway)", () => {
    // The gate doesn't see the prompt at all — it's a pure state check
    const blockRailwayRequest = shouldBlockModelPath(false, "local");
    const blockChatRequest = shouldBlockModelPath(false, "local");
    // Both are blocked equally — the gate doesn't care what the prompt says
    expect(blockRailwayRequest).toBe(blockChatRequest);
    expect(blockRailwayRequest).toBe(true);
  });

  it("gate decision is independent of prompt wording (casual chat)", () => {
    // "Explain React hooks" is blocked the same as "Show Railway filesystem"
    // — both need the model, and the model is unavailable signed out
    expect(shouldBlockModelPath(false, "local")).toBe(true);
  });
});

// ─── Integration contract: what the gate protects against ──────────

describe("capability gate: protected paths (contract)", () => {
  // These tests document the contract: when the gate is active
  // (shouldBlockModelPath === true), the following must NOT be called:
  //   - classifyIntent()
  //   - resolveModelProvider()
  //   - awaitRemoteReady()
  //   - RemoteModelProvider
  //   - streamModel()
  //   - any fetch() to terminal-server
  //
  // The gate returns a local UI response instead. The controller's
  // implementation places the gate AFTER all local-only routing paths
  // (LOCAL fast lane, MACHINE lane, slash commands) and BEFORE
  // classifyIntent() — so anything that reaches the gate has already
  // failed to match a local-only path and needs model/remote capability.

  it("the gate blocks BEFORE classifyIntent (by construction)", () => {
    // If shouldBlockModelPath returns true, the controller returns early
    // before reaching classifyIntent(). This is verified by the code
    // structure: the gate is placed after machine-lane and before
    // classifyIntent() in the submit flow.
    // Here we just verify the decision function returns the right value.
    expect(shouldBlockModelPath(false, "local")).toBe(true);
  });

  it("the gate does NOT block local-only paths (by construction)", () => {
    // LOCAL fast lane, MACHINE lane, and slash commands are handled
    // BEFORE the gate in the controller. They never reach the gate.
    // The gate only blocks what falls through after all local paths
    // have failed to match.
    expect(shouldBlockModelPath(true, "local")).toBe(false);
    expect(shouldBlockModelPath(false, "remote")).toBe(false);
  });
});
