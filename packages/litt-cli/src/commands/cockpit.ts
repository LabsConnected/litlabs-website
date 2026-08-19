/**
 * litt cockpit — interactive Ink cockpit mode.
 *
 * Launches the Ink-based cockpit UI. All execution routes through
 * ExecutionGateway. The cockpit itself never executes anything.
 *
 * Project detection walks upward from cwd — the user can launch
 * from any subdirectory and LiTT finds the project root.
 *
 * Approval flow:
 *   ExecutionGateway → onApprovalRequired → ApprovalBridge → Ink UI
 *   → human decides → ApprovalBridge.decide() → gateway continues
 *
 * Usage:  litt           (bare — defaults to cockpit)
 *         litt cockpit
 */

import { render } from "ink";
import React from "react";
import { CockpitApp } from "../ink/app.js";
import { CockpitErrorBoundary } from "../ink/cockpit-error-boundary.js";
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { RuntimeClient } from "../lib/runtime-client.js";
import { ensureConfig } from "../lib/config.js";
import { detectProject, fail, header, c } from "../lib/utils.js";
import { buildModelState, modelDisplayLabel } from "../lib/model-provider.js";
import { getGitState } from "../lib/git-state.js";
import { launchShellWindow } from "../lib/window-launcher.js";

export async function cockpitCommand(args: string[]): Promise<number> {
  // `litt shell --window` / `litt cockpit -w` — open a dedicated LiTT
  // terminal window (Windows Terminal profile) and return immediately.
  if (args[0] === "--window" || args[0] === "-w") {
    const launched = launchShellWindow(process.cwd());
    if (!launched) {
      fail("Could not open a LiTT window. Run 'litt shell' inside a terminal instead.");
      return 1;
    }
    console.log("⚡ LiTT window launched.");
    return 0;
  }

  // Check for TTY — Ink requires raw mode on stdin
  if (!process.stdin.isTTY) {
    fail("LiTT cockpit requires an interactive terminal (TTY).");
    console.error(`${c.dim}  You appear to be running in a non-interactive shell.${c.reset}`);
    console.error(`${c.dim}  Open a real PowerShell/terminal window and run 'litt' there.${c.reset}`);
    console.error(`${c.dim}  Or use non-interactive commands: litt doctor, litt status, litt run <cmd>${c.reset}`);
    return 1;
  }

  // First-run config bootstrap — creates ~/.litt/config.json if missing
  ensureConfig();

  // Auto-detect project root by walking upward from cwd.
  // The user can be in any subdirectory — LiTT finds the root.
  const project = detectProject();

  if (!project.hasPackageJson) {
    fail("No package.json found. LiTT needs a project to work with.");
    fail("Navigate to a project directory and try again.");
    return 1;
  }

  // Use the detected root consistently across the entire chain:
  //   detected root → RuntimeSession.cwd → ExecutionGateway projectId
  //   → ShellExecutor cwd → ToolContext workspace
  const projectRoot = project.rootDir;

  // Create the ApprovalBridge — connects gateway approval callbacks to the UI.
  const approvalBridge = new ApprovalBridge();

  // Create the SessionEventBridge — connects local RuntimeSession events
  // to the cockpit UI. When terminal-server is unavailable, the local
  // session IS the runtime, and its events flow through this bridge.
  const sessionBridge = new SessionEventBridge();

  // Create the RuntimeSession — owns the gateway, executor, store.
  // Wire both bridges: approval callbacks → ApprovalBridge,
  // runtime events → SessionEventBridge (for local event flow).
  const session = createRuntimeSession({
    cwd: projectRoot,
    mode: "act",
    onApprovalRequired: (request, risk) => approvalBridge.request(request, risk),
    onEvent: (event) => sessionBridge.onEvent(event),
    onStream: (chunk) => sessionBridge.onStream(chunk),
  });
  session.installSigintHandler();

  // ─── Startup recovery ───
  // Load any persisted active mission from disk. This is the automatic
  // restart/checkpoint recovery path. Non-terminal missions (working,
  // verifying, blocked) are restored; terminal missions (complete,
  // failed, cancelled) are NOT restored.
  const recovery = await session.startup();
  if (recovery.recovered && recovery.mission) {
    // The mission:restored event was already emitted by loadWithRecovery.
    // The SessionEventBridge will project it to the cockpit UI.
  }

  // Try to connect to terminal-server for realtime events
  let client: RuntimeClient | null = null;
  try {
    client = new RuntimeClient();
    await client.connect();
  } catch {
    // Non-fatal — cockpit works without realtime connection
    client = null;
  }

  // Model truth — provider availability ≠ model selection.
  // OPENROUTER_API_KEY means OpenRouter is available, NOT that Claude is active.
  // The cockpit displays the truthful model state:
  //   - activeModel only when the runtime has executed a request
  //   - configuredModel when a model is resolved but not yet active
  //   - "unresolved" when no provider is available or no model configured
  const modelState = buildModelState();
  const model = modelDisplayLabel(modelState);

  // If a command was provided as arg, run it through the gateway then exit
  if (args.length > 0) {
    header(`Dispatching: ${args.join(" ")}`);
    const gateway = session.getGateway();
    const result = await gateway.execute({
      toolId: "project.run",
      inputs: { command: args[0], args: args.slice(1) },
      cwd: projectRoot,
      mode: session.getMode(),
      identity: {
        tenantId: "cli-tenant",
        userId: "cli-user",
        actorId: "cli-user",
        trusted: false,
        interaction: "interactive",
      },
    });

    if (client) client.disconnect();
    return result.result.success ? 0 : 1;
  }

  // FILES counter — canonical git state (same source as litt doctor,
  // litt status, and the agent mission's project.status tool).
  const gitState = getGitState(projectRoot);
  const gitModified = gitState.changed;
  const gitUntracked = gitState.untracked;

  // Launch the Ink cockpit, wrapped in an error boundary (spec §39).
  const { waitUntilExit } = render(
    React.createElement(CockpitErrorBoundary, null,
      React.createElement(CockpitApp, {
        session,
        client,
        approvalBridge,
        sessionBridge,
        project: String(project.packageJson?.name ?? "unnamed"),
        branch: project.gitBranch ?? "unknown",
        model,
        cwd: projectRoot,
        mode: session.getMode(),
        gitModified,
        gitUntracked,
      }),
    ),
  );

  try {
    await waitUntilExit();
  } finally {
    if (client) client.disconnect();
  }

  return 0;
}
