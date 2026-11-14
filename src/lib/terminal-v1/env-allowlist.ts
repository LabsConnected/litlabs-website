/**
 * Explicit environment variable allowlist for sandboxes.
 *
 * Only these variables are passed into a sandbox. Never use
 * `...process.env` when spawning user processes.
 *
 * Platform secrets (database credentials, Clerk keys, AI provider
 * keys, Stripe secrets, internal service keys) are NEVER included.
 */

export const SANDBOX_ENV_ALLOWLIST = [
  "HOME",
  "PATH",
  "TERM",
  "LANG",
  "SHELL",
  "LITTREE_USER_ID",
  "LITTREE_PROJECT_ID",
  "LITTREE_WORKSPACE_ID",
  "LITTREE_SANDBOX_ID",
] as const;

export type SandboxEnvVar = (typeof SANDBOX_ENV_ALLOWLIST)[number];

/**
 * Build a safe environment object for a sandbox.
 *
 * Only allowlisted variables are included. Caller provides
 * the values for LITTREE_* variables.
 */
export function buildSandboxEnv(input: {
  userId: string;
  projectId: string;
  workspaceId: string;
  sandboxId: string;
  home?: string;
  path?: string;
  shell?: string;
  term?: string;
  lang?: string;
}): Record<string, string> {
  const env: Record<string, string> = {};

  // LITTREE identity variables (always set)
  env.LITTREE_USER_ID = input.userId;
  env.LITTREE_PROJECT_ID = input.projectId;
  env.LITTREE_WORKSPACE_ID = input.workspaceId;
  env.LITTREE_SANDBOX_ID = input.sandboxId;

  // Standard variables with safe defaults
  env.HOME = input.home ?? "/workspace";
  env.PATH = input.path ?? "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";
  env.TERM = input.term ?? "xterm-256color";
  env.LANG = input.lang ?? "en_US.UTF-8";
  env.SHELL = input.shell ?? "/bin/bash";

  return env;
}

/**
 * Platform secrets that must never appear in a sandbox environment.
 * The terminal service carries a mirror of this list (plus
 * E2B_API_KEY, the sandbox provider's own key — a terminal-side
 * concern); the two lists MUST stay in sync on the shared names.
 */
export const PLATFORM_SECRET_ENV_VARS = [
  "CLERK_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "AUTH_SECRET",
  "TERMINAL_AUTH_SECRET",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
] as const;

export class SandboxEnvSecretError extends Error {
  readonly code = "SANDBOX_PLATFORM_SECRET" as const;
  constructor(key: string) {
    super(`Forbidden secret "${key}" must not be passed to sandbox environment`);
    this.name = "SandboxEnvSecretError";
  }
}

/**
 * Verify that an environment object does not contain any
 * forbidden platform secrets. This is a defense-in-depth check.
 */
export function assertNoPlatformSecrets(env: Record<string, string>): void {
  for (const key of PLATFORM_SECRET_ENV_VARS) {
    if (key in env && env[key]) {
      throw new Error(`Forbidden secret "${key}" must not be passed to sandbox environment`);
    }
  }
}

const IDENTITY_ENV_VARS: ReadonlySet<string> = new Set([
  "LITTREE_USER_ID",
  "LITTREE_PROJECT_ID",
  "LITTREE_WORKSPACE_ID",
  "LITTREE_SANDBOX_ID",
]);

// ─── Value-based check for per-command project env ──────────────────
//
// Mirror of terminal-server/sandbox/env.ts (Phase 2). The name-based
// check above is the right guard for a sandbox's BASE environment
// (create time): the platform composes that env itself, so a
// platform-secret NAME appearing in it is always a bug or an attack.
// It is the WRONG guard for per-command PROJECT env: a project's own
// Clerk keys are legitimately named CLERK_SECRET_KEY /
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, and a preview or build
// legitimately needs them. What must never cross is the platform's
// OWN secret VALUES. So the per-command channel is guarded by value:
// any project-env value equal to one of the platform's own
// platform-secret values is refused, whatever name it travels under.

/**
 * Values shorter than this are never treated as platform secrets for
 * the value check: short strings ("true", "0", a region name) collide
 * by accident, and a real credential is never this short. The name
 * check on the base env has no such exemption.
 */
export const MIN_PLATFORM_SECRET_VALUE_LENGTH = 8;

/**
 * Names whose VALUES the value check collects. The shared
 * PLATFORM_SECRET_ENV_VARS list (which already carries
 * TERMINAL_AUTH_SECRET, the preview-token signing root) plus
 * E2B_API_KEY for parity with the terminal side: the credential that
 * creates sandboxes must never appear inside one under any name.
 */
const VALUE_CHECK_SECRET_ENV_VARS: readonly string[] = [
  ...PLATFORM_SECRET_ENV_VARS,
  "E2B_API_KEY",
];

/**
 * Collect the platform's OWN platform-secret values from an env
 * source (normally process.env): the values a per-command project
 * env must never reproduce.
 */
export function collectPlatformSecretValues(
  env: Record<string, string | undefined>,
): ReadonlySet<string> {
  const values = new Set<string>();
  for (const key of VALUE_CHECK_SECRET_ENV_VARS) {
    const value = env[key];
    if (value && value.length >= MIN_PLATFORM_SECRET_VALUE_LENGTH) {
      values.add(value);
    }
  }
  return values;
}

/**
 * Throw SandboxEnvSecretError if any value in `env` equals one of the
 * platform's own platform-secret values. The error names the
 * project-env KEY that carried the colliding value — never the value
 * itself, and never which platform secret it matched.
 */
export function assertNoPlatformSecretValues(
  env: Record<string, string>,
  platformSecretValues: ReadonlySet<string>,
): void {
  if (platformSecretValues.size === 0) return;
  for (const [key, value] of Object.entries(env)) {
    if (value && platformSecretValues.has(value)) {
      throw new SandboxEnvSecretError(key);
    }
  }
}

/**
 * Prepare caller-supplied PER-COMMAND project env for one execution:
 * identity variables are dropped (identity is composed by the
 * provider and always wins), and every remaining value is checked
 * against the platform's own platform-secret values. A project's own
 * secrets — including its own CLERK_SECRET_KEY — pass as long as
 * their VALUES are the project's, not the platform's.
 */
export function guardPerCommandProjectEnv(
  projectEnv: Record<string, string>,
  platformSecretValues: ReadonlySet<string>,
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(projectEnv)) {
    if (IDENTITY_ENV_VARS.has(key)) continue; // identity always wins
    cleaned[key] = value;
  }
  assertNoPlatformSecretValues(cleaned, platformSecretValues);
  return cleaned;
}
