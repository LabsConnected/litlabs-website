/**
 * Post-login workspace onboarding tests.
 *
 * Tests the `onboardWorkspaceSelection` function in isolation — no real
 * network, no real stdin. The fetch function and prompt function are
 * injected, making this fully deterministic.
 *
 * Covers:
 *   - Zero ready workspaces → none_ready (no selection persisted)
 *   - One ready workspace → auto-selected and persisted
 *   - Multiple ready workspaces → prompt shown, valid choice persisted
 *   - Multiple ready workspaces → invalid input → cancelled (no persistence)
 *   - Multiple ready workspaces → empty input → cancelled (no persistence)
 *   - fetchWorkspaces throws → skipped (no persistence, no crash)
 *   - Persisted selection uses remote-workspace-store.ts (not config.ts)
 *   - Persisted selection round-trips through getSelectedRemoteWorkspace
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSelectedRemoteWorkspace,
} from "../lib/remote-workspace-store.js";
import {
  onboardWorkspaceSelection,
  type WorkspaceOnboardingResult,
} from "../commands/workspace.js";
import type { RemoteWorkspace } from "../lib/remote.js";

// ─── Test fixtures ────────────────────────────────────────────────

const WS_A: RemoteWorkspace = {
  workspaceId: "ws-alpha",
  projectId: "proj-a",
  root: "/data/projects/alpha-app",
  branch: "main",
};

const WS_B: RemoteWorkspace = {
  workspaceId: "ws-beta",
  projectId: "proj-b",
  root: "/data/projects/beta-service",
  branch: "dev",
};

const WS_C: RemoteWorkspace = {
  workspaceId: "ws-gamma",
  projectId: "proj-c",
  root: "/data/projects/gamma-tool",
  branch: "main",
};

// ─── Test harness ─────────────────────────────────────────────────

let tempDir: string;
let storeFile: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "litt-onboard-"));
  storeFile = join(tempDir, "remote-workspace.json");
  process.env.LITT_REMOTE_WORKSPACE_FILE = storeFile;
});

afterEach(() => {
  delete process.env.LITT_REMOTE_WORKSPACE_FILE;
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────

describe("onboardWorkspaceSelection", () => {
  it("returns none_ready when zero workspaces are ready", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [],
      async () => { throw new Error("should not prompt"); },
    );

    expect(result.status).toBe("none_ready");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("auto-selects and persists when exactly one workspace is ready", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A],
      async () => { throw new Error("should not prompt for single workspace"); },
    );

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.workspaceId).toBe("ws-alpha");
    }

    // Verify persistence through remote-workspace-store.ts
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted).not.toBeNull();
    expect(persisted!.workspaceId).toBe("ws-alpha");
    expect(persisted!.projectId).toBe("proj-a");
    expect(persisted!.root).toBe("/data/projects/alpha-app");
    expect(persisted!.branch).toBe("main");
    expect(persisted!.selectedAt).toBeGreaterThan(0);
  });

  it("prompts and persists on valid selection when multiple workspaces exist", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B, WS_C],
      async (_q: string) => "2",
    );

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.workspaceId).toBe("ws-beta");
    }

    const persisted = getSelectedRemoteWorkspace();
    expect(persisted).not.toBeNull();
    expect(persisted!.workspaceId).toBe("ws-beta");
    expect(persisted!.projectId).toBe("proj-b");
  });

  it("returns cancelled on invalid numeric input (out of range)", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "5",
    );

    expect(result.status).toBe("cancelled");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("returns cancelled on invalid numeric input (zero)", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "0",
    );

    expect(result.status).toBe("cancelled");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("returns cancelled on non-numeric input", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "abc",
    );

    expect(result.status).toBe("cancelled");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("returns cancelled on empty input", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "  ",
    );

    expect(result.status).toBe("cancelled");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("returns skipped when fetchWorkspaces throws (service unreachable)", async () => {
    const result = await onboardWorkspaceSelection(
      async () => { throw new Error("Network error"); },
      async () => { throw new Error("should not prompt"); },
    );

    expect(result.status).toBe("skipped");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });

  it("does not re-prompt if a selection is already persisted", async () => {
    // This tests the login.ts guard, not onboardWorkspaceSelection itself.
    // onboardWorkspaceSelection always runs; login.ts checks before calling.
    // Here we verify that calling onboard with an existing store file
    // still works (overwrites), since onboard is a pure function.
    // The login.ts guard is tested separately via integration.

    // Pre-populate the store
    const { setSelectedRemoteWorkspace } = await import("../lib/remote-workspace-store.js");
    setSelectedRemoteWorkspace({
      workspaceId: "ws-existing",
      projectId: "proj-existing",
      root: "/data/existing",
      branch: "main",
    });

    // onboard should still work (it doesn't check existing state)
    const result = await onboardWorkspaceSelection(
      async () => [WS_A],
      async () => { throw new Error("should not prompt"); },
    );

    expect(result.status).toBe("selected");
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted!.workspaceId).toBe("ws-alpha");
  });

  it("persists through remote-workspace-store.ts (not config.ts)", async () => {
    // Verify the store file is at the LITT_REMOTE_WORKSPACE_FILE path,
    // not in config.json. This is the canonical persistence model.
    const { existsSync } = await import("node:fs");
    const { join: joinPath } = await import("node:path");

    await onboardWorkspaceSelection(
      async () => [WS_A],
      async () => { throw new Error("should not prompt"); },
    );

    // The selection file exists at the remote-workspace path
    expect(existsSync(storeFile)).toBe(true);

    // The config.json file should NOT contain workspace selection
    const configPath = joinPath(tempDir, "config.json");
    expect(existsSync(configPath)).toBe(false);
  });

  it("handles whitespace-padded numeric input correctly", async () => {
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "  1  ",
    );

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.workspaceId).toBe("ws-alpha");
    }
  });

  it("clears previous selection when a new one is made", async () => {
    const { setSelectedRemoteWorkspace } = await import("../lib/remote-workspace-store.js");

    // Set an initial selection
    setSelectedRemoteWorkspace({
      workspaceId: "ws-old",
      projectId: "proj-old",
      root: "/data/old",
      branch: "main",
    });

    // Onboard with a new single workspace
    const result = await onboardWorkspaceSelection(
      async () => [WS_B],
      async () => { throw new Error("should not prompt"); },
    );

    expect(result.status).toBe("selected");
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted!.workspaceId).toBe("ws-beta");
    expect(persisted!.workspaceId).not.toBe("ws-old");
  });

  it("returns cancelled when prompt returns empty string (non-interactive stdin)", async () => {
    // Simulates CI / piped stdin / SSH without TTY where the prompt
    // resolves to an empty string instead of hanging.
    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async (_q: string) => "",
    );

    expect(result.status).toBe("cancelled");
    expect(getSelectedRemoteWorkspace()).toBeNull();
  });
});

// ─── Numbered workspace list presentation tests ───────────────────

describe("onboardWorkspaceSelection — numbered list output", () => {
  it("prints a numbered list of all workspaces before prompting", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B, WS_C],
      async (_q: string) => "2",
      outputFn,
    );

    expect(result.status).toBe("selected");

    // The list should contain a header and one numbered line per workspace
    expect(outputLines).toContain("Available workspaces:");
    expect(outputLines.some((l) => l.includes("1.") && l.includes("alpha-app"))).toBe(true);
    expect(outputLines.some((l) => l.includes("2.") && l.includes("beta-service"))).toBe(true);
    expect(outputLines.some((l) => l.includes("3.") && l.includes("gamma-tool"))).toBe(true);

    // Each line should include the branch
    expect(outputLines.some((l) => l.includes("(main)") && l.includes("alpha-app"))).toBe(true);
    expect(outputLines.some((l) => l.includes("(dev)") && l.includes("beta-service"))).toBe(true);
  });

  it("numbers align with selection mapping — choosing 2 persists WS_B", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B, WS_C],
      async (_q: string) => "2",
      outputFn,
    );

    expect(result.status).toBe("selected");
    if (result.status === "selected") {
      expect(result.workspace.workspaceId).toBe("ws-beta");
    }
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted!.workspaceId).toBe("ws-beta");
    expect(persisted!.workspaceId).not.toBe("ws-alpha");
  });

  it("numbers align with selection mapping — choosing 1 persists WS_A", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B, WS_C],
      async (_q: string) => "1",
      outputFn,
    );

    expect(result.status).toBe("selected");
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted!.workspaceId).toBe("ws-alpha");
  });

  it("numbers align with selection mapping — choosing 3 persists WS_C", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    const result = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B, WS_C],
      async (_q: string) => "3",
      outputFn,
    );

    expect(result.status).toBe("selected");
    const persisted = getSelectedRemoteWorkspace();
    expect(persisted!.workspaceId).toBe("ws-gamma");
  });

  it("does not print a numbered list for zero workspaces", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    await onboardWorkspaceSelection(
      async () => [],
      async () => { throw new Error("should not prompt"); },
      outputFn,
    );

    expect(outputLines).not.toContain("Available workspaces:");
  });

  it("does not print a numbered list for single workspace (auto-selected)", async () => {
    const outputLines: string[] = [];
    const outputFn = (line: string) => { outputLines.push(line); };

    await onboardWorkspaceSelection(
      async () => [WS_A],
      async () => { throw new Error("should not prompt"); },
      outputFn,
    );

    expect(outputLines).not.toContain("Available workspaces:");
  });
});

// ─── Result type exhaustiveness ───────────────────────────────────

describe("WorkspaceOnboardingResult type", () => {
  it("all status variants are producible", async () => {
    const noneReady: WorkspaceOnboardingResult = await onboardWorkspaceSelection(
      async () => [],
      async () => "",
    );
    expect(noneReady.status).toBe("none_ready");

    const selected: WorkspaceOnboardingResult = await onboardWorkspaceSelection(
      async () => [WS_A],
      async () => "",
    );
    expect(selected.status).toBe("selected");

    const skipped: WorkspaceOnboardingResult = await onboardWorkspaceSelection(
      async () => { throw new Error("offline"); },
      async () => "",
    );
    expect(skipped.status).toBe("skipped");

    const cancelled: WorkspaceOnboardingResult = await onboardWorkspaceSelection(
      async () => [WS_A, WS_B],
      async () => "invalid",
    );
    expect(cancelled.status).toBe("cancelled");
  });
});
