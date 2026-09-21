/**
 * Preview child-process environment allowlist.
 *
 * Preview children (the dev server spawn AND `pnpm install`/`pnpm add`,
 * whose lifecycle scripts execute workspace-controlled code) previously
 * received `...process.env` — the terminal-server's entire Railway
 * environment. That handed untrusted generated code the platform's own
 * secrets: TERMINAL_INTERNAL_SERVICE_KEY (full internal API access),
 * PREVIEW_ACCESS_TOKEN (the shared gate for EVERY workspace preview),
 * TERMINAL_AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, database and billing
 * keys. `process.env.X` inside the workspace reads them trivially.
 *
 * buildPreviewEnv() inverts the default: only an explicit allowlist of
 * runtime vars, package-manager config families, and intentionally
 * approved project vars cross the boundary.
 *
 *   Runtime:       PATH, HOME, PORT, HOSTNAME, NODE_ENV, NODE_BIN_DIR,
 *                  NODE_OPTIONS, locale/TZ, TLS/CA, HTTP(S)_PROXY
 *   Package mgrs:  NPM_CONFIG_*, npm_config_*, COREPACK_*, PNPM_*,
 *                  YARN_* (registry/cache/workspace settings)
 *   Project vars:  CLERK_* — generated apps intentionally share the
 *                  platform Clerk instance so preview sign-in works;
 *                  validateClerkConfig() verifies them before spawn.
 *   Ops extras:    PREVIEW_ENV_ALLOWLIST="FOO,BAR" opts a name in.
 *
 * A name-shaped secret (…_SECRET/TOKEN/PASSWORD/API_KEY/PRIVATE_KEY…)
 * is dropped even when a prefix family or the ops allowlist would have
 * let it through; PREVIEW_ENV_NEVER hard-blocks the gateway's own
 * credentials no matter what.
 */

/** Exact names always allowed into the child environment. */
const PREVIEW_ENV_EXACT = new Set([
  // Process/runtime basics
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "CI",
  // Node/dev-server runtime
  "PORT",
  "HOSTNAME",
  "NODE_ENV",
  "NODE_BIN_DIR",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  // Locale / timezone
  "LANG",
  "LC_ALL",
  "TZ",
  // TLS roots for outbound fetches (private registries, corp CA)
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  // Outbound proxy config
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  // Intentionally approved project vars — workspace previews share the
  // platform's Clerk instance; validated by validateClerkConfig().
  "CLERK_SECRET_KEY",
  "CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
]);

/** Prefix families allowed into the child environment. */
const PREVIEW_ENV_PREFIXES = [
  "LC_", // locale family
  "NPM_CONFIG_",
  "npm_config_",
  "COREPACK_",
  "PNPM_",
  "pnpm_",
  "YARN_",
];

/**
 * Gateway credentials that must never reach a workspace child, even if a
 * prefix family or PREVIEW_ENV_ALLOWLIST names them.
 */
const PREVIEW_ENV_NEVER = new Set([
  "PREVIEW_ACCESS_TOKEN",
  "PREVIEW_ENV_ALLOWLIST",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "TERMINAL_AUTH_SECRET",
]);

/**
 * Name shape that marks a var as secret-bearing. Checked AFTER the exact
 * allowlist (which intentionally approves CLERK_SECRET_KEY) but BEFORE
 * prefix families and the ops allowlist.
 */
const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|AUTH_KEY|ACCESS_KEY|SESSION_KEY|WEBHOOK|_KEY$)/i;

function isAllowedEnvName(key: string, extras: Set<string>): boolean {
  if (PREVIEW_ENV_EXACT.has(key)) return true;
  if (PREVIEW_ENV_NEVER.has(key)) return false;
  // Explicit ops approval wins over the generic secret-name guard — the
  // guard exists to catch secrets hiding inside prefix families.
  if (extras.has(key)) return true;
  if (SECRET_NAME.test(key)) return false;
  return PREVIEW_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function configuredExtras(): Set<string> {
  const extras = new Set<string>();
  for (const name of (process.env.PREVIEW_ENV_ALLOWLIST ?? "").split(",")) {
    const key = name.trim();
    if (key) extras.add(key);
  }
  return extras;
}

/**
 * Build the environment for a preview child process (dev server spawn or
 * dependency install). `overrides` are applied last — caller-controlled
 * values like the rebuilt PATH, allocated PORT, and NODE_ENV=development.
 */
export function buildPreviewEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const extras = configuredExtras();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (isAllowedEnvName(key, extras)) env[key] = value;
  }
  return { ...env, ...overrides };
}
