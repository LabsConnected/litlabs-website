/**
 * Execution target architecture tests — LOCAL-default / REMOTE-switchable.
 *
 * Tests the new execution-target resolution and runtime mode architecture:
 *   - Default execution target is LOCAL
 *   - --local flag → LOCAL
 *   - --remote flag → REMOTE
 *   - LITT_LOCAL_ONLY=1 → local + localOnly=true (emergency)
 *   - LITT_LOCAL_MODE=1 → local + localOnly=true (legacy)
 *   - resolveRuntimeMode returns the full RuntimeMode
 *   - dispatch.ts parses --local and --remote flags
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveRuntimeMode, resolveExecutionTarget, resolveLocalOnly, executionTargetLabel, type ExecutionTarget } from "../lib/execution-target.js";
import { resolveDispatch } from "../lib/dispatch.js";

describe("execution-target: resolveRuntimeMode", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  // ─── Default: LOCAL ────────────────────────────────────────────

  it("1. no flags/env → LOCAL + localOnly=false", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode();
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(false);
  });

  // ─── --local flag ──────────────────────────────────────────────

  it("2. --local flag → LOCAL + localOnly=false", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode("local");
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(false);
  });

  // ─── --remote flag ─────────────────────────────────────────────

  it("3. --remote flag → REMOTE + localOnly=false", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode("remote");
    expect(mode.executionTarget).toBe("remote");
    expect(mode.localOnly).toBe(false);
  });

  // ─── LITT_LOCAL_ONLY=1 ─────────────────────────────────────────

  it("LITT_LOCAL_ONLY=1 → LOCAL + localOnly=true (emergency)", () => {
    process.env.LITT_LOCAL_ONLY = "1";
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode();
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(true);
  });

  it("LITT_LOCAL_ONLY=1 overrides --remote flag", () => {
    process.env.LITT_LOCAL_ONLY = "1";
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode("remote");
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(true);
  });

  // ─── LITT_LOCAL_MODE=1 (legacy) ────────────────────────────────

  it("LITT_LOCAL_MODE=1 → LOCAL + localOnly=true (legacy)", () => {
    delete process.env.LITT_LOCAL_ONLY;
    process.env.LITT_LOCAL_MODE = "1";
    delete process.env.LITT_TARGET_OVERRIDE;
    const mode = resolveRuntimeMode();
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(true);
  });

  // ─── LITT_TARGET_OVERRIDE env ──────────────────────────────────

  it("LITT_TARGET_OVERRIDE=remote → REMOTE", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    process.env.LITT_TARGET_OVERRIDE = "remote";
    const mode = resolveRuntimeMode();
    expect(mode.executionTarget).toBe("remote");
    expect(mode.localOnly).toBe(false);
  });

  it("LITT_TARGET_OVERRIDE=local → LOCAL", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    process.env.LITT_TARGET_OVERRIDE = "local";
    const mode = resolveRuntimeMode();
    expect(mode.executionTarget).toBe("local");
    expect(mode.localOnly).toBe(false);
  });

  it("explicit flagTarget overrides LITT_TARGET_OVERRIDE env", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    process.env.LITT_TARGET_OVERRIDE = "local";
    const mode = resolveRuntimeMode("remote");
    expect(mode.executionTarget).toBe("remote");
  });

  // ─── Backward compat ───────────────────────────────────────────

  it("resolveExecutionTarget returns just the target", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    delete process.env.LITT_TARGET_OVERRIDE;
    expect(resolveExecutionTarget()).toBe("local");
    expect(resolveExecutionTarget("remote")).toBe("remote");
  });

  it("resolveLocalOnly returns the localOnly flag", () => {
    delete process.env.LITT_LOCAL_ONLY;
    delete process.env.LITT_LOCAL_MODE;
    expect(resolveLocalOnly()).toBe(false);
    process.env.LITT_LOCAL_ONLY = "1";
    expect(resolveLocalOnly()).toBe(true);
  });

  it("executionTargetLabel returns human label", () => {
    expect(executionTargetLabel("local")).toBe("LOCAL");
    expect(executionTargetLabel("remote")).toBe("REMOTE");
  });
});

// ─── Dispatch flag parsing ─────────────────────────────────────────

describe("dispatch: --local and --remote flags", () => {
  it("bare `litt` → no targetOverride (default LOCAL)", () => {
    const result = resolveDispatch([]);
    expect(result.command).toBe("cockpit");
    expect(result.targetOverride).toBeUndefined();
  });

  it("litt --local → targetOverride=local", () => {
    const result = resolveDispatch(["--local"]);
    expect(result.command).toBe("cockpit");
    expect(result.targetOverride).toBe("local");
  });

  it("litt --remote → targetOverride=remote + useRemote=true", () => {
    const result = resolveDispatch(["--remote"]);
    expect(result.command).toBe("cockpit");
    expect(result.targetOverride).toBe("remote");
    expect(result.useRemote).toBe(true);
  });

  it("litt shell --local → targetOverride=local", () => {
    const result = resolveDispatch(["shell", "--local"]);
    expect(result.command).toBe("shell");
    expect(result.targetOverride).toBe("local");
  });

  it("litt --remote --local → --remote wins (targetOverride=remote)", () => {
    const result = resolveDispatch(["--remote", "--local"]);
    expect(result.targetOverride).toBe("remote");
  });

  it("litt --local --cwd /path → both parsed", () => {
    const result = resolveDispatch(["--local", "--cwd", "/test/path"]);
    expect(result.targetOverride).toBe("local");
    expect(result.cwd).toBe("/test/path");
  });

  it("litt --help → no targetOverride", () => {
    const result = resolveDispatch(["--help"]);
    expect(result.isHelp).toBe(true);
    expect(result.targetOverride).toBeUndefined();
  });
});
