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
 * Verify that an environment object does not contain any
 * forbidden platform secrets. This is a defense-in-depth check.
 */
export function assertNoPlatformSecrets(env: Record<string, string>): void {
  const forbidden = [
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
  ];

  for (const key of forbidden) {
    if (key in env && env[key]) {
      throw new Error(`Forbidden secret "${key}" must not be passed to sandbox environment`);
    }
  }
}
