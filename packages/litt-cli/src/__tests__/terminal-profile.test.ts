/**
 * Windows Terminal profile installer — `litt terminal-profile install`.
 *
 * Covers the safety contract from lib/terminal-profile.ts:
 *   - settings.json is JSONC (comments + trailing commas) — must survive
 *     byte-for-byte except for the spliced-in profile entry
 *   - a timestamped backup is written before any edit
 *   - re-running the installer on an already-patched file is a no-op
 *     (duplicate detection by GUID), never a second entry
 *   - a missing settings.json is reported, never fabricated
 *   - the commandline launches `litt shell` directly — NEVER
 *     `litt shell --window` (that would open a second window)
 */

import { describe, it, expect, vi } from "vitest";
import {
  LITT_PROFILE_GUID,
  candidateSettingsPaths,
  resolveSettingsPath,
  stripJsonComments,
  findProfileListRange,
  buildProfileCommandline,
  installTerminalProfile,
  type TerminalProfileEnv,
} from "../lib/terminal-profile.js";
import type { LaunchCommand } from "../lib/window-launcher.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const ENTRY = "C:\\litt\\dist\\index.js";
const LAUNCH: LaunchCommand = { exe: NODE, args: [ENTRY, "shell"] };
const CWD = "C:\\Users\\test\\project";

// ─── Path resolution ───────────────────────────────────────────────

describe("candidateSettingsPaths / resolveSettingsPath", () => {
  it("checks the Store (stable), Store (preview), then unpackaged locations, in that order", () => {
    const paths = candidateSettingsPaths({ localAppData: "C:\\Users\\test\\AppData\\Local" });
    expect(paths).toEqual([
      "C:\\Users\\test\\AppData\\Local\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json",
      "C:\\Users\\test\\AppData\\Local\\Packages\\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\\LocalState\\settings.json",
      "C:\\Users\\test\\AppData\\Local\\Microsoft\\Windows Terminal\\settings.json",
    ]);
  });

  it("returns [] when LOCALAPPDATA is unknown — never guesses a path", () => {
    // An explicit blank (not undefined — undefined falls through to the
    // real process.env.LOCALAPPDATA, same DI convention as
    // window-launcher.ts's resolveEnvDirs) simulates "truly unknown".
    expect(candidateSettingsPaths({ localAppData: "" })).toEqual([]);
  });

  it("resolves the first candidate that actually exists", () => {
    const paths = candidateSettingsPaths({ localAppData: "C:\\u" });
    const existing = paths[1]!;
    const resolved = resolveSettingsPath({
      localAppData: "C:\\u",
      existsImpl: (p) => p === existing,
    });
    expect(resolved).toBe(existing);
  });

  it("returns null when none of the candidates exist — never fabricates a file", () => {
    const resolved = resolveSettingsPath({ localAppData: "C:\\u", existsImpl: () => false });
    expect(resolved).toBeNull();
  });
});

// ─── JSONC-safe comment stripping ───────────────────────────────────

describe("stripJsonComments", () => {
  it("strips // and /* */ comments but preserves string contents", () => {
    const input = `{
      // a comment
      "a": 1, /* inline */
      "url": "http://example.com/* not a comment */",
      "b": 2,
    }`;
    const parsed = JSON.parse(stripJsonComments(input));
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
    expect(parsed.url).toBe("http://example.com/* not a comment */");
  });

  it("strips trailing commas before } and ]", () => {
    const input = `{ "list": [1, 2, 3,], "x": 1, }`;
    expect(() => JSON.parse(stripJsonComments(input))).not.toThrow();
  });

  it("handles an escaped quote immediately followed by a line comment", () => {
    const input = `{ "name": "quote \\" then //not a comment inside the string", "x": 1 } // real comment`;
    const stripped = stripJsonComments(input);
    const parsed = JSON.parse(stripped);
    expect(parsed.name).toBe('quote " then //not a comment inside the string');
    expect(parsed.x).toBe(1);
  });
});

// ─── Locating the profiles list (comment/string safe) ───────────────

describe("findProfileListRange", () => {
  it("finds a top-level profiles array", () => {
    const text = `{ "profiles": [ { "name": "PowerShell" } ] }`;
    const range = findProfileListRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end).trim()).toBe('{ "name": "PowerShell" }');
  });

  it("finds profiles.list when profiles is an object with defaults + list", () => {
    const text = `{ "profiles": { "defaults": {}, "list": [ { "name": "PowerShell" } ] } }`;
    const range = findProfileListRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end).trim()).toBe('{ "name": "PowerShell" }');
  });

  it("is not confused by a bracket-like string inside a profile name", () => {
    const text = `{ "profiles": { "list": [ { "name": "weird ] name [2]" } ] } }`;
    const range = findProfileListRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end).trim()).toBe('{ "name": "weird ] name [2]" }');
  });

  it("is not confused by a bracket inside a comment", () => {
    const text = `{ "profiles": { /* odd ] bracket */ "list": [ { "name": "PowerShell" } ] } }`;
    const range = findProfileListRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end).trim()).toBe('{ "name": "PowerShell" }');
  });

  it("is not confused by a bracket inside a // line comment", () => {
    const text = `{ "profiles": { "list": [ // odd ] bracket on this line\n{ "name": "PowerShell" } ] } }`;
    const range = findProfileListRange(text);
    expect(range).not.toBeNull();
    expect(text.slice(range!.start, range!.end).trim()).toBe('// odd ] bracket on this line\n{ "name": "PowerShell" }');
  });

  it("returns null when there is no profiles key", () => {
    expect(findProfileListRange(`{ "defaultProfile": "x" }`)).toBeNull();
  });
});

// ─── Commandline — must be `shell`, never `shell --window` ──────────

describe("buildProfileCommandline", () => {
  it("quotes every argument — node.exe, the entry path, AND the bare `shell` word", () => {
    const cmd = buildProfileCommandline(LAUNCH);
    expect(cmd).toBe(`"${NODE}" "${ENTRY}" "shell"`);
  });

  it("NEVER includes --window (would spawn a second window on top of the profile's own)", () => {
    expect(buildProfileCommandline(LAUNCH)).not.toContain("--window");
  });

  it("quotes paths with no spaces too — harmless, and robust if the install path later gains one", () => {
    const cmd = buildProfileCommandline({ exe: "node", args: ["entry.js", "shell"] });
    expect(cmd).toBe('"node" "entry.js" "shell"');
  });
});

// ─── Full orchestration ─────────────────────────────────────────────

function makeEnv(overrides: Partial<TerminalProfileEnv> & { files: Record<string, string> }): TerminalProfileEnv {
  const { files, ...rest } = overrides;
  return {
    localAppData: "C:\\u",
    existsImpl: (p) => p in files,
    readFileImpl: (p) => files[p]!,
    writeFileImpl: (p, content) => { files[p] = content; },
    nowImpl: () => new Date("2026-10-19T02:00:00.000Z"),
    ...rest,
  };
}

describe("installTerminalProfile", () => {
  it("reports settings-not-found and writes nothing when WT has never run", () => {
    const files: Record<string, string> = {};
    const result = installTerminalProfile(LAUNCH, CWD, makeEnv({ files }));
    expect(result).toEqual({ ok: false, reason: "settings-not-found" });
    expect(Object.keys(files)).toHaveLength(0);
  });

  it("installs the profile, preserving comments and existing entries verbatim", () => {
    const settingsPath = "C:\\u\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json";
    const original = [
      "{",
      "    // user's own comment — must survive",
      '    "defaultProfile": "{00000000-0000-0000-0000-000000000000}",',
      '    "profiles":',
      "    {",
      '        "defaults": {},',
      '        "list":',
      "        [",
      "            {",
      '                "name": "Windows PowerShell"',
      "            }",
      "        ]",
      "    }",
      "}",
      "",
    ].join("\n");
    const files: Record<string, string> = { [settingsPath]: original };
    const env = makeEnv({ files });

    const result = installTerminalProfile(LAUNCH, CWD, env);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("installed");
    expect(result.path).toBe(settingsPath);

    // Backup holds the ORIGINAL bytes, untouched.
    expect(files[result.backupPath]).toBe(original);
    expect(result.backupPath).toContain("litt-backup-2026-10-19");

    // The live file still parses, still contains the user's comment and
    // the original PowerShell entry, AND now also the LiTT profile.
    const updated = files[settingsPath]!;
    expect(updated).toContain("user's own comment — must survive");
    expect(updated).toContain("Windows PowerShell");
    const parsed = JSON.parse(stripJsonComments(updated));
    const list = parsed.profiles.list as Array<{ guid?: string; name?: string; commandline?: string }>;
    expect(list).toHaveLength(2);
    const litt = list.find((p) => p.guid === LITT_PROFILE_GUID);
    expect(litt).toBeDefined();
    expect(litt!.name).toBe("LiTT");
    expect(litt!.commandline).toBe(`"${NODE}" "${ENTRY}" "shell"`);
  });

  it("is idempotent — re-running after install reports already-installed and makes no second write", () => {
    const settingsPath = "C:\\u\\Packages\\Microsoft.WindowsTerminal_8wekyb3d8bbwe\\LocalState\\settings.json";
    const original = `{ "profiles": { "list": [] } }`;
    const files: Record<string, string> = { [settingsPath]: original };
    const env = makeEnv({ files });

    const first = installTerminalProfile(LAUNCH, CWD, env);
    expect(first.ok && first.reason).toBe("installed");

    const writeSpy = vi.fn(env.writeFileImpl);
    const secondEnv: TerminalProfileEnv = { ...env, writeFileImpl: writeSpy };
    const second = installTerminalProfile(LAUNCH, CWD, secondEnv);

    expect(second).toEqual({ ok: true, reason: "already-installed", path: settingsPath });
    expect(writeSpy).not.toHaveBeenCalled();

    // Still exactly one LiTT entry.
    const parsed = JSON.parse(stripJsonComments(files[settingsPath]!));
    const list = parsed.profiles.list as Array<{ guid?: string }>;
    expect(list.filter((p) => p.guid === LITT_PROFILE_GUID)).toHaveLength(1);
  });

  it("REGRESSION: a list ending in a trailing comma does not get a second comma", () => {
    // `[ {"name":"PS"}, ]` — a real WT file shape. Before the fix, "is
    // there any non-whitespace in the list" misfired on the trailing
    // comma and inserted `, ,`, which neither WT nor stripJsonComments
    // can parse back.
    const settingsPath = "C:\\u\\Microsoft\\Windows Terminal\\settings.json";
    const original = `{ "profiles": { "list": [ { "name": "PS" }, ] } }`;
    const files: Record<string, string> = { [settingsPath]: original };
    const env = makeEnv({ files });

    const result = installTerminalProfile(LAUNCH, CWD, env);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const updated = files[settingsPath]!;
    expect(updated).not.toMatch(/,\s*,/);
    const parsed = JSON.parse(stripJsonComments(updated));
    const list = parsed.profiles.list as Array<{ guid?: string; name?: string }>;
    expect(list).toHaveLength(2);
    expect(list.some((p) => p.name === "PS")).toBe(true);
    expect(list.some((p) => p.guid === LITT_PROFILE_GUID)).toBe(true);

    // Re-running must recognize the GUID and make no further changes —
    // proves the written file is valid JSONC, not just "didn't throw".
    const second = installTerminalProfile(LAUNCH, CWD, env);
    expect(second).toEqual({ ok: true, reason: "already-installed", path: settingsPath });
  });

  it("REGRESSION: a list holding only a comment is treated as empty (no leading comma)", () => {
    // `[ // nothing configured yet\n ]` — real non-whitespace content
    // (the comment), but no actual JSON entry. Before the fix this also
    // misfired and produced `[ ,` — invalid JSONC.
    const settingsPath = "C:\\u\\Microsoft\\Windows Terminal\\settings.json";
    const original = `{ "profiles": { "list": [ // nothing configured yet\n] } }`;
    const files: Record<string, string> = { [settingsPath]: original };
    const env = makeEnv({ files });

    const result = installTerminalProfile(LAUNCH, CWD, env);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const updated = files[settingsPath]!;
    expect(updated).toContain("nothing configured yet");
    expect(updated).not.toMatch(/\[\s*,/);
    const parsed = JSON.parse(stripJsonComments(updated));
    const list = parsed.profiles.list as Array<{ guid?: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]!.guid).toBe(LITT_PROFILE_GUID);
  });

  it("reports unparseable and writes nothing on a broken settings.json", () => {
    const settingsPath = "C:\\u\\Microsoft\\Windows Terminal\\settings.json";
    const files: Record<string, string> = { [settingsPath]: "{ not json" };
    const result = installTerminalProfile(LAUNCH, CWD, makeEnv({ files }));
    expect(result).toEqual({ ok: false, reason: "unparseable", path: settingsPath });
    expect(files[settingsPath]).toBe("{ not json");
  });

  it("reports profiles-list-not-found and writes nothing when there's no profiles list to patch", () => {
    const settingsPath = "C:\\u\\Microsoft\\Windows Terminal\\settings.json";
    const files: Record<string, string> = { [settingsPath]: `{ "defaultProfile": "x" }` };
    const result = installTerminalProfile(LAUNCH, CWD, makeEnv({ files }));
    expect(result).toEqual({ ok: false, reason: "profiles-list-not-found", path: settingsPath });
    expect(files[settingsPath]).toBe(`{ "defaultProfile": "x" }`);
  });
});
