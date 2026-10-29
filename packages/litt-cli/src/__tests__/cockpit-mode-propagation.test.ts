/**
 * Cockpit --mode propagation regression.
 *
 * Guards the fix for `litt --mode plan` launching the cockpit in ACT:
 *   argv --mode flag
 *     → resolveDispatch (dispatch.ts) parses mode
 *     → index.ts binds dispatch.mode into the lazy cockpit handler
 *     → cockpitCommand threads it into createRuntimeSession
 *     → CockpitApp receives session.getMode() as its initial mode prop
 *
 * The cockpit path is special: unlike `litt ask`, cockpit is NOT in
 * SESSION_COMMANDS — it builds its own RuntimeSession internally, which
 * used to hardcode mode: "act" and silently discard the flag.
 *
 * Termux-specific: the Termux `litt` wrapper injects `--cwd "$PWD"` into
 * argv, so the exact phone launch vector is `--cwd <dir> --mode plan`.
 * Verified broken on Android Termux @ fix/studio-false-completion
 * (7701ef40) — cockpit launched, ACT stayed selected.
 *
 * Tracked under Dex SUPER Phase A (see tune/RUNBOOK.md).
 *
 * Ink, the cockpit UI tree, and process-external edges (terminal
 * teardown, window launcher, runtime client, auth) are mocked; dispatch
 * parsing, option threading, and session construction arguments are the
 * real production code path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cockpitCommand } from "../commands/cockpit.js";
import { resolveDispatch } from "../lib/dispatch.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { launchShellWindow, currentCliCommand } from "../lib/window-launcher.js";
import { render } from "ink";

const sessionCalls: Array<Record<string, unknown>> = [];
const renderedElements: ReactElement[] = [];

vi.mock("ink", () => ({
  render: vi.fn((element: ReactElement) => {
    renderedElements.push(element);
    return {
      waitUntilExit: vi.fn(async () => {}),
      rerender: vi.fn(),
      unmount: vi.fn(),
    };
  }),
}));

vi.mock("../ink/app.js", () => ({
  CockpitApp: () => null,
}));
vi.mock("../ink/cockpit-error-boundary.js", () => ({
  CockpitErrorBoundary: ({ children }: { children: unknown }) => children,
}));
vi.mock("../ink/approval-bridge.js", () => ({
  ApprovalBridge: class {
    request = vi.fn();
  },
}));
vi.mock("../ink/session-event-bridge.js", () => ({
  SessionEventBridge: class {
    onEvent = vi.fn();
    onStream = vi.fn();
  },
}));

vi.mock("../lib/runtime-session.js", async (original) => ({
  ...(await original<typeof import("../lib/runtime-session.js")>()),
  createRuntimeSession: vi.fn((options: Record<string, unknown>) => {
    sessionCalls.push(options);
    return {
      installSigintHandler: vi.fn(),
      startup: vi.fn(async () => ({ recovered: false })),
      getGateway: vi.fn(),
      getMode: () => options.mode,
      getCwd: () => options.cwd,
      setOnPersistBeforeExit: vi.fn(),
    };
  }),
}));

vi.mock("../lib/utils.js", async (original) => ({
  ...(await original<typeof import("../lib/utils.js")>()),
  detectProject: vi.fn(() => ({
    hasPackageJson: true,
    isSelfInstall: false,
    rootDir: "/tmp/litt-mode-test",
    packageJson: { name: "litt-mode-test" },
    gitBranch: "fix/mode-test",
  })),
  resolveProjectCwd: vi.fn(() => "/tmp/litt-mode-test"),
}));

vi.mock("../lib/config.js", async (original) => ({
  ...(await original<typeof import("../lib/config.js")>()),
  ensureConfig: vi.fn(),
}));

vi.mock("../lib/active-project.js", async (original) => ({
  ...(await original<typeof import("../lib/active-project.js")>()),
  resolveActiveProject: vi.fn(async () => null),
  activeProjectDisplay: vi.fn(() => ""),
}));

vi.mock("../lib/model-provider.js", async (original) => ({
  ...(await original<typeof import("../lib/model-provider.js")>()),
  buildModelState: vi.fn(() => null),
  modelDisplayLabel: vi.fn(() => "test-model"),
}));

vi.mock("../lib/git-state.js", async (original) => ({
  ...(await original<typeof import("../lib/git-state.js")>()),
  getGitState: vi.fn(() => ({ changed: 0, untracked: 0 })),
}));

vi.mock("../lib/window-launcher.js", async (original) => ({
  ...(await original<typeof import("../lib/window-launcher.js")>()),
  launchShellWindow: vi.fn(() => ({ ok: true, path: "wt-unsized" })),
  currentCliCommand: vi.fn((extraArgs: string[] = []) => ({
    exe: "/usr/bin/node",
    args: ["dist/index.js", ...extraArgs],
  })),
}));

vi.mock("../lib/runtime-client.js", () => ({
  RuntimeClient: class {
    connect = vi.fn(() => Promise.resolve());
    disconnect = vi.fn();
  },
}));

vi.mock("../lib/auth/auth-session.js", async (original) => ({
  ...(await original<typeof import("../lib/auth/auth-session.js")>()),
  getAuthSession: vi.fn(() => ({
    isSignedIn: async () => false,
    getAuthState: async () => ({ signedIn: false, email: null }),
  })),
}));

vi.mock("../lib/terminal-teardown.js", async (original) => ({
  ...(await original<typeof import("../lib/terminal-teardown.js")>()),
  installTerminalTeardown: vi.fn(() => vi.fn()),
  restoreTerminal: vi.fn(),
}));

const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
  sessionCalls.length = 0;
  renderedElements.length = 0;
  // The cockpit refuses to launch without a TTY; tests run headless, so
  // the launch gate sees a terminal while Ink itself stays mocked.
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
    writable: true,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(process.stdin, "isTTY", {
    value: originalIsTTY,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe("litt --mode propagation into the cockpit", () => {
  it("parses --mode plan through the Termux launcher arg shape (--cwd injected)", () => {
    const d = resolveDispatch([
      "--cwd",
      "/data/data/com.termux/files/home/project",
      "--mode",
      "plan",
    ]);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
    expect(d.mode).toBe("plan");
    expect(d.cwd).toBe("/data/data/com.termux/files/home/project");
  });

  it("cockpitCommand({ mode: 'plan' }) builds the RuntimeSession in plan mode", async () => {
    // Exactly what index.ts's lazy cockpit handler binds for
    // `litt --mode plan` after dispatch.
    expect(await cockpitCommand([], { mode: "plan" })).toBe(0);
    expect(sessionCalls).toHaveLength(1);
    expect(sessionCalls[0]!.mode).toBe("plan");
  });

  it("cockpitCommand({ mode: 'plan' }) renders CockpitApp with the session's plan mode", async () => {
    expect(await cockpitCommand([], { mode: "plan" })).toBe(0);
    expect(renderedElements.length).toBeGreaterThan(0);
    // render() receives <CockpitErrorBoundary><CockpitApp …/></…>;
    // the boundary mock passes children through, so the pushed element's
    // props.children is the CockpitApp element.
    const cockpitElement = renderedElements[0]!.props
      .children as ReactElement;
    expect(cockpitElement.props.mode).toBe("plan");
  });

  it("cockpitCommand() defaults to act when no mode is provided", async () => {
    expect(await cockpitCommand([])).toBe(0);
    expect(sessionCalls[0]!.mode).toBe("act");
  });

  it("cockpitCommand({ mode: 'act' }) keeps act explicit", async () => {
    expect(await cockpitCommand([], { mode: "act" })).toBe(0);
    expect(sessionCalls[0]!.mode).toBe("act");
  });

  it("--window relaunch preserves --mode in the spawned argv", async () => {
    expect(await cockpitCommand(["--window"], { mode: "plan" })).toBe(0);
    expect(currentCliCommand).toHaveBeenCalledWith([
      "shell",
      "--mode",
      "plan",
    ]);
    expect(launchShellWindow).toHaveBeenCalled();
    // The windowed path never builds a session — it exits after spawning.
    expect(sessionCalls).toHaveLength(0);
  });
});
