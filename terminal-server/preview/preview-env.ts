/**
 * Preview child-process environment allowlist.
 *
 * Preview children (the dev server spawn AND `pnpm install`/`pnpm add`,
 * whose lifecycle scripts execute workspace-controlled code) previously
 * received `...process.env` — the terminal-server's entire Railway
 * environment. That handed untrusted generated code the platform's own
 * secrets: TERMINAL_INTERNAL_SERVICE_KEY (full internal API access),
 * PREVIEW_ACCESS_TOKEN (the shared gate for EVERY workspace preview),
 * TERMINAL_AUTH_SECRET, SUPABASE_SERVICE_ROLE_KEY, CLERK_SECRET_KEY,
 * database and billing keys. `process.env.X` inside the workspace reads
 * them trivially.
 *
 * buildPreviewEnv() inverts the default: only an explicit allowlist of
 * runtime vars and package-manager config families cross the boundary.
 *
 *   Runtime:       PATH, HOME, PORT, HOSTNAME, NODE_ENV, NODE_BIN_DIR,
 *                  NODE_OPTIONS, locale/TZ, TLS/CA, HTTP(S)_PROXY
 *   Package mgrs:  NPM_CONFIG_*, npm_config_*, COREPACK_*, PNPM_*,
 *                  YARN_* (registry/cache/workspace settings)
 *   Ops extras:    PREVIEW_ENV_ALLOWLIST="FOO,BAR" opts a benign name in
 *
 * Guards, in order:
 *   1. PREVIEW_ENV_EXACT admits curated runtime names.
 *   2. PREVIEW_ENV_NEVER hard-blocks the platform's own credentials —
 *      nothing below can re-admit them.
 *   3. SECRET_NAME drops anything secret-shaped (…_SECRET/TOKEN/
 *      PASSWORD/API_KEY/PRIVATE_KEY/SESSION_KEY/WEBHOOK/_KEY). This
 *      runs BEFORE the ops allowlist, so PREVIEW_ENV_ALLOWLIST can
 *      never smuggle a secret name through.
 *   4. PREVIEW_ENV_ALLOWLIST extras and prefix families pass.
 *
 * Clerk: the platform's own CLERK_SECRET_KEY NEVER crosses — server-side
 * secrets are never injected into untrusted workspace code. A
 * Clerk-using workspace either carries its own keys in .env* files
 * (which the dev server loads itself) or ops configures a dedicated,
 * isolated preview Clerk app via PREVIEW_CLERK_SECRET_KEY /
 * PREVIEW_CLERK_PUBLISHABLE_KEY, which this builder maps onto the
 * standard CLERK_SECRET_KEY / NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY names.
 * The PREVIEW_CLERK_* source vars are secret-shaped, so they can never
 * cross under their own names either.
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
 * Platform credentials and connection strings that must never reach a
 * workspace child — checked before the secret-name guard and the ops
 * allowlist, so PREVIEW_ENV_ALLOWLIST cannot re-admit them.
 */
const PREVIEW_ENV_NEVER = new Set([
  "PREVIEW_ACCESS_TOKEN",
  "PREVIEW_ENV_ALLOWLIST",
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "TERMINAL_AUTH_SECRET",
  // Platform server-side secrets. CLERK_SECRET_KEY is named explicitly
  // so the platform's own Clerk app can never be re-admitted — previews
  // use a dedicated PREVIEW_CLERK_* app or the workspace's own .env*.
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
]);

/**
 * Name shape that marks a var as secret-bearing. Checked before the ops
 * allowlist — PREVIEW_ENV_ALLOWLIST can admit benign names only.
 */
const SECRET_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_KEY|API_KEY|AUTH_KEY|ACCESS_KEY|SESSION_KEY|WEBHOOK|_KEY$)/i;

function isAllowedEnvName(key: string, extras: Set<string>): boolean {
  if (PREVIEW_ENV_EXACT.has(key)) return true;
  if (PREVIEW_ENV_NEVER.has(key)) return false;
  if (SECRET_NAME.test(key)) return false;
  if (extras.has(key)) return true;
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

  // Isolated preview Clerk credentials. The platform's own CLERK_SECRET_KEY
  // is never inherited; a dedicated preview Clerk app is injected under
  // the standard names so generated apps' clerkMiddleware keeps working.
  // Values are cleaned downstream (cleanEnvValue in PreviewManager).
  const previewClerkSecret = process.env.PREVIEW_CLERK_SECRET_KEY?.trim();
  const previewClerkPublishable = process.env.PREVIEW_CLERK_PUBLISHABLE_KEY?.trim();
  if (previewClerkSecret) env.CLERK_SECRET_KEY = previewClerkSecret;
  if (previewClerkPublishable) {
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = previewClerkPublishable;
  }

  return { ...env, ...overrides };
}
