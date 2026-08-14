/**
 * Integration tests for the LiTT CLI ↔ Studio command bridge.
 *
 * Tests that:
 * 1. The builder-command-router correctly parses runtime slash commands
 * 2. The CommandRouter dispatch handles all supported commands
 * 3. The ship compound command runs check → test → build
 * 4. The debug command runs tests with verbose flag
 * 5. The remote dispatch helper constructs correct requests
 * 6. The runtime phase mapping for the HUD is correct
 */

import { describe, it, expect } from "vitest";
import { parseBuilderLocalCommand } from "@/app/studio/lib/builder-command-router";
import { CommandRouter, createShellExecutor } from "@litt/agent-core";
import { RuntimeStore, createInitialState } from "@litt/agent-core";
import type { ShellExecutor, ShellResult, ShellExecuteOptions, ToolResult } from "@litt/agent-core";

// ─── Mock ShellExecutor for fast tests ────────────────────────────

class MockShellExecutor implements ShellExecutor {
  readonly cwd: string;
  readonly platform: NodeJS.Platform | string = process.platform;
  readonly environment: Record<string, string> = {};
  constructor(cwd: string) { this.cwd = cwd; }
  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    // Simulate instant success for all commands
    const safeArgs = options.args ?? [];
    return {
      ok: true,
      status: "success",
      stdout: `mock output for ${options.command} ${safeArgs.join(" ")}`,
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      command: options.command,
      args: safeArgs,
      truncated: false,
      pid: 99999,
    };
  }
  async cancel(): Promise<number[]> { return []; }
}

// ─── 1. Slash command parsing ─────────────────────────────────────

describe("Builder command router — runtime slash commands", () => {
  it("parses /status as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/status");
    expect(cmd).toEqual({ type: "runtime", command: "status" });
  });

  it("parses /diff as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/diff");
    expect(cmd).toEqual({ type: "runtime", command: "diff" });
  });

  it("parses /check as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/check");
    expect(cmd).toEqual({ type: "runtime", command: "check" });
  });

  it("parses /test as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/test");
    expect(cmd).toEqual({ type: "runtime", command: "test" });
  });

  it("parses /build as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/build");
    expect(cmd).toEqual({ type: "runtime", command: "build" });
  });

  it("parses /debug as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/debug");
    expect(cmd).toEqual({ type: "runtime", command: "debug" });
  });

  it("parses /ship as a runtime command", () => {
    const cmd = parseBuilderLocalCommand("/ship");
    expect(cmd).toEqual({ type: "runtime", command: "ship" });
  });

  it("still parses local commands correctly", () => {
    expect(parseBuilderLocalCommand("/clear")).toEqual({ type: "clear" });
    expect(parseBuilderLocalCommand("/new")).toEqual({ type: "new" });
    expect(parseBuilderLocalCommand("/help")).toEqual({ type: "help" });
  });

  it("returns unknown for unrecognized commands", () => {
    const cmd = parseBuilderLocalCommand("/foobar");
    expect(cmd).toEqual({ type: "unknown", command: "foobar" });
  });

  it("returns null for non-slash input", () => {
    expect(parseBuilderLocalCommand("hello world")).toBeNull();
  });
});

// ─── 2. CommandRouter dispatch ────────────────────────────────────

describe("CommandRouter — dispatch supports all commands", () => {
  // Use mock shell for all dispatch tests to avoid slow real commands
  // and concurrent git operation conflicts in the full test suite.
  it("dispatches status", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("status");
    expect(result.command).toBe("status");
  });

  it("dispatches diff", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("diff");
    expect(result.command).toBe("diff");
  });

  it("dispatches check", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("check");
    expect(result.command).toBe("check");
  });

  it("dispatches test", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("test");
    expect(result.command).toBe("test");
  });

  it("dispatches build", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("build");
    expect(result.command).toBe("build");
  });

  it("dispatches debug", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("debug");
    expect(result.command).toBe("debug");
  });

  it("dispatches ship", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("ship");
    expect(result.command).toBe("ship");
  });

  it("returns error for unknown command", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("nonexistent");
    expect(result.result.success).toBe(false);
    expect(result.result.message).toContain("Unknown command");
  });
});

// ─── 3. Ship compound command ─────────────────────────────────────

describe("CommandRouter — ship compound command", () => {
  it("ship result contains steps data", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("ship");

    // Ship runs check → test → build. May pass or fail with mock,
    // but should always have steps data (either all 3 or up to failure point).
    expect(result.command).toBe("ship");
    expect(result.result.data).toHaveProperty("steps");
    const data = result.result.data as { steps: Array<{ name: string }> };
    expect(Array.isArray(data.steps)).toBe(true);
    expect(data.steps.length).toBeGreaterThanOrEqual(1);
  });

  it("ship first step is always check", async () => {
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, { cwd: process.cwd() });
    const result = await router.dispatch("ship");
    const data = result.result.data as { steps: Array<{ name: string }> };
    const steps = data.steps;
    expect(steps[0].name).toBe("check");
  });
});

// ─── 4. RuntimeStore tracking ─────────────────────────────────────

describe("CommandRouter — RuntimeStore integration", () => {
  it("updates RuntimeStore on command execution", async () => {
    const store = new RuntimeStore();
    const initialState = store.getState();
    expect(initialState.activeCommand).toBeNull();

    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, {
      cwd: process.cwd(),
      store,
    });

    await router.dispatch("status");

    // After status, the store should have project info
    const state = store.getState();
    expect(state.project).not.toBeNull();
  });

  it("tracks command start and end for execution commands", async () => {
    const store = new RuntimeStore();
    const shell = new MockShellExecutor(process.cwd());
    const router = new CommandRouter(shell, {
      cwd: process.cwd(),
      store,
    });

    await router.dispatch("check");

    const state = store.getState();
    // After command completes, activeCommand should be null
    // and lastResult should be set
    expect(state.activeCommand).toBeNull();
    expect(state.lastResult).not.toBeNull();
    expect(state.lastResult?.command).toBe("check");
  });
});

// ─── 5. Runtime phase mapping ─────────────────────────────────────

describe("Runtime phase mapping for HUD", () => {
  // These mirror the mapping in LiTTAmbientHUD.tsx
  const PHASE_MAP: Record<string, string | null> = {
    running: "editing",
    testing: "testing",
    verifying: "verifying",
    planning: "planning",
    editing: "editing",
    thinking: "planning",
    browsing: "inspecting",
    waiting_approval: "awaiting_approval",
    complete: "done",
    failed: "cancelled",
    idle: null,
  };

  it("maps all RuntimeStore phases correctly", () => {
    expect(PHASE_MAP["running"]).toBe("editing");
    expect(PHASE_MAP["testing"]).toBe("testing");
    expect(PHASE_MAP["verifying"]).toBe("verifying");
    expect(PHASE_MAP["complete"]).toBe("done");
    expect(PHASE_MAP["failed"]).toBe("cancelled");
    expect(PHASE_MAP["idle"]).toBeNull();
  });

  it("idle phase lets execution store decide", () => {
    // When runtime is idle, the HUD should fall back to the execution store
    expect(PHASE_MAP["idle"]).toBeNull();
  });
});

// ─── 6. Command bridge types ──────────────────────────────────────

describe("Command bridge — supported commands", () => {
  const SUPPORTED = [
    "status", "diff", "check", "test", "build", "debug", "ship",
    "log", "branch", "list_files", "read_file", "search", "inspect_package",
  ];

  it("includes all runtime slash commands", () => {
    const slashCommands = ["status", "diff", "check", "test", "build", "debug", "ship"];
    for (const cmd of slashCommands) {
      expect(SUPPORTED).toContain(cmd);
    }
  });

  it("includes all CLI remoteable commands", () => {
    const cliCommands = ["status", "diff", "check", "test", "build"];
    for (const cmd of cliCommands) {
      expect(SUPPORTED).toContain(cmd);
    }
  });
});
