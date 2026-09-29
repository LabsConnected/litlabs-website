/**
 * Terminal Command Policy — safe/risky/deny classification for `terminal.execute`.
 *
 * This module is the product/UX policy layer over the real terminal execution
 * path (tool-handlers-v2.ts `handleTerminalExecute` → `transport.exec`). It is
 * NOT the security layer: the terminal server's `isBlockedCommand()` plus
 * workspace isolation remain authoritative. This module only answers "auto-run,
 * ask, or never" so the agent loop and permission engine can make the right
 * per-command decision.
 *
 * ─── Precedence (highest first) ──────────────────────────────────────
 *   1. Owner deny patterns  (`setTerminalCommandPolicy({ deny })` /
 *      `LITT_TERMINAL_DENY`) — the owner can always block something.
 *   2. Owner allow patterns  (`setTerminalCommandPolicy({ allow })` /
 *      `LITT_TERMINAL_ALLOW`) — the owner can always green-light something.
 *   3. Built-in deny (destructive primitives: see BUILTIN_DENY_PATTERNS).
 *   4. Built-in safe  (read-only: see SAFE_BINARIES / SAFE_GIT_SUBCOMMANDS).
 *   5. Default: risky (everything else requires approval).
 *
 *   Owner patterns beat built-ins in BOTH directions: owner-deny blocks a
 *   built-in-safe command, and owner-allow permits a built-in-deny one. This
 *   is deliberate — it is the owner's machine — and it is documented here so
 *   nobody is surprised.
 *
 * Owner patterns are substring matches against the normalized command
 * (lowercased, `sudo` prefixes stripped). Env seeds (`LITT_TERMINAL_ALLOW`,
 * `LITT_TERMINAL_DENY`) are comma-separated substring patterns, e.g.
 * `LITT_TERMINAL_ALLOW="git checkout,git stash"`.
 *
 * Compound commands (`a && b`, `a || b`, `a; b`, `a | b`, newlines) are split
 * on shell operators with crude quote-awareness (single/double quotes and
 * backslash escapes). Each segment is classified independently and the whole
 * command takes the MAXIMUM severity: deny > risky > safe. So
 * `git status && rm -rf /` is deny.
 *
 * `sudo` prefixes are stripped before classification — `sudo git status`
 * is safe (subject to the permission engine's sudo handling elsewhere), while
 * `sudo rm -rf /` is still deny. Common sudo flag runs (`sudo -n`, `sudo -E`)
 * are stripped too; anything more exotic than `sudo [flags] <command>` is
 * treated as risky.
 *
 * Never log full command strings with potential secrets — refusal reasons
 * stay generic (the classification category, not the command).
 */

export type TerminalCommandRisk = "safe" | "risky" | "deny";

/** Owner-configurable substring overrides. */
export interface TerminalCommandPolicyOverrides {
  /** Substring patterns that force "safe" (unless owner-deny matches). */
  allow?: string[];
  /** Substring patterns that force "deny" (beats everything). */
  deny?: string[];
}

// ─── Built-in safe: read-only binaries ───────────────────────────────

const SAFE_BINARIES: ReadonlySet<string> = new Set([
  "ls", "dir", "pwd", "whoami", "echo", "cat", "head", "tail", "less", "more",
  "wc", "grep", "find", "tree", "file", "stat", "du", "df", "uname", "date",
  "env", "printenv", "which", "whereis", "type", "test", "true", "false",
  // Read-only dev tools (mirrors the terminal.execute tool description)
  "tsc", "eslint", "vitest", "jest", "prettier", "diff", "comm", "uniq",
  "sort", "cut", "awk", "sed", "xargs",
]);

/** `git <subcommand>` is safe only for these read-only subcommands. */
const SAFE_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "status", "diff", "log", "show", "branch", "remote", "stash",
]);

/** Binaries treated as version-probe-safe when the ONLY arg is a version flag. */
const VERSION_PROBE_BINARIES: ReadonlySet<string> = new Set([
  "node", "npm", "npx", "pnpm", "yarn", "bun", "git", "tsc", "eslint",
  "vitest", "python", "python3", "pip", "java", "go", "ruby", "cargo",
  "rustc", "docker", "terraform", "psql",
]);

// ─── Built-in deny: never executes, even with approval ───────────────

const BUILTIN_DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /\brm\s+(-[a-z]*r[a-z]*\s+)+(-\/|--root|--preserve-root)(?=[\s'";&|]|$)/, // rm -rf / , rm -rf --root
  /\brm\s+(-[a-z]*r[a-z]*\s+)+(\/\*|\/(?=[\s'";&|]|$))/,               // rm -rf /* , rm -rf / (trailing)
  /\brm\s+(-[a-z]*r[a-z]*\s+)+(~|\$home|\$\{home\})(\s|$)/,             // rm -rf ~ / $HOME (input is lowercased before matching)
  /\bmkfs\b/,                                                        // filesystem creation
  /\bdd\b.*\bof=/,                                                  // dd of= (block writes)
  /:\(\)\{\s*:\|:&\s*\};:/,                                         // fork bomb
  /\b(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)\b/,            // host control
  />\s*\/dev\/sd[a-z]+\b/,                                           // writes to /dev/sd*
  /\bdd\b.*\/dev\/sd[a-z]+\b/,                                       // dd to /dev/sd*
  /\bchmod\s+(-r\s+)?777\s+\//,                                       // chmod -R 777 / (input is lowercased before matching)
  /\bchown\s+(-r\s+)?[^ ]+\s+\//,                                    // chown -R ... /
];

// ─── Owner overrides (module state; env-seeded lazily) ─────────────

let ownerOverrides: TerminalCommandPolicyOverrides | null = null;

function parseEnvPatterns(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
}

function loadOwnerOverrides(): TerminalCommandPolicyOverrides {
  if (!ownerOverrides) {
    ownerOverrides = {
      allow: parseEnvPatterns("LITT_TERMINAL_ALLOW"),
      deny: parseEnvPatterns("LITT_TERMINAL_DENY"),
    };
  }
  return ownerOverrides;
}

/** Set owner overrides programmatically (e.g. from settings). */
export function setTerminalCommandPolicy(o: TerminalCommandPolicyOverrides): void {
  ownerOverrides = {
    allow: (o.allow ?? []).map((p) => p.toLowerCase()),
    deny: (o.deny ?? []).map((p) => p.toLowerCase()),
  };
}

/** Clear programmatic overrides and re-seed from env on next use. */
export function resetTerminalCommandPolicy(): void {
  ownerOverrides = null;
}

// ─── Command parsing ─────────────────────────────────────────────────

/**
 * Split a command line on shell operators (&&, ||, ;, |, newlines) without
 * splitting inside single quotes, double quotes, or after a backslash.
 * Crude but honest — this is a policy pre-filter, not a shell parser.
 */
export function splitCompoundCommands(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: string | null = null;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && i + 1 < command.length) {
        current += command[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 2;
      continue;
    }
    if (ch === "&" && command[i + 1] === "&") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === "|" && command[i + 1] === "|") {
      segments.push(current);
      current = "";
      i += 2;
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "\n") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (ch === "&") {
      // Background operator — still a segment boundary.
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  segments.push(current);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Strip `sudo` (plus any short flags like `-n`/`-E`) and return the inner
 * command. Returns null when the sudo invocation is too exotic to parse
 * honestly (caller treats that as risky).
 */
function stripSudo(segment: string): string | null {
  const trimmed = segment.trim();
  if (!/^(sudo|doas)\b/.test(trimmed)) return segment;
  const tokens = trimmed.split(/\s+/);
  let i = 1;
  while (i < tokens.length && /^-/.test(tokens[i])) i += 1;
  if (i >= tokens.length) return null;
  return tokens.slice(i).join(" ");
}

/** Tokenize a segment the crude way: split on whitespace outside quotes. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    if (quote) {
      if (ch === "\\" && i + 1 < segment.length) {
        i += 2;
        continue;
      }
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      i += 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function isVersionProbe(binary: string, args: string[]): boolean {
  if (!VERSION_PROBE_BINARIES.has(binary)) return false;
  return args.length === 1 && /^(--?v(ersion)?)$/.test(args[0]);
}

function classifyBuiltin(segment: string): TerminalCommandRisk {
  const withoutSudo = stripSudo(segment);
  if (withoutSudo === null) return "risky";
  const lower = withoutSudo.toLowerCase().trim();
  if (!lower) return "risky";

  const tokens = tokenize(lower);
  if (tokens.length === 0) return "risky";
  const binary = tokens[0];
  const args = tokens.slice(1);

  // Version probes (-v/--version) are read-only for known binaries.
  if (isVersionProbe(binary, args)) return "safe";

  // git: only read-only subcommands are safe.
  if (binary === "git") {
    const sub = args[0] ?? "";
    return SAFE_GIT_SUBCOMMANDS.has(sub) ? "safe" : "risky";
  }

  // npm: only the read-only lifecycle probes from the tool description.
  if (binary === "npm") {
    const sub = args[0] ?? "";
    return sub === "test" || sub === "t" || sub === "lint" ? "safe" : "risky";
  }

  // npx tsc / npx eslint / npx vitest are read-only per the tool description;
  // other npx runs arbitrary packages → risky.
  if (binary === "npx") {
    const pkg = args[0] ?? "";
    if (pkg === "tsc" || pkg === "eslint" || pkg === "vitest" || pkg === "jest") {
      return "safe";
    }
    return "risky";
  }

  if (SAFE_BINARIES.has(binary)) return "safe";
  if (isVersionProbe(binary, args)) return "safe";

  return "risky";
}

/**
 * Classify a (possibly compound) shell command.
 *
 * Owner overrides are substring matches on the normalized (sudo-stripped,
 * lowercased) command. Precedence: owner-deny > owner-allow > built-in.
 * Compound commands take the max severity across segments.
 */
export function classifyTerminalCommand(command: string): TerminalCommandRisk {
  const raw = typeof command === "string" ? command : "";
  if (!raw.trim()) return "risky";

  // Built-in deny is matched against the FULL command before splitting:
  // destructive primitives (fork bombs, `rm -rf /`) embed the very shell
  // operators we split on, and a partial segment match would miss them.
  // This is intentionally conservative (fail-closed): even a quoted mention
  // of a destructive primitive is denied. The terminal server's own
  // isBlockedCommand() remains the authoritative layer.
  const normalizedFull = (stripSudo(raw) ?? raw).toLowerCase().trim();
  for (const pattern of BUILTIN_DENY_PATTERNS) {
    if (pattern.test(normalizedFull)) return "deny";
  }

  const overrides = loadOwnerOverrides();
  const segments = splitCompoundCommands(raw);

  let maxRisk: TerminalCommandRisk = "safe";
  for (const segment of segments) {
    const normalized = (stripSudo(segment) ?? segment).toLowerCase().trim();

    // Owner overrides (substring patterns).
    if ((overrides.deny ?? []).some((p) => normalized.includes(p))) {
      return "deny"; // owner-deny beats everything, including owner-allow.
    }
    let risk: TerminalCommandRisk;
    if ((overrides.allow ?? []).some((p) => normalized.includes(p))) {
      risk = "safe";
    } else {
      risk = classifyBuiltin(segment);
    }

    if (risk === "risky") maxRisk = "risky";
  }
  return maxRisk;
}
