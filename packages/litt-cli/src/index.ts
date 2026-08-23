#!/usr/bin/env node
/**
 * LiTT CLI — AI operating system for your terminal.
 *
 * Two user surfaces share one canonical RuntimeSession:
 *   1. Ink/PowerShell operator cockpit  — bare `litt` / `litt shell` / `litt cockpit` / `litt tui`
 *   2. Desktop/Tauri GUI application    — `litt desktop`
 *
 * Bare `litt` stays inside the current terminal and renders the Ink cockpit.
 * It never opens a GUI window. Both surfaces connect to the same shared
 * RuntimeSession / RuntimeStore / AgentLoop — one brain, one truth.
 *
 * Commands:
 *   litt            — Launch the Ink operator cockpit (default)
 *   litt shell      — Explicit alias for the Ink cockpit
 *   litt cockpit    — Alias for the Ink cockpit
 *   litt tui        — Alias for the Ink cockpit
 *   litt desktop    — Launch the Desktop/Tauri GUI application
 *   litt doctor     — Check system health (Node, Git, pnpm, network, auth)
 *   litt version    — Show CLI version
 *   litt status     — Show project + git status (via @litt/agent-core)
 *   litt diff       — Show git diff (via @litt/agent-core)
 *   litt check      — Run typecheck (via @litt/agent-core)
 *   litt test       — Run tests (via @litt/agent-core)
 *   litt build      — Run build (via @litt/agent-core)
 *   litt run        — Run arbitrary command through hardened CommandExecutor
 *   litt inspect    — Deep repo inspection (framework, scripts, deploy)
 *   litt ask        — Ask LiTT a question about your project
 *   litt explain    — Pipe errors/diffs and get actionable advice
 *
 * Options:
 *   --remote       Dispatch through terminal-server's canonical CommandRouter
 *                  (shares the same RuntimeStore as Studio Web — same runId)
 *   --mode <mode>  Permission mode: plan, act, or auto (default: act)
 *   --tui          Redundant — bare `litt` already launches the cockpit (kept for compat)
 */

import { doctorCommand } from "./commands/doctor.js";
import { versionCommand } from "./commands/version.js";
import { statusCommand } from "./commands/status.js";
import { diffCommand } from "./commands/diff.js";
import { checkCommand } from "./commands/check.js";
import { testCommand } from "./commands/test.js";
import { buildCommand } from "./commands/build.js";
import { runCommand } from "./commands/run.js";
import { inspectCommand } from "./commands/inspect.js";
import { askCommand } from "./commands/ask.js";
import { explainCommand } from "./commands/explain.js";
import { desktopCommand } from "./commands/desktop.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { dispatchRemote, isRemoteError, hasRemoteResult } from "./lib/remote.js";
import { isRemoteUnavailable } from "./lib/remote-unavailable.js";
import { executeCommand } from "./lib/command-execution.js";
import { createRuntimeSession } from "./lib/runtime-session.js";
import { detectProject, ok, fail, header, c } from "./lib/utils.js";
import { CLI_VERSION } from "./lib/version.js";
import { resolveDispatch } from "./lib/dispatch.js";
import type { RuntimeSession } from "./lib/runtime-session.js";
import { getAuthSession } from "./lib/auth/auth-session.js";

// Lazy-loaded commands that pull in heavy dependencies (Ink/React).
// These are only imported when the user actually runs them, so
// `litt doctor` / `litt run` / etc. don't need Ink installed.
type CommandHandler = (args: string[], session?: RuntimeSession) => Promise<number>;
const lazyCockpit = async (): Promise<CommandHandler> =>
  (await import("./commands/cockpit.js")).cockpitCommand;

const VERSION = CLI_VERSION;

/**
 * Commands that can be dispatched remotely through terminal-server.
 *
 * This is a deliberately curated subset of the server's command
 * registry (see terminal-server/command-registry.ts). Commands that
 * require local resources (doctor probes the local machine, run streams
 * a local PTY, ask/explain hit the LLM directly) are NOT remoteable.
 *
 * The server is the source of truth: if a command is sent remotely that
 * the server doesn't support, the server returns a typed
 * `unknown_command` error (see RemoteCommandError) and the CLI reports
 * it cleanly — never a crash, never undefined dereferencing.
 */
const REMOTEABLE_COMMANDS = new Set([
  "status",
  "diff",
  "check",
  "test",
  "build",
  "desktop",
  // Brain/system commands that the server registry supports and that
  // make sense to dispatch remotely (no local-only resources).
  "git",
  "ask",
  "do",
  "web",
  "model",
  "doctor",
  "studio",
  "local",
  "help",
]);

/** Commands that use the RuntimeSession (shared runtime truth). */
const SESSION_COMMANDS = new Set(["status", "diff", "check", "test", "build", "run", "ask"]);

const COMMANDS: Record<string, CommandHandler> = {
  doctor: doctorCommand,
  version: versionCommand,
  status: statusCommand,
  diff: diffCommand,
  check: checkCommand,
  test: testCommand,
  build: buildCommand,
  run: runCommand,
  inspect: inspectCommand,
  ask: askCommand,
  explain: explainCommand,
  desktop: desktopCommand,
  login: loginCommand,
  logout: logoutCommand,
  whoami: whoamiCommand,
  // cockpit / shell / tui are lazy-loaded below (heavy Ink/React dependency)
};

/** Commands that require lazy loading (heavy deps like Ink/React).
 *  `shell` is an explicit alias for the same Ink cockpit as bare `litt`. */
const LAZY_COMMANDS = new Set(["cockpit", "shell", "tui"]);

/**
 * Commands allowed while signed out (no valid user session).
 *
 * These commands don't require authentication:
 *   login    — the auth flow itself
 *   logout   — clearing credentials (no-op if already signed out)
 *   whoami   — shows "not signed in" when signed out
 *   doctor   — system health check (doesn't require auth)
 *   version  — version info
 *   help     — help text
 *
 * Everything else — including the interactive cockpit — requires a
 * valid user session. The auth gate enforces this before dispatching.
 */
const LOGGED_OUT_ALLOWED = new Set(["login", "logout", "whoami", "doctor", "version", "help"]);

async function main(): Promise<number> {
  // Engine check — LiTT CLI requires Node 22+
  const major = parseInt(process.version.slice(1), 10);
  if (major < 22) {
    console.error(`${c.red}LiTT CLI requires Node.js 22 or later.${c.reset}`);
    console.error(`${c.dim}You are running Node ${process.version}.${c.reset}`);
    console.error(`${c.dim}Upgrade: https://nodejs.org/${c.reset}`);
    return 1;
  }

  // ─── TEMPORARY STARTUP DIAGNOSTIC (provider-routing trace) ───────
  // Proves which code is actually executing: package path, version, and
  // git commit SHA. Gated by LITT_DIAG=1 — quiet by default in production.
  if (process.env.LITT_DIAG === "1") {
    try {
      const { execSync } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const { dirname, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const pkgRoot = resolve(here, "..");
      let sha = "unknown";
      try {
        sha = execSync("git rev-parse HEAD", { cwd: pkgRoot, encoding: "utf8" }).trim();
      } catch { /* not a git repo or git missing */ }
      let pkgVersion = "unknown";
      try {
        const pkgJson = await import(resolve(pkgRoot, "package.json"), { with: { type: "json" } });
        pkgVersion = pkgJson.default?.version ?? pkgJson.version ?? "unknown";
      } catch { /* package.json unreadable */ }
      process.stderr.write(
        `[litt-diag] executing package: ${pkgRoot}\n` +
        `[litt-diag] version: ${pkgVersion}  commit: ${sha}\n` +
        `[litt-diag] OPENAI_API_KEY set: ${!!process.env.OPENAI_API_KEY}  OPENROUTER_API_KEY set: ${!!process.env.OPENROUTER_API_KEY}\n`,
      );
    } catch { /* diagnostic must never break startup */ }
  }

  const args = process.argv.slice(2);

  // Resolve dispatch through the single shared routing module.
  // This is the canonical routing contract:
  //   litt             → cockpit (Ink, current terminal)
  //   litt shell       → cockpit (Ink, explicit alias)
  //   litt desktop     → desktop (Tauri GUI)
  // Both surfaces share one RuntimeSession — one brain, one truth.
  const dispatch = resolveDispatch(args);

  if (dispatch.isHelp) {
    printHelp();
    return 0;
  }

  if (dispatch.isVersion) {
    console.log(`litt ${VERSION}`);
    return 0;
  }

  const command = dispatch.command!;
  const rest = dispatch.rest;
  const mode = dispatch.mode;

  // ─── Auth gate ──────────────────────────────────────────────────
  // Commands that require a valid user session are blocked when signed
  // out. Only login, logout, whoami, doctor, version, and help work
  // without authentication. The interactive cockpit (bare `litt`,
  // `litt shell`, `litt cockpit`, `litt tui`) and all runtime/project
  // commands require authentication.
  //
  // LITT_CLERK_TOKEN (temporary acceptance-test mechanism) bypasses the
  // gate — it's kept only so existing automated tests don't break.
  //
  // The CLI ships safe production defaults for the Clerk issuer, OAuth
  // client_id, and terminal-server URL. Auth is ALWAYS configured for a
  // normal installed CLI — env overrides are for dev/staging/testing
  // only. The gate therefore ALWAYS engages (except for LITT_CLERK_TOKEN
  // test bypass). Absence of env overrides must NOT disable mandatory
  // authentication.
  if (
    !LOGGED_OUT_ALLOWED.has(command) &&
    !process.env.LITT_CLERK_TOKEN
  ) {
    const authSession = getAuthSession();
    const signedIn = await authSession.isSignedIn();

    if (!signedIn) {
      // Non-interactive commands: print a clear message and exit
      if (command !== "cockpit" && command !== "shell" && command !== "tui") {
        console.error(`${c.red}✗${c.reset} Authentication required.`);
        console.error(`${c.dim}  Run 'litt login' to sign in, then try again.${c.reset}`);
        return 1;
      }

      // Interactive cockpit: render the sign-in-required screen
      const authState = await authSession.getAuthState();
      const { render } = await import("ink");
      const React = await import("react");
      const { SignInRequired } = await import("./ink/sign-in-required.js");
      const { CockpitErrorBoundary } = await import("./ink/cockpit-error-boundary.js");

      // Check TTY — Ink requires raw mode on stdin
      if (!process.stdin.isTTY) {
        console.error(`${c.red}✗${c.reset} Not signed in.`);
        console.error(`${c.dim}  Run 'litt login' to sign in.${c.reset}`);
        if (authState.error) {
          console.error(`${c.dim}  ${authState.error}${c.reset}`);
        }
        return 1;
      }

      const { waitUntilExit } = render(
        React.createElement(CockpitErrorBoundary, null,
          React.createElement(SignInRequired, {
            error: authState.error,
            // The gate only runs when auth is configured, so login is always
            // an available action on this screen.
            configAvailable: true,
          }),
        ),
      );
      await waitUntilExit();
      return 0;
    }
  }

  // --remote: dispatch through terminal-server's canonical CommandRouter.
  // Routed via executeCommand() so the fail-closed guarantee lives in ONE
  // tested function rather than being re-asserted here by hand. On any
  // remote failure this returns without ever reaching the local handler
  // resolution below.
  if (dispatch.useRemote) {
    const outcome = await executeCommand(command, {
      useRemote: true,
      isRemoteable: (cmd) => REMOTEABLE_COMMANDS.has(cmd),
      remoteExecutor: () => runRemote(command, rest, mode, dispatch.workspaceId),
      // Unreachable by contract when useRemote is true. If this ever runs,
      // the fail-closed guarantee has been broken and we want a loud crash
      // rather than a silent relocation of the user's command.
      localExecutor: () => {
        throw new Error(
          "fail-closed violation: local executor reached on the --remote path",
        );
      },
      onError: (msg) => {
        console.error(`${c.red}✗${c.reset} ${msg}`);
        if (msg.includes("--remote is not supported")) {
          console.error(`${c.dim}  Supported: ${[...REMOTEABLE_COMMANDS].join(", ")}${c.reset}`);
        }
      },
    });
    return outcome.exitCode;
  }

  // Resolve handler — lazy-load heavy commands (Ink/React) on demand
  let handler: CommandHandler | undefined;
  if (LAZY_COMMANDS.has(command)) {
    handler = await lazyCockpit();
  } else {
    handler = COMMANDS[command];
  }
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'litt --help' for available commands.");
    return 1;
  }

  // Create a shared RuntimeSession for session commands.
  // Use the detected project root (walks upward from cwd) — not process.cwd()
  // directly — so the user can run commands from any subdirectory.
  let session: RuntimeSession | undefined;
  if (SESSION_COMMANDS.has(command)) {
    const project = detectProject();
    session = createRuntimeSession({ cwd: project.rootDir, mode });
    // Install Ctrl+C handler for all session commands
    session.installSigintHandler();
  }

  try {
    return await handler(rest, session);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${c.red}Error:${c.reset} ${message}`);

    // Provide helpful hints for common errors
    if (message.includes("OPENROUTER_API_KEY")) {
      console.error(`${c.dim}  Get an API key at https://openrouter.ai and set it:${c.reset}`);
      console.error(`${c.dim}  set OPENROUTER_API_KEY=sk-or-v1-...${c.reset}`);
    } else if (message.includes("Clerk token")) {
      console.error(`${c.dim}  --remote requires authentication. Run 'litt login'.${c.reset}`);
    } else if (message.includes("ENOENT") || message.includes("not found")) {
      console.error(`${c.dim}  The command was not found. Check that it's installed and in your PATH.${c.reset}`);
    }

    // Show stack trace only with --debug
    if (process.env.LITT_DEBUG === "1" && error instanceof Error && error.stack) {
      console.error(`${c.dim}\n${error.stack}${c.reset}`);
    }
    return 1;
  }
}

/**
 * Dispatch a command through terminal-server's canonical command
 * dispatcher. The same dispatcher that Studio Web uses — so CLI and
 * Studio share the same RuntimeStore, same runId, same Socket.IO
 * broadcasts.
 *
 * Protocol: sends a RemoteCommandRequest (structured argv preserved
 * end-to-end) and decodes a RemoteCommandResponse (single-level
 * `result` ToolResult — no triple-deref). Typed errors are branched
 * on `error.code` instead of string-matching.
 */
async function runRemote(
  command: string,
  args: string[],
  mode: "plan" | "act" | "auto" = "act",
  workspaceId?: string,
): Promise<number> {
  header(`${command} (remote)`);
  try {
    // Remote commands execute on terminal-server's filesystem. We do NOT
    // pass the local project root because the server authorizes cwd against
    // its own user workspace root. The server will use its configured
    // user workspace root when no cwd is supplied.
    const response = await dispatchRemote(command, args, {
      mode,
      workspaceId,
    });

    // Protocol-level error (unknown command, gateway denial, etc.)
    if (isRemoteError(response)) {
      const err = response.error;
      fail(`${err.code}: ${err.message}`);
      if (err.code === "unknown_command" && err.availableCommands?.length) {
        console.error(`${c.dim}  Available: ${err.availableCommands.join(", ")}${c.reset}`);
      }
      console.log(`${c.gray}runId: ${response.runId}${c.reset}`);
      return 1;
    }

    // Command-level failure (e.g. build exited non-zero)
    if (!response.ok || !hasRemoteResult(response)) {
      fail(response.result?.message ?? `Remote command failed (kind=${response.kind})`);
      const stderr = response.result?.data?.stderr as string | undefined;
      if (stderr) console.log(`${c.gray}${stderr}${c.reset}`);
      console.log(`${c.gray}runId: ${response.runId}${c.reset}`);
      return 1;
    }

    ok(response.result.message);
    const stdout = response.result.data?.stdout as string | undefined;
    if (stdout) console.log(`${c.gray}${stdout}${c.reset}`);

    // Show runId for cross-surface verification — this is the ACTUAL
    // runtime execution runId, not a second identity minted by the bridge.
    console.log(`${c.gray}runId: ${response.runId}${c.reset}`);
    return 0;
  } catch (error) {
    // Re-throw typed remote failures so executeCommand() classifies them
    // and reports the reason. Nothing here re-routes to local execution.
    if (isRemoteUnavailable(error)) throw error;
    fail(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function printHelp(): void {
  console.log(`
LiTT CLI v${VERSION} — AI operating system for your terminal

Usage: litt [command] [options]

  Bare 'litt' launches the Ink operator cockpit inside the current terminal.
  Use 'litt desktop' to open the Desktop/Tauri GUI surface.
  Both surfaces share one canonical RuntimeSession — same brain, same truth.

Commands:
  (default)  Launch the LiTT shell in the current terminal
  shell      Explicit alias for the LiTT shell (same as bare 'litt')
  shell --window  Open LiTT in a dedicated terminal window (Windows Terminal)
  cockpit    Alias for the LiTT shell
  tui        Alias for the LiTT shell
  desktop    Launch the LiTT Desktop (Tauri) GUI application
  login      Sign in via Clerk OAuth (browser-based PKCE flow)
  logout     Sign out and clear local credentials
  whoami     Show the current authenticated identity
  doctor     Check system health (Node, Git, pnpm, network, auth)
  version    Show CLI version
  status     Show project + git status (via @litt/agent-core)
  diff       Show git diff (via @litt/agent-core)
  check      Run typecheck (via @litt/agent-core)
  test       Run tests (via @litt/agent-core)
  build      Run build (via @litt/agent-core)
  run        Run arbitrary command through hardened CommandExecutor (streaming + cancel)
  inspect    Deep repo inspection (framework, scripts, deploy)
  ask        Ask LiTT a question about your project
  explain    Pipe errors/diffs and get actionable advice

Options:
  -h, --help     Show this help
  -v, --version  Show version
  --remote       Dispatch through terminal-server (shared RuntimeStore with Studio)
  --mode <mode>  Permission mode: plan, act, or auto (default: act)
  --workspace <id>  Workspace ID for --remote (selects which project workspace to use)
  --tui          Redundant — bare 'litt' already launches the cockpit (kept for compat)

Examples:
  litt                     (Ink cockpit in current terminal)
  litt shell               (explicit alias for the Ink cockpit)
  litt desktop             (launch Desktop GUI app)
  litt doctor
  litt status
  litt diff
  litt diff --staged
  litt check
  litt test
  litt build
  litt build --remote    (Studio sees the same run)
  litt run echo hello    (streaming + Ctrl+C cancel)
  litt run pnpm test --mode auto
  litt cockpit check     (dispatch check via cockpit)
  litt inspect
  echo "TypeError: Cannot read property 'x' of undefined" | litt explain
  litt ask "How do I fix the TypeScript error in src/app/page.tsx?"
`);
}

main().then((code) => {
  process.exit(code);
});
