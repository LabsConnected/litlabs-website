/**
 * Sandbox environment allowlist — terminal-side mirror.
 *
 * This is the terminal service's copy of the web side's
 * `src/lib/terminal-v1/env-allowlist.ts` (buildSandboxEnv +
 * assertNoPlatformSecrets). It exists as a separate copy because the
 * terminal service is its own deployable and does not import from
 * `src/` (SANDBOX-PLAN.md §1.5, seam S7). The two MUST stay in sync:
 * the allowlist and the forbidden-secret list are security controls,
 * not conveniences.
 *
 * Rules (plan §4, security invariant 4):
 *   - A sandbox's environment is built ONLY here: identity variables
 *     from the allowlist, plus caller-supplied PROJECT-scoped variables
 *     (a project's own user-entered secrets, the scoped short-lived
 *     GitHub installation token) that pass assertNoPlatformSecrets.
 *   - Platform secrets (Clerk, Supabase, Stripe, AI-provider keys,
 *     internal service keys — and the sandbox provider's own API key)
 *     NEVER enter a sandbox. assertNoPlatformSecrets throws if one is
 *     present; providers call it before any sandbox is created.
 *   - Identity variables always win: a caller can never override
 *     LITTREE_USER_ID / LITTREE_PROJECT_ID / LITTREE_WORKSPACE_ID /
 *     LITTREE_SANDBOX_ID through the project-env channel.
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
 * Build the identity/standard half of a sandbox environment.
 * Mirrors buildSandboxEnv in src/lib/terminal-v1/env-allowlist.ts.
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

  env.LITTREE_USER_ID = input.userId;
  env.LITTREE_PROJECT_ID = input.projectId;
  env.LITTREE_WORKSPACE_ID = input.workspaceId;
  env.LITTREE_SANDBOX_ID = input.sandboxId;

  env.HOME = input.home ?? "/workspace";
  env.PATH =
    input.path ?? "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";
  env.TERM = input.term ?? "xterm-256color";
  env.LANG = input.lang ?? "en_US.UTF-8";
  env.SHELL = input.shell ?? "/bin/bash";

  return env;
}

/**
 * Platform secrets that must never appear in a sandbox environment.
 * Mirrors the web-side list, plus the sandbox provider's own key
 * (E2B_API_KEY): the credential that creates sandboxes has no business
 * inside one.
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
  "E2B_API_KEY",
] as const;

export class SandboxEnvSecretError extends Error {
  readonly code = "SANDBOX_PLATFORM_SECRET" as const;
  constructor(key: string) {
    super(`Forbidden secret "${key}" must not be passed to sandbox environment`);
    this.name = "SandboxEnvSecretError";
  }
}

/**
 * Defense-in-depth check: throw if an environment object carries any
 * platform secret with a non-empty value. Providers run this over the
 * FINAL environment before a sandbox is created or a command runs.
 */
export function assertNoPlatformSecrets(env: Record<string, string>): void {
  for (const key of PLATFORM_SECRET_ENV_VARS) {
    if (key in env && env[key]) {
      throw new SandboxEnvSecretError(key);
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
// The name-based check above is the right guard for a sandbox's BASE
// environment (create time): the terminal composes that env itself,
// so a platform-secret NAME appearing in it is always a bug or an
// attack. It is the WRONG guard for per-command PROJECT env (design
// note §3.4): a project's own Clerk keys are legitimately named
// CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, and a preview
// or build legitimately needs them. What must never cross is the
// terminal's OWN secret VALUES — the platform's credentials. So the
// per-command channel is guarded by value: any project-env value
// equal to one of the terminal's own platform-secret values is
// refused, whatever name it travels under.

/**
 * Values shorter than this are never treated as platform secrets for
 * the value check: short strings ("true", "0", a region name) collide
 * by accident, and a real credential is never this short. The name
 * check on the base env has no such exemption.
 */
export const MIN_PLATFORM_SECRET_VALUE_LENGTH = 8;

/**
 * Collect the terminal's OWN platform-secret values from an env
 * source (normally process.env): the values a per-command project
 * env must never reproduce. Names come from PLATFORM_SECRET_ENV_VARS
 * plus TERMINAL_AUTH_SECRET (the preview-token signing root, which
 * the web-side list carries and this list reaches via compose paths).
 */
export function collectPlatformSecretValues(
  env: Record<string, string | undefined>,
): ReadonlySet<string> {
  const values = new Set<string>();
  for (const key of [...PLATFORM_SECRET_ENV_VARS, "TERMINAL_AUTH_SECRET"]) {
    const value = env[key];
    if (value && value.length >= MIN_PLATFORM_SECRET_VALUE_LENGTH) {
      values.add(value);
    }
  }
  return values;
}

/**
 * Throw SandboxEnvSecretError if any value in `env` equals one of the
 * terminal's own platform-secret values. The error names the
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
 * against the terminal's own platform-secret values. A project's own
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

/**
 * Compose a sandbox's full environment: caller-supplied project-scoped
 * variables UNDER the identity environment (identity always wins), then
 * verified with assertNoPlatformSecrets. Throws SandboxEnvSecretError
 * if the caller tried to smuggle a platform secret in.
 */
export function composeSandboxEnv(input: {
  userId: string;
  projectId: string;
  workspaceId: string;
  sandboxId: string;
  projectEnv?: Record<string, string>;
}): Record<string, string> {
  const projectEnv = input.projectEnv ?? {};
  assertNoPlatformSecrets(projectEnv);

  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(projectEnv)) {
    if (IDENTITY_ENV_VARS.has(key)) continue; // identity is set below, always wins
    merged[key] = value;
  }
  Object.assign(
    merged,
    buildSandboxEnv({
      userId: input.userId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      sandboxId: input.sandboxId,
    }),
  );
  assertNoPlatformSecrets(merged);
  return merged;
}
