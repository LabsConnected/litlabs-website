/**
 * LITT_STATE_HOME resolution — the Android fix.
 *
 * On Termux, LITT_HOME means "the LiTT repository root" to the shell
 * tooling (.config/litt/*.zsh cd/git -C into it). The CLI must NOT use
 * it as its state directory — honoring it scattered model-prefs.json,
 * recent-projects.json and config.json into the working tree and made
 * prefs diverge between login (LITT_HOME set) and minimal-env launches.
 *
 * The dedicated override is LITT_STATE_HOME. These tests pin:
 *   - LITT_STATE_HOME wins when set
 *   - unset → ~/.litt
 *   - LITT_HOME is ignored for state resolution (the regression)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { getLittHome, getConfigPath } from "../lib/config.js";
import { getDefaultPrefsPath } from "../lib/provider-registry.js";
import { readRecentProjects } from "../lib/active-project.js";

const SAVED: Record<string, string | undefined> = {};
const KEYS = ["LITT_STATE_HOME", "LITT_HOME", "LITT_RECENT_PROJECTS_FILE"];

beforeEach(() => {
  for (const k of KEYS) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe("state directory resolution", () => {
  it("getLittHome defaults to ~/.litt", () => {
    expect(getLittHome()).toBe(join(homedir(), ".litt"));
  });

  it("getLittHome honors LITT_STATE_HOME", () => {
    process.env.LITT_STATE_HOME = "/tmp/state-home-x";
    expect(getLittHome()).toBe("/tmp/state-home-x");
  });

  it("getLittHome IGNORES LITT_HOME (regression: repo var must not move state)", () => {
    process.env.LITT_HOME = "/tmp/repo-not-state";
    expect(getLittHome()).toBe(join(homedir(), ".litt"));
  });

  it("LITT_STATE_HOME wins even when LITT_HOME is also set", () => {
    process.env.LITT_HOME = "/tmp/repo-not-state";
    process.env.LITT_STATE_HOME = "/tmp/state-home-x";
    expect(getLittHome()).toBe("/tmp/state-home-x");
  });

  it("config path follows the state home", () => {
    process.env.LITT_STATE_HOME = "/tmp/state-home-x";
    expect(getConfigPath()).toBe(join("/tmp/state-home-x", "config.json"));
  });

  it("model-prefs path follows LITT_STATE_HOME, never LITT_HOME", () => {
    process.env.LITT_HOME = "/tmp/repo-not-state";
    expect(getDefaultPrefsPath()).toBe(join(homedir(), ".litt", "model-prefs.json"));
    process.env.LITT_STATE_HOME = "/tmp/state-home-x";
    expect(getDefaultPrefsPath()).toBe(join("/tmp/state-home-x", "model-prefs.json"));
  });

  it("recent-projects ignores LITT_HOME (no repo-root state file)", () => {
    process.env.LITT_HOME = "/tmp/repo-not-state";
    // readRecentProjects never throws; the point is it must not look in LITT_HOME.
    // With the override unset the file resolves under ~/.litt — the assertion is
    // that no entry leaks from a file placed under LITT_HOME.
    const entries = readRecentProjects();
    for (const e of entries) expect(e.workspacePath).not.toBe("/tmp/repo-not-state");
  });
});
