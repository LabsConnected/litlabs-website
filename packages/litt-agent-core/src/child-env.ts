/**
 * Environment passed to workspace child processes.
 *
 * Host `process.env` is NOT copied wholesale. A read-only `printenv` / `env`
 * would otherwise dump infrastructure secrets that happen to be set on the
 * terminal host (TERMINAL_INTERNAL_SERVICE_KEY, service-role keys, deploy
 * tokens, and anything the denylist has not been taught yet).
 *
 * The child receives:
 *   1. An allowlist of operational variables from the host (PATH, HOME, …).
 *   2. Explicit layers the caller set on purpose (executor env, per-call env),
 *      minus a denylist of injection vectors and known infrastructure secrets.
 *
 * Explicit layers can still carry a provider key the caller intentionally
 * supplied. They cannot reintroduce a denylisted name, and they cannot see
 * host secrets that were never passed in.
 */

const BLOCKED_ENV_VARS = new Set([
  "NODE_OPTIONS", // can inject --require
  "NODE_PATH", // can override module resolution
  "LD_PRELOAD", // can inject shared libraries
  "LD_LIBRARY_PATH", // can override library resolution
  "DYLD_INSERT_LIBRARIES", // macOS injection
  "DYLD_LIBRARY_PATH",
  "PERL5OPT", // can inject Perl modules
  "PYTHONSTARTUP", // can inject Python code
  "PYTHONPATH", // can override Python module resolution
  "ELECTRON_RUN_AS_NODE", // can change Electron behavior
  "FORCE_COLOR", // not security but noisy
]);

/**
 * Infrastructure credentials that must never reach a workspace child, even
 * when a caller copies them into the explicit env. Provider API keys are not
 * in this set: a caller may pass one deliberately. They are still absent
 * from the host allowlist, so a bare `printenv` does not reveal them.
 */
const BLOCKED_INFRA_ENV_VARS = new Set([
  "TERMINAL_INTERNAL_SERVICE_KEY",
  "TERMINAL_AUTH_SECRET",
  "INTERNAL_API_KEY",
  "AGENT_API_KEY",
  "AUTH_SECRET",
  "VOICE_AUTH_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RAILWAY_API_TOKEN",
  "GITHUB_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "META_APP_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "VAPID_PRIVATE_KEY",
  "LIVEKIT_API_SECRET",
  "SUPERMEMORY_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
]);

/** Operational variables a command needs in order to run. Not secrets. */
const CHILD_ENV_ALLOWLIST = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SHELL",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_COLLATE",
  "LANGUAGE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
  "CONTINUOUS_INTEGRATION",
  "NODE_ENV",
  "PWD",
  "OLDPWD",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "GIT_EXEC_PATH",
  "PNPM_HOME",
  "NPM_CONFIG_CACHE",
  "COREPACK_HOME",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "COMMONPROGRAMFILES",
  "PROGRAMDATA",
  "APPDATA",
  "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_ARCHITEW6432",
  "OS",
  "COMPUTERNAME",
  "HOSTNAME",
  // Agent / credential-helper connection points — socket paths and tty
  // names, not secret values. Without SSH_AUTH_SOCK an approved
  // `git push` cannot reach the user's ssh-agent; GPG_TTY is needed for
  // commit signing. The socket grants signing only to a command that
  // already passed classification and approval.
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "GPG_TTY",
  "GPG_AGENT_INFO",
  "GIT_SSH_COMMAND",
  "GIT_SSH",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  // Commit identity and pager/editor settings — plain config strings.
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "EDITOR",
  "VISUAL",
  "PAGER",
  "MANPAGER",
  // Toolchain home / cache directories. Paths only — never credential
  // values. *OPTS/*_OPTIONS-style vars stay out on purpose: like
  // NODE_OPTIONS they inject flags or code into every child invocation
  // (JAVA_TOOL_OPTIONS -javaagent, MAVEN_OPTS, GOFLAGS, PYTHONHOME's
  // stdlib override). GOPROXY-style URLs can embed credentials, so URL
  // vars are excluded too.
  "JAVA_HOME",
  "JDK_HOME",
  "JRE_HOME",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "ANDROID_NDK_HOME",
  "ANDROID_AVD_HOME",
  "GRADLE_HOME",
  "GRADLE_USER_HOME",
  "M2_HOME",
  "MAVEN_HOME",
  "GOROOT",
  "GOPATH",
  "GOBIN",
  "GOCACHE",
  "GOMODCACHE",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "DOTNET_ROOT",
  "DOTNET_CLI_HOME",
  "NUGET_PACKAGES",
  "DENO_DIR",
  "DENO_INSTALL",
  "BUN_INSTALL",
  "FLUTTER_ROOT",
  "VIRTUAL_ENV",
  "PYENV_ROOT",
  "CONDA_PREFIX",
  "CONDA_DEFAULT_ENV",
  "NVM_DIR",
  "NVM_BIN",
  "FNM_DIR",
  "VOLTA_HOME",
  "ASDF_DIR",
  "ASDF_DATA_DIR",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
]);

export function isBlockedChildEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return BLOCKED_ENV_VARS.has(upper) || BLOCKED_INFRA_ENV_VARS.has(upper);
}

export function isAllowlistedChildEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (CHILD_ENV_ALLOWLIST.has(upper)) return true;
  // Locale variants (LC_TIME, LC_NUMERIC, …) are not secrets.
  if (upper.startsWith("LC_")) return true;
  return false;
}

/**
 * Build the environment actually passed to `spawn`.
 *
 * `host` contributes only allowlisted, non-blocked keys. Each later layer
 * (executor constructor env, per-call env) is explicit and may add other
 * non-blocked keys; a blocked name is deleted even if the host allowlist
 * had carried it.
 */
export function buildChildEnv(
  host: NodeJS.ProcessEnv,
  layers: Array<Record<string, string> | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(host)) {
    if (value === undefined) continue;
    if (!isAllowlistedChildEnvKey(key) || isBlockedChildEnvKey(key)) continue;
    out[key] = value;
  }
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (isBlockedChildEnvKey(key)) {
        delete out[key];
        continue;
      }
      out[key] = value;
    }
  }
  return out;
}
