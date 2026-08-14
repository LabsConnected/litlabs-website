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
import { ApprovalBridge } from "../ink/approval-bridge.js";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { RuntimeClient } from "../lib/runtime-client.js";
import { detectProject, fail, header, c } from "../lib/utils.js";

export async function cockpitCommand(args: string[]): Promise<number> {
  // Check for TTY — Ink requires raw mode on stdin
  if (!process.stdin.isTTY) {
    fail("LiTT cockpit requires an interactive terminal (TTY).");
    console.error(`${c.dim}  You appear to be running in a non-interactive shell.${c.reset}`);
    console.error(`${c.dim}  Open a real PowerShell/terminal window and run 'litt' there.${c.reset}`);
    console.error(`${c.dim}  Or use non-interactive commands: litt doctor, litt status, litt run <cmd>${c.reset}`);
    return 1;
  }

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

  // Try to connect to terminal-server for realtime events
  let client: RuntimeClient | null = null;
  try {
    client = new RuntimeClient();
    await client.connect();
  } catch {
    // Non-fatal — cockpit works without realtime connection
    client = null;
  }

  const model = process.env.OPENROUTER_API_KEY ? "claude-sonnet-4.6" : "heuristic";

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

  // Launch the Ink cockpit
  const { waitUntilExit } = render(
    React.createElement(CockpitApp, {
      session,
      client,
      approvalBridge,
      sessionBridge,
      project: String(project.packageJson?.name ?? "unnamed"),
      branch: project.gitBranch ?? "unknown",
      model,
      cwd: projectRoot,
    }),
  );

  try {
    await waitUntilExit();
  } finally {
    if (client) client.disconnect();
  }

  return 0;
}
