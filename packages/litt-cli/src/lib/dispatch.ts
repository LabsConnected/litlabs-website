/**
 * Command dispatch resolution — the single source of truth for how
 * `litt <args>` maps to a command handler.
 *
 * Routing contract:
 *   litt             → "cockpit"  (Ink operator cockpit in current terminal)
 *   litt shell       → "cockpit"  (explicit alias for the Ink cockpit)
 *   litt cockpit     → "cockpit"  (alias)
 *   litt tui         → "cockpit"  (alias)
 *   litt desktop     → "desktop"  (Desktop/Tauri GUI surface)
 *   litt <other>     → <other>    (doctor, status, diff, check, test, build, ...)
 *   litt --help/-h   → undefined  (help — never dispatches a command)
 *   litt --version/-v→ undefined  (version — never dispatches a command)
 *
 * Both `cockpit` and `desktop` share the same canonical RuntimeSession —
 * one brain, one truth. The only difference is the surface: Ink vs Tauri.
 *
 * This module is pure — it has no side effects and no heavy imports
 * (no Ink/React). It exists so dispatch routing is unit-testable
 * without spawning a real terminal or GUI.
 */

export type DispatchSurface = "ink" | "desktop" | "none";

export interface DispatchResult {
  /** The resolved command name, or undefined for help/version. */
  command: string | undefined;
  /** Remaining args after the command word (and stripped flags). */
  rest: string[];
  /** Which surface this command launches. */
  surface: DispatchSurface;
  /** True for --help / -h. */
  isHelp: boolean;
  /** True for --version / -v. */
  isVersion: boolean;
  /** Permission mode extracted from --mode <plan|act|auto>. */
  mode: "plan" | "act" | "auto";
  /** True if --remote was present. */
  useRemote: boolean;
  /** Workspace ID extracted from --workspace <id>. */
  workspaceId?: string;
  /**
   * Project cwd extracted from --cwd <path>. When set, the CLI uses this
   * as the starting directory for project detection instead of
   * process.cwd(). This is the canonical way for a launcher script
   * (e.g. the Termux `litt` wrapper) to preserve the caller's real
   * working directory when it cannot avoid chdir'ing into the LiTT
   * install dir before exec'ing node.
   *
   * Resolution priority in the CLI: --cwd flag > LITT_CWD env > process.cwd().
   */
  cwd?: string;
}

/** Commands that launch the Ink operator cockpit (current terminal). */
const INK_COMMANDS = new Set(["cockpit", "shell", "tui"]);

/** Commands that launch the Desktop/Tauri GUI surface. */
const DESKTOP_COMMANDS = new Set(["desktop"]);

/**
 * Resolve raw argv (after process.argv.slice(2)) into a dispatch decision.
 *
 * Flags handled here:
 *   --remote       (stripped — caller checks useRemote)
 *   --mode <m>     (stripped — caller reads mode)
 *   --workspace <id> (stripped — caller reads workspaceId)
 *   --cwd <path>   (stripped — caller reads cwd; preserves caller dir when a launcher chdirs)
 *   --tui          (stripped — redundant, bare `litt` already launches cockpit)
 *   --help / -h    (returns isHelp=true, command=undefined)
 *   --version / -v (returns isVersion=true, command=undefined)
 */
export function resolveDispatch(rawArgs: string[]): DispatchResult {
  // Extract --remote flag (can appear anywhere)
  const remoteIdx = rawArgs.indexOf("--remote");
  const useRemote = remoteIdx !== -1;
  const argsWithoutRemote = remoteIdx !== -1
    ? [...rawArgs.slice(0, remoteIdx), ...rawArgs.slice(remoteIdx + 1)]
    : rawArgs;

  // Extract --mode flag
  const modeIdx = argsWithoutRemote.indexOf("--mode");
  let mode: "plan" | "act" | "auto" = "act";
  let argsWithoutMode = argsWithoutRemote;
  if (modeIdx !== -1 && modeIdx + 1 < argsWithoutRemote.length) {
    const modeVal = argsWithoutRemote[modeIdx + 1];
    if (modeVal === "plan" || modeVal === "act" || modeVal === "auto") {
      mode = modeVal;
    }
    argsWithoutMode = [
      ...argsWithoutRemote.slice(0, modeIdx),
      ...argsWithoutRemote.slice(modeIdx + 2),
    ];
  }

  // --tui is redundant: bare `litt` already launches the cockpit.
  // Strip it so existing scripts/aliases keep working without changing routing.
  const tuiIdx = argsWithoutMode.indexOf("--tui");
  const argsWithoutTui = tuiIdx !== -1
    ? [...argsWithoutMode.slice(0, tuiIdx), ...argsWithoutMode.slice(tuiIdx + 1)]
    : argsWithoutMode;

  // Extract --workspace flag (for --remote workspace selection)
  const workspaceIdx = argsWithoutTui.indexOf("--workspace");
  let workspaceId: string | undefined;
  let argsWithoutWorkspace = argsWithoutTui;
  if (workspaceIdx !== -1 && workspaceIdx + 1 < argsWithoutTui.length) {
    workspaceId = argsWithoutTui[workspaceIdx + 1];
    argsWithoutWorkspace = [
      ...argsWithoutTui.slice(0, workspaceIdx),
      ...argsWithoutTui.slice(workspaceIdx + 2),
    ];
  }

  // Extract --cwd flag (project working directory override).
  // A launcher that must chdir into the LiTT install dir before exec'ing
  // node passes --cwd "$PWD" so the CLI inspects the caller's real repo
  // instead of its own runtime directory.
  // If --cwd appears multiple times (launcher injected one + user passed
  // one), the LAST occurrence wins — user intent overrides launcher default.
  let cwd: string | undefined;
  let cleanArgs = argsWithoutWorkspace;
  // Loop to handle multiple --cwd flags (last wins)
  for (;;) {
    const cwdIdx = cleanArgs.indexOf("--cwd");
    if (cwdIdx === -1 || cwdIdx + 1 >= cleanArgs.length) break;
    cwd = cleanArgs[cwdIdx + 1];
    cleanArgs = [
      ...cleanArgs.slice(0, cwdIdx),
      ...cleanArgs.slice(cwdIdx + 2),
    ];
  }

  const requestedCommand = cleanArgs[0];

  const isHelp = requestedCommand === "--help" || requestedCommand === "-h";
  const isVersion = requestedCommand === "--version" || requestedCommand === "-v";

  if (isHelp || isVersion) {
    return {
      command: undefined,
      rest: [],
      surface: "none",
      isHelp,
      isVersion,
      mode,
      useRemote,
      workspaceId,
      cwd,
    };
  }

  // Bare `litt` → cockpit (Ink). `litt shell`/`cockpit`/`tui` → same Ink cockpit.
  // `litt desktop` → Desktop/Tauri GUI. Both share one RuntimeSession.
  const command = requestedCommand ?? "cockpit";
  const rest = requestedCommand ? cleanArgs.slice(1) : [];

  let surface: DispatchSurface = "none";
  if (INK_COMMANDS.has(command)) {
    surface = "ink";
  } else if (DESKTOP_COMMANDS.has(command)) {
    surface = "desktop";
  }

  return {
    command,
    rest,
    surface,
    isHelp: false,
    isVersion: false,
    mode,
    useRemote,
    workspaceId,
    cwd,
  };
}
