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
 *      a trusted local environment: see isTrustedLocalEnvironment (explicit
 *      opt-in + loopback bind; NODE_ENV alone is never enough).
 *   2. In production — or on any Railway-hosted service — a host shell is
 *      NEVER permitted. There is deliberately no override variable.
 *   3. In production-like environments, terminal execution fails closed
 *      UNCONDITIONALLY. Docker mode does NOT enable execution: Docker
 *      availability is a configuration claim, not proof of isolation, and
 *      no environment variable can override this. Verified sandbox
 *      isolation does not exist yet; when it does, this policy will be
 *      updated to check for it explicitly — not via an env var.
 *   4. In local development, Docker mode is permitted when the Docker
 *      daemon, image and network are present.
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

/** Other hosting platforms the web app / shared tooling may run on. */
const OTHER_HOSTED_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL"] as const;

/** Explicit, per-process opt-in required for ANY execution on this host. */
export const LOCAL_HOST_EXEC_OPT_IN = "LITT_ALLOW_LOCAL_HOST_EXEC";

/**
 * Written by the process entrypoint (never by operators) once the real
 * listening address is resolved. Host execution requires it to be loopback,
 * so a dev server reachable over LAN/tailnet/0.0.0.0 can never run commands
 * for whoever can reach it. Absent => unknown => denied.
 */
export const RESOLVED_BIND_HOST = "LITT_RESOLVED_BIND_HOST";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string | undefined): boolean {
  return host !== undefined && LOOPBACK_HOSTS.has(host);
}

/**
 * DEFAULT-DENY. Execution on this host is a trusted-local-developer feature
 * and is permitted only when ALL of these positively hold:
 *   1. NODE_ENV is exactly "development" or "test"
 *   2. no Railway/Vercel marker is present
 *   3. LITT_ALLOW_LOCAL_HOST_EXEC is exactly "1" (explicit opt-in)
 *   4. the server is bound to loopback (LITT_RESOLVED_BIND_HOST)
 * Missing markers, missing NODE_ENV, a missing opt-in or an unknown bind
 * address can never make untrusted execution permissible.
 */
export function isTrustedLocalEnvironment(env: Record<string, string | undefined>): boolean {
  if (env.NODE_ENV !== "development" && env.NODE_ENV !== "test") return false;
  if ([...RAILWAY_MARKERS, ...OTHER_HOSTED_MARKERS].some((key) => Boolean(env[key]))) return false;
  if (env[LOCAL_HOST_EXEC_OPT_IN] !== "1") return false;
  return isLoopbackHost(env[RESOLVED_BIND_HOST]);
}

/**
 * Complement of isTrustedLocalEnvironment: anything not provably a trusted
 * local environment is treated as production-like. (Name kept for callers.)
 */
export function isProductionLike(env: Record<string, string | undefined>): boolean {
  return !isTrustedLocalEnvironment(env);
}

const PROXY_HEADERS = [
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "forwarded", "x-real-ip", "cf-connecting-ip", "cf-ray", "true-client-ip", "via",
] as const;

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  return h.split(":")[0];
}

/**
 * True when a request cannot be shown to be a direct request to a loopback
 * listener (proxy/tunnel headers present, or Host missing / not loopback).
 * Binding to loopback does not make a request trusted: ngrok, Cloudflare
 * Tunnel, nginx or Tailscale Funnel forward untrusted traffic to 127.0.0.1.
 */
export function isUntrustedLocalRequest(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const get = (n: string) => {
    const v = headers[n];
    return Array.isArray(v) ? v[0] : v;
  };
  if (PROXY_HEADERS.some((h) => get(h) !== undefined)) return true;
  const host = get("host");
  return !host || !LOOPBACK_HOSTS.has(hostnameOf(host));
}

export function evaluateTerminalIsolation(input: TerminalIsolationInput): TerminalIsolationVerdict {
  const productionLike = isProductionLike(input.env);

  // Production-like environments fail closed UNCONDITIONALLY. Docker mode
  // does not enable execution: Docker availability is a configuration claim,
  // not proof of isolation, and no environment variable can override this.
  // Verified sandbox isolation does not exist yet.
  if (productionLike) {
    return {
      terminalExecution: "disabled",
      mode: "none",
      status: "unsafe",
      productionLike,
      reason:
        "Terminal execution is disabled: this is not a trusted local environment " +
        "(requires NODE_ENV=development|test, no hosted markers, " +
        `${LOCAL_HOST_EXEC_OPT_IN}=1 and a loopback bind) and no verified sandbox ` +
        "isolation exists. Failing closed unconditionally; no override is available.",
    };
  }

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

  return {
    terminalExecution: "enabled",
    mode: "host",
    status: "dev_host_shell",
    productionLike,
    reason: "Trusted local development host shell (explicit opt-in, loopback bind); no isolation",
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
 * terminal session is requested in a production-like environment, regardless
 * of Docker mode or any environment variable.
 *
 * Production execution fails closed UNCONDITIONALLY. Docker availability is
 * a configuration claim, not proof of isolation. There is deliberately no
 * override variable — not TERMINAL_VERIFIED_ISOLATION, not TERMINAL_USE_DOCKER,
 * not anything else. When independently verified sandbox isolation exists,
 * this function will be updated to check for it explicitly.
 */
export function assertHostShellPermitted(
  env: Record<string, string | undefined>,
  _useDocker: boolean,
): void {
  if (isProductionLike(env)) {
    throw new TerminalIsolationError(
      "Terminal unavailable: execution is disabled in production; " +
        "no verified sandbox isolation exists. Failing closed unconditionally.",
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
