/**
 * litt cockpit — interactive Ink cockpit mode.
 *
 * Launches the Ink-based cockpit UI. All execution routes through
 * ExecutionGateway. The cockpit itself never executes anything.
 *
 * Usage:  litt cockpit
 */

import { render } from "ink";
import React from "react";
import { CockpitApp } from "../ink/app.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { RuntimeClient } from "../lib/runtime-client.js";
import { detectProject, fail, header } from "../lib/utils.js";

export async function cockpitCommand(args: string[]): Promise<number> {
  const project = detectProject();

  if (!project.hasPackageJson) {
    fail("No package.json found. Run this command from your project root.");
    return 1;
  }

  // Create the RuntimeSession — owns the gateway, executor, store
  const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
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
      cwd: process.cwd(),
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
      project: String(project.packageJson?.name ?? "unnamed"),
      branch: project.gitBranch ?? "unknown",
      model,
      cwd: process.cwd(),
    }),
  );

  try {
    await waitUntilExit();
  } finally {
    if (client) client.disconnect();
  }

  return 0;
}
