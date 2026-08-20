/**
 * Entry routing contract — proves the three dispatch paths:
 *
 *   litt             → Ink cockpit (current terminal, NO Desktop window)
 *   litt shell       → Ink cockpit (explicit alias)
 *   litt desktop     → Desktop/Tauri GUI surface
 *
 * Both Ink and Desktop share the same canonical RuntimeSession.
 * The routing logic lives in lib/dispatch.ts (pure, no side effects).
 */
import { describe, it, expect } from "vitest";
import { resolveDispatch } from "../lib/dispatch.js";

describe("Entry routing — litt / litt shell / litt desktop", () => {
  it("bare `litt` dispatches to the Ink cockpit (surface=ink)", () => {
    const d = resolveDispatch([]);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
    expect(d.isHelp).toBe(false);
    expect(d.isVersion).toBe(false);
    expect(d.rest).toEqual([]);
  });

  it("`litt shell` dispatches to the Ink cockpit (surface=ink)", () => {
    const d = resolveDispatch(["shell"]);
    expect(d.command).toBe("shell");
    expect(d.surface).toBe("ink");
    expect(d.rest).toEqual([]);
  });

  it("`litt cockpit` dispatches to the Ink cockpit (surface=ink)", () => {
    const d = resolveDispatch(["cockpit"]);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
  });

  it("`litt tui` dispatches to the Ink cockpit (surface=ink)", () => {
    const d = resolveDispatch(["tui"]);
    expect(d.command).toBe("tui");
    expect(d.surface).toBe("ink");
  });

  it("`litt desktop` dispatches to the Desktop GUI (surface=desktop)", () => {
    const d = resolveDispatch(["desktop"]);
    expect(d.command).toBe("desktop");
    expect(d.surface).toBe("desktop");
    expect(d.isHelp).toBe(false);
  });

  it("bare `litt` does NOT dispatch to Desktop", () => {
    const d = resolveDispatch([]);
    expect(d.surface).not.toBe("desktop");
  });

  it("`litt shell` does NOT dispatch to Desktop", () => {
    const d = resolveDispatch(["shell"]);
    expect(d.surface).not.toBe("desktop");
  });

  it("`litt desktop` does NOT dispatch to Ink", () => {
    const d = resolveDispatch(["desktop"]);
    expect(d.surface).not.toBe("ink");
  });

  it("`litt --help` never dispatches a command", () => {
    const d = resolveDispatch(["--help"]);
    expect(d.isHelp).toBe(true);
    expect(d.command).toBeUndefined();
    expect(d.surface).toBe("none");
  });

  it("`litt -h` never dispatches a command", () => {
    const d = resolveDispatch(["-h"]);
    expect(d.isHelp).toBe(true);
    expect(d.command).toBeUndefined();
  });

  it("`litt --version` never dispatches a command", () => {
    const d = resolveDispatch(["--version"]);
    expect(d.isVersion).toBe(true);
    expect(d.command).toBeUndefined();
  });

  it("`litt doctor` dispatches to doctor (surface=none, not a surface launcher)", () => {
    const d = resolveDispatch(["doctor"]);
    expect(d.command).toBe("doctor");
    expect(d.surface).toBe("none");
  });

  it("`litt status` dispatches to status (surface=none)", () => {
    const d = resolveDispatch(["status"]);
    expect(d.command).toBe("status");
    expect(d.surface).toBe("none");
  });

  it("`litt check` dispatches to check (surface=none)", () => {
    const d = resolveDispatch(["check"]);
    expect(d.command).toBe("check");
    expect(d.surface).toBe("none");
  });

  it("`litt --tui` (redundant flag) still dispatches to Ink cockpit", () => {
    const d = resolveDispatch(["--tui"]);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
  });

  it("`litt shell --tui` strips --tui and dispatches to Ink", () => {
    const d = resolveDispatch(["shell", "--tui"]);
    expect(d.command).toBe("shell");
    expect(d.surface).toBe("ink");
    expect(d.rest).toEqual([]);
  });

  it("`litt --mode plan` dispatches to Ink cockpit in plan mode", () => {
    const d = resolveDispatch(["--mode", "plan"]);
    expect(d.command).toBe("cockpit");
    expect(d.surface).toBe("ink");
    expect(d.mode).toBe("plan");
  });

  it("`litt shell --mode act` dispatches to Ink in act mode", () => {
    const d = resolveDispatch(["shell", "--mode", "act"]);
    expect(d.command).toBe("shell");
    expect(d.surface).toBe("ink");
    expect(d.mode).toBe("act");
  });

  it("`litt desktop --remote` sets useRemote and dispatches to Desktop", () => {
    const d = resolveDispatch(["desktop", "--remote"]);
    expect(d.command).toBe("desktop");
    expect(d.surface).toBe("desktop");
    expect(d.useRemote).toBe(true);
  });

  it("rest args are preserved for the dispatched command", () => {
    const d = resolveDispatch(["check", "--staged"]);
    expect(d.command).toBe("check");
    expect(d.rest).toEqual(["--staged"]);
  });

  it("rest args are preserved for `litt run`", () => {
    const d = resolveDispatch(["run", "echo", "hello"]);
    expect(d.command).toBe("run");
    expect(d.rest).toEqual(["echo", "hello"]);
  });
});
