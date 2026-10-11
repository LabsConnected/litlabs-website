/**
 * Redact credentials before they reach public GitHub Actions logs or artifacts.
 *
 * Logs: when GITHUB_ACTIONS=true, sensitive values are registered with
 * ::add-mask:: so later accidental prints become ***.
 * Artifacts: query secrets and bearer tokens are replaced with REDACTED.
 * This module never prints the original value.
 */

const SENSITIVE_QUERY_KEYS = new Set([
  "token",
  "ticket",
  "__clerk_ticket",
  "secret",
  "access_token",
  "refresh_token",
  "code",
  "api_key",
  "authorization",
  "password",
]);

const QUERY_IN_TEXT =
  /([?&#](?:token|ticket|__clerk_ticket|secret|access_token|refresh_token|code|api_key|authorization|password)=)[^&#\s"'<>\\]*/gi;

const BEARER = /\bBearer\s+([A-Za-z0-9._~+/-]{8,})/g;

const KEY_SHAPED =
  /\b((?:sk|pk)_(?:live|test)_[A-Za-z0-9]+|gsk_[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9]{20,}|sk-or-v1-[A-Za-z0-9]{20,})\b/g;

/**
 * Register a value with the Actions log masker. No-op outside Actions.
 * The workflow command itself is consumed by the runner and is not printed.
 * @param {unknown} value
 */
export function maskForActions(value) {
  if (process.env.GITHUB_ACTIONS !== "true") return;
  if (typeof value !== "string" || value.length === 0) return;
  if (/[\r\n]/.test(value)) return;
  process.stdout.write(`::add-mask::${value}\n`);
}

/**
 * Mask every sensitive query value on a URL, and the URL itself when it
 * carries one, so Playwright/curl error text cannot reveal it later.
 * @param {unknown} raw
 */
export function maskUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) return;
  let sensitive = false;
  try {
    const url = new URL(raw);
    for (const key of url.searchParams.keys()) {
      if (!SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) continue;
      const value = url.searchParams.get(key);
      if (value) {
        sensitive = true;
        maskForActions(value);
      }
    }
    if (/\/tickets?\//i.test(url.pathname)) sensitive = true;
  } catch {
    sensitive = QUERY_IN_TEXT.test(raw);
    QUERY_IN_TEXT.lastIndex = 0;
  }
  if (sensitive) maskForActions(raw);
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function redactUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0) return raw;
  maskUrl(raw);
  try {
    const url = new URL(raw);
    let changed = false;
    for (const key of [...url.searchParams.keys()]) {
      if (!SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) continue;
      url.searchParams.set(key, "REDACTED");
      changed = true;
    }
    if (url.hash && QUERY_IN_TEXT.test(url.hash)) {
      QUERY_IN_TEXT.lastIndex = 0;
      url.hash = url.hash.replace(QUERY_IN_TEXT, "$1REDACTED");
      changed = true;
    }
    QUERY_IN_TEXT.lastIndex = 0;
    return changed ? url.toString() : raw;
  } catch {
    return raw.replace(QUERY_IN_TEXT, "$1REDACTED");
  }
}

/**
 * @param {string} text
 * @param {string[]} [extras] exact values (for example a Clerk user id) to mask and replace
 * @returns {string}
 */
export function redactText(text, extras = []) {
  if (typeof text !== "string" || text.length === 0) return text;
  let out = text;
  for (const extra of extras) {
    if (typeof extra !== "string" || extra.length < 8) continue;
    if (!out.includes(extra)) continue;
    maskForActions(extra);
    out = out.split(extra).join("[redacted]");
  }
  out = out.replace(/https?:\/\/[^\s"'<>\\]+/g, (url) => redactUrl(url));
  out = out.replace(QUERY_IN_TEXT, "$1REDACTED");
  out = out.replace(BEARER, (_match, token) => {
    maskForActions(token);
    return "Bearer REDACTED";
  });
  out = out.replace(KEY_SHAPED, (match) => {
    maskForActions(match);
    if (match.startsWith("pk_")) return "pk_REDACTED";
    if (match.startsWith("gsk_")) return "gsk_REDACTED";
    if (match.startsWith("sk-proj-")) return "sk-proj-REDACTED";
    if (match.startsWith("sk-or-")) return "sk-or-REDACTED";
    return "sk_REDACTED";
  });
  return out;
}

/**
 * Deep-copy JSON-like data with every string passed through redactText.
 * @param {unknown} value
 * @param {string[]} [extras]
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
export function redactValue(value, extras = [], seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value, extras);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, extras, seen));
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = redactValue(item, extras, seen);
  }
  return out;
}

const TEXT_EXTENSIONS = new Set([
  ".json",
  ".html",
  ".htm",
  ".txt",
  ".log",
  ".md",
  ".xml",
  ".csv",
]);

/**
 * Rewrite text artifacts in place. Prints only a count, never file contents.
 * @param {string} rootDir
 * @returns {Promise<{files: number, changed: number}>}
 */
export async function redactArtifactTree(rootDir) {
  const { readdir, readFile, writeFile, stat } = await import("node:fs/promises");
  const path = await import("node:path");
  let files = 0;
  let changed = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const info = await stat(full);
      if (info.size > 20 * 1024 * 1024) continue;
      files += 1;
      const original = await readFile(full, "utf8");
      const redacted = redactText(original);
      if (redacted !== original) {
        await writeFile(full, redacted);
        changed += 1;
      }
    }
  }

  await walk(rootDir);
  return { files, changed };
}
