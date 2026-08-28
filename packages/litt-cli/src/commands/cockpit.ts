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
import { detectProject, fail, header, c, resolveProjectCwd } from "../lib/utils.js";
import { resolveActiveProject, activeProjectDisplay } from "../lib/active-project.js";
import { buildModelState, modelDisplayLabel } from "../lib/model-provider.js";
import { getGitState } from "../lib/git-state.js";
import { launchShellWindow, currentCliCommand } from "../lib/window-launcher.js";
import { getAuthSession } from "../lib/auth/auth-session.js";
import { installTerminalTeardown, restoreTerminal } from "../lib/terminal-teardown.js";

export async function cockpitCommand(args: string[]): Promise<number> {
  // Terminal state is process-external: whatever LiTT leaves enabled
  // leaks into the parent shell. installTerminalTeardown() hooks every
  // exit path (normal exit, process.exit, SIGTERM/SIGHUP/SIGBREAK,
  // uncaught exception, unhandled rejection) and hands back a terminal
  // with mouse reporting off, bracketed paste off, raw mode off and the
  // cursor visible. See lib/terminal-teardown.ts.
  const disposeTeardown = installTerminalTeardown();

  // `litt shell --window` / `litt cockpit -w` — open a dedicated LiTT
  // terminal window (Windows Terminal profile) and return immediately.
  if (args[0] === "--window" || args[0] === "-w") {
    // Re-launch THIS build (node.exe + the running CLI entry) so the new
    // window can never drift to an older global `litt` install.
    // Default (useSizing omitted): dedicated WT window at the user's
    // native size — no hard dependency on `--size`. The 118×36 sized
    // vector stays available for visual acceptance via useSizing:true.
    const result = launchShellWindow(process.cwd(), currentCliCommand(["shell"]));
    if (!result.ok) {
      fail("Could not open a LiTT window. Run 'litt shell' inside a terminal instead.");
      return 1;
    }
    const detail = result.path === "wt-sized"
      ? "dedicated Windows Terminal window"
      : result.path === "wt-unsized"
        ? "dedicated Windows Terminal window (no sizing)"
        : "PowerShell window";
    console.log(`LiTT window launched (${detail}).`);
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

  // Auto-detect project root by walking upward from the resolved cwd.
  // Resolution: --cwd flag > LITT_CWD env > process.cwd(). A launcher
  // that chdir'd into the LiTT install dir passes the caller's real
  // directory via --cwd / LITT_CWD so LiTT inspects the user's repo,
  // not its own runtime copy. detectProject also guards against
  // self-inspection (isSelfInstall) even when no override is set.
  //
  // If no project is found in cwd, run the canonical project-resolution
  // pipeline (recent → picker → discovery → scaffold) instead of dying
  // on "No package.json found". This is what makes `litt` recover when
  // launched from ~ (Termux, fresh shell) — the same ActiveProject
  // contract Studio will consume.
  const startCwd = resolveProjectCwd();
  const initialDetect = detectProject(startCwd);

  if (initialDetect.isSelfInstall && initialDetect.hasPackageJson) {
    // Self-install detected but hasPackageJson is true only when the
    // start dir itself has a package.json — warn but continue through
    // the resolver so the user can pick a real project.
    console.error(`${c.dim}LiTT detected its own install dir as the project root.${c.reset}`);
    console.error(`${c.dim}Launch LiTT from inside your project, or pass --cwd <project-dir>.${c.reset}`);
  }

  let project = initialDetect;
  if (!initialDetect.hasPackageJson || initialDetect.isSelfInstall) {
    const resolved = await resolveActiveProject({ cwd: startCwd });
    if (!resolved) {
      fail("No project selected. LiTT needs a project to work with.");
      console.error(`${c.dim}  Navigate to a project directory and run 'litt' again,${c.reset}`);
      console.error(`${c.dim}  or pick one from the project picker.${c.reset}`);
      return 1;
    }
    project = resolved.project;
    // Surface which project LiTT attached to (provenance transparency).
    console.error(`${c.dim}LiTT attached to: ${activeProjectDisplay(resolved.active)}${c.reset}`);
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

  // Start terminal-server connection in the BACKGROUND — don't block
  // the UI on a network call. On devices with slow/no internet (e.g.
  // Termux on a phone), awaiting connect() here caused the cockpit to
  // appear "frozen" for up to 20+ seconds before the Ink render started.
  // The RuntimeClient handles reconnection internally; useEventBridge
  // subscribes to connection-state changes and updates the UI when the
  // connection succeeds or fails.
  let client: RuntimeClient | null = null;
  try {
    client = new RuntimeClient();
    client.connect().catch(() => {
      // Non-fatal — cockpit works without realtime connection.
      // The client remains in a disconnected state; useEventBridge
      // will show "offline" in the UI.
    });
  } catch {
    // Synchronous construction error — extremely unlikely, but guard it.
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

  // ─── Auth state for header display ──────────────────────────────
  // The auth gate in index.ts already verified the user is signed in
  // before reaching here. We fetch the auth state for the header UX
  // (email display) IN THE BACKGROUND — don't block the UI on a
  // potentially slow network call (token refresh + userinfo fetch).
  // The cockpit launches immediately with authEmail=null and updates
  // via rerender() once the email is available.
  const authEmailPromise = (async () => {
    try {
      const authSession = getAuthSession();
      const authState = await authSession.getAuthState();
      return authState.email;
    } catch {
      // Non-fatal — cockpit launches without email in header
      return null;
    }
  })();

  // Launch the Ink cockpit IMMEDIATELY — don't wait for network calls.
  // The auth email starts as null and is updated via rerender() once
  // the background fetch resolves. The client connection also runs in
  // the background (above) and useEventBridge handles the "connecting"
  // and "offline" states.
  const { waitUntilExit, rerender } = render(
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
        authEmail: null, // updated via rerender when auth resolves
        signedIn: true,
      }),
    ),
  );

  // Update the header with the auth email once it resolves — re-render
  // the same tree so React reconciles and preserves all component state.
  authEmailPromise.then((authEmail) => {
    rerender(
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
          authEmail,
          signedIn: true,
        }),
      ),
    );
  });

  try {
    await waitUntilExit();
  } finally {
    // Centralized teardown, not a happy-path unmount: this runs whether
    // waitUntilExit() resolved, threw, or the UI was cancelled mid-run.
    restoreTerminal();
    disposeTeardown();
    if (client) client.disconnect();
  }

  return 0;
}
