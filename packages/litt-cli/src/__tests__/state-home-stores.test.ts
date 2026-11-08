/**
 * LITT_STATE_HOME consistency — sessions + remote-workspace stores.
 *
 * These two stores previously resolved their default files via a
 * hardcoded homedir()/.litt, diverging from getLittHome() (config,
 * model-prefs, recent-projects). These tests pin the repaired contract:
 *
 *   - explicit per-file overrides still win (LITT_SESSIONS_FILE,
 *     LITT_REMOTE_WORKSPACE_FILE)
 *   - LITT_STATE_HOME is honored when no per-file override is set
 *   - default remains <home>/.litt when LITT_STATE_HOME is unset
 *   - LITT_HOME never moves state (it names the repo root on Android)
 *
 * Hermetic: HOME/USERPROFILE are pointed at a fresh sandbox dir, so a
 * regression writes into the sandbox — never the real ~/.litt.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveSession, readAllSessions } from "../lib/session-store.js";
import {
  setSelectedRemoteWorkspace,
  getSelectedRemoteWorkspace,
} from "../lib/remote-workspace-store.js";

const KEYS = [
  "LITT_STATE_HOME",
  "LITT_HOME",
  "LITT_SESSIONS_FILE",
  "LITT_REMOTE_WORKSPACE_FILE",
  "HOME",
  "USERPROFILE",
];

const SAVED: Record<string, string | undefined> = {};
let sandbox: string;
let fakeHome: string;
let stateHome: string;

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  sandbox = mkdtempSync(join(tmpdir(), "litt-statehome-"));
  fakeHome = join(sandbox, "home");
  stateHome = join(sandbox, "state");
  // Sandbox the process home so no code path can reach real user state.
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  delete process.env.LITT_STATE_HOME;
  delete process.env.LITT_HOME;
  delete process.env.LITT_SESSIONS_FILE;
  delete process.env.LITT_REMOTE_WORKSPACE_FILE;
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  rmSync(sandbox, { recursive: true, force: true });
});

const sessionInput = () => ({
  project: "proj",
  cwd: join(sandbox, "proj"),
  branch: "main",
  mode: "act" as const,
  routingMode: "fixed",
  selectedModel: "ollama:test",
  summary: "state home check",
  messages: [{ role: "user" as const, content: "hi", status: "complete", ts: 1 }],
});

const wsSelection = {
  workspaceId: "ws_1",
  projectId: "prj_1",
  root: "/srv/ws",
  branch: "main",
};

describe("session-store state directory", () => {
  it("honors LITT_STATE_HOME when no per-file override is set", () => {
    process.env.LITT_STATE_HOME = stateHome;
    saveSession(sessionInput());
    expect(existsSync(join(stateHome, "sessions.json"))).toBe(true);
    // Must NOT have fallen back to the process home — the exact
    // pre-fix behavior this test pins against.
    expect(existsSync(join(fakeHome, ".litt", "sessions.json"))).toBe(false);
    expect(readAllSessions()).toHaveLength(1);
  });

  it("defaults to <home>/.litt when LITT_STATE_HOME is unset", () => {
    saveSession(sessionInput());
    expect(existsSync(join(fakeHome, ".litt", "sessions.json"))).toBe(true);
  });

  it("ignores LITT_HOME (repo-root var must not move state)", () => {
    process.env.LITT_HOME = join(sandbox, "repo");
    saveSession(sessionInput());
    expect(existsSync(join(fakeHome, ".litt", "sessions.json"))).toBe(true);
    expect(existsSync(join(sandbox, "repo", "sessions.json"))).toBe(false);
  });

  it("LITT_SESSIONS_FILE beats LITT_STATE_HOME", () => {
    const explicit = join(sandbox, "explicit", "sessions.json");
    process.env.LITT_SESSIONS_FILE = explicit;
    process.env.LITT_STATE_HOME = stateHome;
    saveSession(sessionInput());
    expect(existsSync(explicit)).toBe(true);
    expect(existsSync(join(stateHome, "sessions.json"))).toBe(false);
  });
});

describe("remote-workspace-store state directory", () => {
  it("honors LITT_STATE_HOME when no per-file override is set", () => {
    process.env.LITT_STATE_HOME = stateHome;
    setSelectedRemoteWorkspace(wsSelection);
    expect(existsSync(join(stateHome, "remote-workspace.json"))).toBe(true);
    expect(existsSync(join(fakeHome, ".litt", "remote-workspace.json"))).toBe(false);
    expect(getSelectedRemoteWorkspace()?.workspaceId).toBe("ws_1");
  });

  it("defaults to <home>/.litt when LITT_STATE_HOME is unset", () => {
    setSelectedRemoteWorkspace(wsSelection);
    expect(existsSync(join(fakeHome, ".litt", "remote-workspace.json"))).toBe(true);
  });

  it("ignores LITT_HOME (repo-root var must not move state)", () => {
    process.env.LITT_HOME = join(sandbox, "repo");
    setSelectedRemoteWorkspace(wsSelection);
    expect(existsSync(join(fakeHome, ".litt", "remote-workspace.json"))).toBe(true);
    expect(existsSync(join(sandbox, "repo", "remote-workspace.json"))).toBe(false);
  });

  it("LITT_REMOTE_WORKSPACE_FILE beats LITT_STATE_HOME", () => {
    const explicit = join(sandbox, "explicit", "remote-workspace.json");
    process.env.LITT_REMOTE_WORKSPACE_FILE = explicit;
    process.env.LITT_STATE_HOME = stateHome;
    setSelectedRemoteWorkspace(wsSelection);
    expect(existsSync(explicit)).toBe(true);
    expect(existsSync(join(stateHome, "remote-workspace.json"))).toBe(false);
  });
});
