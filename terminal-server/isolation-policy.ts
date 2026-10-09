/**
 * isolation-policy.ts — fail-closed terminal isolation policy.
 *
 * Pure module: no I/O, no process spawning. Every caller passes in the
 * environment and the Docker probe result, so the policy is trivially
 * testable and cannot be bypassed by an ambient setting.
 *
 * Rules
 * -----
 *   1. A host shell (node-pty directly on the server) is permitted ONLY in
 *      a local development environment.
 *   2. In production — or on any Railway-hosted service — a host shell is
 *      NEVER permitted. There is deliberately no override variable.
 *   3. Terminal execution is enabled only when Docker mode is both requested
 *      (TERMINAL_USE_DOCKER=true) and the Docker daemon, image and network
 *      are present. Anything else disables terminal execution.
 *
 * "docker_enforced" means the server will only start sessions inside the
 * container runtime. It is a configuration/enforcement guarantee, not proof
 * that the container image is escape-proof; that needs runtime validation.
 */

export type TerminalIsolationStatus = "docker_enforced" | "dev_host_shell" | "unsafe";

export interface TerminalIsolationInput {
  /** Normally `process.env`. Injected so tests control it exactly. */
  env: Record<string, string | undefined>;
  /** TERMINAL_USE_DOCKER === "true". */
  useDocker: boolean;
  /** Result of the Docker daemon/image/network probe. */
  dockerAvailable: boolean;
  /** Human-readable probe reason, surfaced in health output. */
  dockerReason?: string;
}

export interface TerminalIsolationVerdict {
  /** Whether new terminal sessions may be created right now. */
  terminalExecution: "enabled" | "disabled";
  /** How sessions would run when enabled. */
  mode: "docker" | "host" | "none";
  status: TerminalIsolationStatus;
  /** True when the environment is production or Railway-hosted. */
  productionLike: boolean;
  reason: string;
}

/**
 * Variables Railway injects into every deployed service. Any of them means
 * this process is not a developer's machine, whatever NODE_ENV says.
 */
const RAILWAY_MARKERS = [
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_SERVICE_ID",
  "RAILWAY_GIT_COMMIT_SHA",
] as const;

/**
 * True for production AND for anything hosted on Railway. Defaults to the
 * safe side: a mis-set or missing NODE_ENV on Railway is still production.
 */
export function isProductionLike(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV === "production") return true;
  return RAILWAY_MARKERS.some((key) => Boolean(env[key]));
}

export function evaluateTerminalIsolation(input: TerminalIsolationInput): TerminalIsolationVerdict {
  const productionLike = isProductionLike(input.env);

  if (input.useDocker) {
    if (input.dockerAvailable) {
      return {
        terminalExecution: "enabled",
        mode: "docker",
        status: "docker_enforced",
        productionLike,
        reason: "Docker mode enforced; daemon, image and network are present",
      };
    }
    return {
      terminalExecution: "disabled",
      mode: "none",
      status: "unsafe",
      productionLike,
      reason: `Docker mode requested but unavailable: ${input.dockerReason ?? "unknown"}`,
    };
  }

  if (productionLike) {
    return {
      terminalExecution: "disabled",
      mode: "none",
      status: "unsafe",
      productionLike,
      reason:
        "Host shell is not permitted in production; terminal disabled until " +
        "TERMINAL_USE_DOCKER=true with a working Docker runtime",
    };
  }

  return {
    terminalExecution: "enabled",
    mode: "host",
    status: "dev_host_shell",
    productionLike,
    reason: "Local development host shell; no isolation",
  };
}

export class TerminalIsolationError extends Error {
  readonly code = "TERMINAL_ISOLATION_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "TerminalIsolationError";
  }
}

/**
 * Last-line guard for the code that actually spawns shells. Throws when a
 * host shell is requested in a production-like environment, regardless of
 * what any caller above decided.
 */
export function assertHostShellPermitted(
  env: Record<string, string | undefined>,
  useDocker: boolean,
): void {
  if (!useDocker && isProductionLike(env)) {
    throw new TerminalIsolationError(
      "Terminal unavailable: host shell is not permitted in production",
    );
  }
}

// ─── Non-interactive host execution ────────────────────────────────
//
// The interactive terminal has a Docker backend (see pty-session-manager).
// Every OTHER execution path in terminal-server — slash-command shells, the
// canonical ShellExecutor, workspace exec, preview dev servers, dependency
// installs, git operations — runs a child process directly on the host and
// has NO sandbox backend. Docker mode therefore does NOT make them safe, so
// unlike assertHostShellPermitted() this guard ignores TERMINAL_USE_DOCKER:
// in a production-like environment these paths are closed until a verified
// sandbox executor exists. There is no override variable.

export class HostExecutionBlockedError extends TerminalIsolationError {
  readonly surface: string;
  readonly hostExecCode = "HOST_EXECUTION_DISABLED" as const;
  constructor(surface: string) {
    super(`Host execution is disabled in production (${surface}); a verified sandbox is required`);
    this.name = "HostExecutionBlockedError";
    this.surface = surface;
  }
}

/** True when child processes may run directly on this host (local dev only). */
export function isHostExecutionPermitted(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !isProductionLike(env);
}

/** Throws HostExecutionBlockedError in production-like environments. */
export function assertHostExecutionPermitted(
  surface: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!isHostExecutionPermitted(env)) throw new HostExecutionBlockedError(surface);
}

/** Methods that only stop work and never start a process stay callable. */
const SAFE_SHELL_METHODS = new Set(["cancel", "kill", "dispose", "abort", "close"]);

/**
 * Wraps a ShellExecutor-like object so every method that could start a
 * process re-checks the policy at call time. Used for the canonical
 * executor and the command-router executor without touching their types.
 */
export function guardShellExecutor<T extends object>(shell: T, surface: string): T {
  return new Proxy(shell, {
    get(target, prop) {
      const value = Reflect.get(target, prop); // target as receiver: keeps #private/getters working
      if (typeof value !== "function" || typeof prop !== "string" || SAFE_SHELL_METHODS.has(prop)) {
        return value;
      }
      return (...args: unknown[]) => {
        assertHostExecutionPermitted(`${surface}.${prop}`);
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
