/**
 * TerminalProfile — `litt terminal-profile install`: add a persistent
 * "LiTT" profile to the user's REAL Windows Terminal settings.json, so
 * LiTT shows up in WT's profile dropdown / "+" menu / can be pinned as a
 * taskbar jumplist entry, without the user ever hand-editing JSON.
 *
 * Deliberately NOT `litt shell --window` (window-launcher.ts): that
 * command spawns an ad-hoc `wt.exe -w new ...` every time it runs. If a
 * saved WT profile's commandline ALSO did that, launching the profile
 * would open a second window on top of the one WT just opened for the
 * profile itself. This profile's commandline runs `litt shell` directly
 * — the exact `currentCliCommand(["shell"])` vector window-launcher.ts
 * already exports and tests, re-launching THIS build's node.exe + entry
 * with no nested window spawn.
 *
 * Windows Terminal's settings.json is JSONC — real files routinely carry
 * `//`/`/* *\/` comments and trailing commas that `JSON.parse` rejects.
 * A naive parse+stringify round-trip would silently drop every comment
 * and reflow the whole file. So the actual WRITE here is textual: the
 * new profile object is spliced in just before the existing profile
 * list's closing `]`, leaving every other byte of the file untouched.
 * Reads (duplicate detection) use a comment-stripped parse — that parsed
 * value is only ever inspected, never written back.
 *
 * Safety:
 *   - Always writes a timestamped backup of the ORIGINAL bytes before any
 *     write: `settings.json.litt-backup-<ISO date>`.
 *   - Idempotent: a profile with LITT_PROFILE_GUID already present is left
 *     untouched (reported as already-installed, not duplicated).
 *   - Never invents a settings.json. If none of the known locations
 *     exist, this reports exactly that and makes NO filesystem changes —
 *     the user's first real WT launch (which creates the file) wins.
 *   - Only ADDS one entry to the profile list; never rewrites, reorders,
 *     or removes any existing profile or other top-level setting.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { win32 } from "node:path";
import type { LaunchCommand } from "./window-launcher.js";

/** Fixed GUID for the LiTT profile — stable across installs so a
 *  re-run of `install` recognizes its own entry instead of duplicating it. */
export const LITT_PROFILE_GUID = "{8f2b6e2a-6c2d-4f1e-9a3b-6c1f6b2e7a10}";
export const LITT_PROFILE_NAME = "LiTT";

export interface TerminalProfileEnv {
  localAppData?: string;
  existsImpl?: (p: string) => boolean;
  readFileImpl?: (p: string) => string;
  writeFileImpl?: (p: string, content: string) => void;
  /** Clock for the backup filename suffix — injectable for exact-name tests. */
  nowImpl?: () => Date;
}

// ─── settings.json location ─────────────────────────────────────────

/**
 * Known Windows Terminal settings.json locations, most-common first:
 * Store (stable), Store (preview), unpackaged/portable install.
 */
export function candidateSettingsPaths(env: TerminalProfileEnv = {}): string[] {
  const localAppData = env.localAppData ?? process.env.LOCALAPPDATA ?? undefined;
  if (!localAppData) return [];
  return [
    win32.join(localAppData, "Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState", "settings.json"),
    win32.join(localAppData, "Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState", "settings.json"),
    win32.join(localAppData, "Microsoft", "Windows Terminal", "settings.json"),
  ];
}

/** Resolve the first EXISTING settings.json, or null if WT has never
 *  been launched (no file to safely edit). Never fabricates one. */
export function resolveSettingsPath(env: TerminalProfileEnv = {}): string | null {
  const exists = env.existsImpl ?? existsSync;
  for (const p of candidateSettingsPaths(env)) {
    if (exists(p)) return p;
  }
  return null;
}

// ─── JSONC-aware scanning (comment/string safe) ─────────────────────

type ScanState = "normal" | "string" | "lineComment" | "blockComment";

/**
 * Strip `//` and `/* *\/` comments from JSONC text for PARSING only —
 * never written back to disk. String contents (which may themselves
 * contain `//` or `/*`, e.g. a URL) are passed through untouched.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let state: ScanState = "normal";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (state === "normal") {
      if (c === '"') { state = "string"; out += c; continue; }
      if (c === "/" && next === "/") { state = "lineComment"; i++; continue; }
      if (c === "/" && next === "*") { state = "blockComment"; i++; continue; }
      out += c;
    } else if (state === "string") {
      out += c;
      if (c === "\\") { out += next ?? ""; i++; continue; }
      if (c === '"') state = "normal";
    } else if (state === "lineComment") {
      if (c === "\n") { state = "normal"; out += c; }
    } else if (state === "blockComment") {
      if (c === "*" && next === "/") { state = "normal"; i++; }
    }
  }
  // Trailing commas before `}` or `]` — WT's relaxed parser accepts them,
  // JSON.parse does not.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** A half-open [start, end) character range inside the ORIGINAL text. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * Locate the character range of the Windows Terminal profile LIST array
 * — `"profiles": [ ... ]` or `"profiles": { "list": [ ... ], ... }` —
 * inside the ORIGINAL (comment-bearing) text. Comment/string aware, so a
 * `[` or `]` inside a comment or string value never confuses the scan.
 * Returns the range of the array's CONTENTS (just inside the brackets)
 * so callers can splice right before the closing `]`.
 */
export function findProfileListRange(text: string): TextRange | null {
  const profilesKeyMatch = /"profiles"\s*:\s*/.exec(text);
  if (!profilesKeyMatch) return null;
  let i = profilesKeyMatch.index + profilesKeyMatch[0].length;

  // Skip to the next significant character, honoring comments.
  i = skipInsignificant(text, i);
  if (text[i] === "[") {
    return scanBracketedRange(text, i);
  }
  if (text[i] === "{") {
    // `"profiles": { "list": [...], "defaults": {...} }` — find "list"
    // WITHIN this object's own bracket range (never a nested object's).
    const objRange = scanBracketedRange(text, i);
    if (!objRange) return null;
    const objText = text.slice(objRange.start, objRange.end);
    const listKeyMatch = /"list"\s*:\s*/.exec(objText);
    if (!listKeyMatch) return null;
    let j = objRange.start + listKeyMatch.index + listKeyMatch[0].length;
    j = skipInsignificant(text, j);
    if (text[j] !== "[") return null;
    return scanBracketedRange(text, j);
  }
  return null;
}

/** Advance past whitespace and comments, landing on the next real token. */
function skipInsignificant(text: string, start: number): number {
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "/" && text[i + 1] === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    break;
  }
  return i;
}

/**
 * Given the index of an opening `[` or `{`, scan forward (comment/string
 * aware) to its matching close. Returns the CONTENTS range: start just
 * after the opener, end at the position of the matching closer.
 */
function scanBracketedRange(text: string, openIdx: number): TextRange | null {
  const opener = text[openIdx];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let state: ScanState = "normal";
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (state === "string") {
      if (c === "\\") { i++; continue; }
      if (c === '"') state = "normal";
      continue;
    }
    if (state === "lineComment") {
      if (c === "\n") state = "normal";
      continue;
    }
    if (state === "blockComment") {
      if (c === "*" && next === "/") { state = "normal"; i++; }
      continue;
    }
    // state === "normal"
    if (c === '"') { state = "string"; continue; }
    if (c === "/" && next === "/") { state = "lineComment"; i++; continue; }
    if (c === "/" && next === "*") { state = "blockComment"; i++; continue; }
    if (c === opener) { depth++; continue; }
    if (c === closer) {
      depth--;
      if (depth === 0) {
        return { start: openIdx + 1, end: i };
      }
    }
  }
  return null;
}

// ─── Profile entry ───────────────────────────────────────────────────

/** Quote a Windows command-line argument — ALWAYS, same convention as
 *  window-launcher.ts's psQuote(): quoting a path with no spaces is a
 *  harmless no-op under CommandLineToArgvW, so there is no reason to
 *  special-case the common "no spaces today" path and risk it breaking
 *  if the install directory later contains one. */
export function quoteWindowsArg(arg: string): string {
  return `"${arg.replace(/"/g, '\\"')}"`;
}

/** Build the `commandline` string WT will execute: THIS build's node.exe
 *  + CLI entry + `shell` — never `shell --window` (that would spawn a
 *  second, redundant window on top of the one WT just opened). */
export function buildProfileCommandline(launch: LaunchCommand): string {
  return [launch.exe, ...launch.args].map(quoteWindowsArg).join(" ");
}

export interface LittProfileEntry {
  guid: string;
  name: string;
  commandline: string;
  startingDirectory: string;
  hidden: boolean;
}

export function buildProfileEntry(launch: LaunchCommand, startingDirectory: string): LittProfileEntry {
  return {
    guid: LITT_PROFILE_GUID,
    name: LITT_PROFILE_NAME,
    commandline: buildProfileCommandline(launch),
    startingDirectory,
    hidden: false,
  };
}

/** Render the profile entry as indented JSON text for splicing into the
 *  existing list — valid JSONC, matches the ambient 2-tab/4-space-ish
 *  indent closely enough to read naturally without touching anything
 *  else in the file. */
function renderEntryText(entry: LittProfileEntry, indent: string): string {
  const lines = JSON.stringify(entry, null, 4).split("\n");
  return lines.map((line) => indent + line).join("\n");
}

// ─── Orchestrator ────────────────────────────────────────────────────

export type InstallOutcome =
  | { ok: true; reason: "installed"; path: string; backupPath: string }
  | { ok: true; reason: "already-installed"; path: string }
  | { ok: false; reason: "settings-not-found" }
  | { ok: false; reason: "profiles-list-not-found"; path: string }
  | { ok: false; reason: "unparseable"; path: string };

/**
 * Install (or confirm) the LiTT Windows Terminal profile.
 *
 * `launch` is the re-launch vector for THIS CLI build (see
 * `currentCliCommand(["shell"])` in window-launcher.ts) and
 * `startingDirectory` is the project root the profile should open into.
 * Both are supplied by the caller (commands/terminal-profile.ts) so this
 * module stays pure and fully unit-testable, same convention as
 * window-launcher.ts's own DI-style env.
 */
export function installTerminalProfile(
  launch: LaunchCommand,
  startingDirectory: string,
  env: TerminalProfileEnv = {},
): InstallOutcome {
  const readFile = env.readFileImpl ?? ((p: string) => readFileSync(p, "utf8"));
  const writeFile = env.writeFileImpl ?? ((p: string, content: string) => writeFileSync(p, content, "utf8"));
  const now = env.nowImpl ?? (() => new Date());

  const path = resolveSettingsPath(env);
  if (!path) return { ok: false, reason: "settings-not-found" };

  const original = readFile(path);

  let parsedList: unknown;
  try {
    const stripped = stripJsonComments(original);
    const parsed = JSON.parse(stripped) as { profiles?: unknown };
    const profiles = parsed.profiles;
    parsedList = Array.isArray(profiles)
      ? profiles
      : (profiles as { list?: unknown } | undefined)?.list;
  } catch {
    return { ok: false, reason: "unparseable", path };
  }

  if (Array.isArray(parsedList) && parsedList.some(
    (p) => typeof p === "object" && p !== null && (p as { guid?: unknown }).guid === LITT_PROFILE_GUID,
  )) {
    return { ok: true, reason: "already-installed", path };
  }

  const range = findProfileListRange(original);
  if (!range) return { ok: false, reason: "profiles-list-not-found", path };

  const listContents = original.slice(range.start, range.end);
  // The LAST significant (non-comment, non-whitespace) character decides
  // whether a leading comma is needed — NOT merely "is there any
  // non-whitespace at all" (that misfires on a list that already ends in
  // a trailing comma, or holds only a comment, producing invalid `, ,` /
  // `[ ,` JSONC that neither WT nor stripJsonComments can parse back).
  const lastSignificant = stripJsonComments(listContents).trim().slice(-1);
  const needsLeadingComma = lastSignificant !== "" && lastSignificant !== ",";
  const entry = buildProfileEntry(launch, startingDirectory);
  const entryText = renderEntryText(entry, "    ");
  const insertion = needsLeadingComma
    ? `,\n${entryText}\n`
    : `\n${entryText}\n`;

  // Insert right before the closing bracket, leaving every other byte
  // (including all comments and existing entries) untouched.
  const updated = original.slice(0, range.end) + insertion + original.slice(range.end);

  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.litt-backup-${stamp}`;
  writeFile(backupPath, original);
  writeFile(path, updated);

  return { ok: true, reason: "installed", path, backupPath };
}
