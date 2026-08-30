/**
 * Slash-command UX regression — typing "/" is PLAIN composer input.
 *
 * The 2026-08-29 regression: typing "/" (or "/doc", "/doctor") in the
 * composer auto-opened the full command palette, replacing the entire
 * shell, and the Welcome screen vanished the moment any text was typed.
 * The palette also showed "No matches" for "/doctor" because the query
 * kept its leading slash while command ids were matched verbatim.
 *
 * Contract under test:
 *   - typing "/", "/doc", "/doctor" stays in the composer and NEVER
 *     calls onOpenPalette
 *   - Enter submits the slash command through the normal onSubmit path
 *   - Backspace and Esc keep working while a slash draft is present
 *   - "@" on an empty draft still opens the context picker
 *   - Welcome remains rendered while the composer holds "/doctor"
 *   - the Ctrl+K palette filter finds /doctor for "doctor", "/doctor",
 *     "doc" and "/doc" (leading-slash normalization)
 *   - the app-level Ctrl+K wiring (the explicit palette entry point)
 *     remains intact
 */

import React, { useState } from "react";
import { render } from "ink";
import { PassThrough, Writable } from "node:stream";
import { describe, it, expect } from "vitest";
// Imported by path on purpose: ink's package exports expose only ".",
// and these tests must use the SAME parser the running app uses.
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
const _require = createRequire(import.meta.url);
const _inkRoot = dirname(_require.resolve("ink"));
const parseKeypress = _require(join(_inkRoot, "parse-keypress.js")).default as typeof import("../../node_modules/ink/build/parse-keypress.js").default;
import { Composer } from "../ink/shell/composer.js";
import { CommandPalette, fuzzyScore, normalizeCommandQuery } from "../ink/command-palette.js";
import { LiTTShell } from "../ink/shell/shell.js";
import type { LiTTShellProps } from "../ink/shell/shell.js";
import type { KeyInfo } from "../ink/keyboard-utils.js";

const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const CR = "\r";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

function keyFromSequence(sequence: string): { input: string; key: KeyInfo } {
  const kp = parseKeypress(sequence) as {
    name: string; ctrl: boolean; shift: boolean; meta: boolean; sequence: string;
  };
  const key = {
    upArrow: kp.name === "up",
    downArrow: kp.name === "down",
    leftArrow: kp.name === "left",
    rightArrow: kp.name === "right",
    pageDown: kp.name === "pagedown",
    pageUp: kp.name === "pageup",
    home: kp.name === "home",
    end: kp.name === "end",
    return: kp.name === "return",
    escape: kp.name === "escape",
    ctrl: kp.ctrl,
    shift: kp.shift,
    tab: kp.name === "tab",
    backspace: kp.name === "backspace",
    delete: kp.name === "delete",
    meta: kp.meta,
  } as KeyInfo;
  const input = key.backspace || key.delete ? "" : kp.sequence;
  return { input, key };
}

// ─── Composer harness: REAL Ink + REAL stdin bytes ───────────────────

interface ComposerHarness {
  send: (data: string) => Promise<void>;
  value: () => string;
  paletteCalls: () => string[];
  contextCalls: () => string[];
  submitted: () => string[];
  cleanup: () => void;
}

async function mountComposer(): Promise<ComposerHarness> {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean; setRawMode?: (v: boolean) => void; ref?: () => void; unref?: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.on("data", () => {});

  let current = "";
  const paletteCalls: string[] = [];
  const contextCalls: string[] = [];
  const submitted: string[] = [];

  function Wrapper(): React.ReactElement {
    const [value, setValue] = useState("");
    current = value;
    return (
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={(v) => submitted.push(v)}
        onNavigateHistory={() => null}
        onOpenPalette={(q) => paletteCalls.push(q)}
        onOpenContext={(q) => contextCalls.push(q)}
        disabled={false}
      />
    );
  }

  const instance = render(<Wrapper />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  // Ink probes for kitty-keyboard support for 200ms on mount and buffers
  // stdin while probing. Wait it out so our bytes take the normal path.
  await sleep(320);

  return {
    async send(data: string) {
      stdin.write(data);
      await sleep(90);
    },
    value: () => current,
    paletteCalls: () => paletteCalls,
    contextCalls: () => contextCalls,
    submitted: () => submitted,
    cleanup: () => {
      instance.unmount();
      stdin.end();
    },
  };
}

// ─── Composer: slash typing is plain input ───────────────────────────

describe("slash-command UX: composer keeps slash input local", () => {
  it("typing '/' does NOT automatically open the command palette", async () => {
    const h = await mountComposer();
    try {
      await h.send("/");
      expect(h.value()).toBe("/");
      expect(h.paletteCalls()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("typing '/doctor' remains in the composer; palette never opens", async () => {
    const h = await mountComposer();
    try {
      for (const ch of "/doctor") await h.send(ch);
      expect(h.value()).toBe("/doctor");
      expect(h.paletteCalls()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("typing '/doc' stays in the composer (partial command, no overlay)", async () => {
    const h = await mountComposer();
    try {
      await h.send("/doc");
      expect(h.value()).toBe("/doc");
      expect(h.paletteCalls()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("Enter submits '/doctor' through the normal onSubmit path", async () => {
    const h = await mountComposer();
    try {
      await h.send("/doctor");
      expect(h.value()).toBe("/doctor");
      await h.send(CR);
      expect(h.submitted()).toEqual(["/doctor"]);
    } finally {
      h.cleanup();
    }
  });

  it("Backspace remains correct while a slash draft is present", async () => {
    const h = await mountComposer();
    try {
      await h.send("/doctor");
      expect(h.value()).toBe("/doctor");
      await h.send(DEL);
      expect(h.value()).toBe("/docto");
    } finally {
      h.cleanup();
    }
  });

  it("Esc clears the slash draft", async () => {
    const h = await mountComposer();
    try {
      await h.send("/doctor");
      expect(h.value()).toBe("/doctor");
      await h.send(ESC);
      expect(h.value()).toBe("");
    } finally {
      h.cleanup();
    }
  });

  it("Esc classification is unchanged (regression guard)", () => {
    const { key } = keyFromSequence(ESC);
    expect(key.escape).toBe(true);
  });

  it("'@' on an empty draft still opens the context picker", async () => {
    const h = await mountComposer();
    try {
      await h.send("@");
      expect(h.contextCalls()).toEqual([""]);
    } finally {
      h.cleanup();
    }
  });

  it("'@' mid-text does NOT open the context picker", async () => {
    const h = await mountComposer();
    try {
      await h.send("ab@c");
      expect(h.contextCalls()).toEqual([]);
      expect(h.value()).toBe("ab@c");
    } finally {
      h.cleanup();
    }
  });
});

// ─── Shell: Welcome stays visible while composing ────────────────────

function shellProps(over: Partial<LiTTShellProps> = {}): LiTTShellProps {
  return {
    messages: [],
    activityLog: [],
    holoState: "IDLE",
    isProcessing: false,
    busySince: null,
    missionState: null,
    gitModified: 0,
    gitUntracked: 0,
    toolProgress: null,
    executionTarget: "local",
    canonicalMission: null,
    workstream: null,
    composerValue: "",
    onComposerChange: () => {},
    onSubmit: () => {},
    onNavigateHistory: () => null,
    onOpenPalette: () => {},
    onOpenContext: () => {},
    composerDisabled: false,
    composerScrolled: false,
    composerFocusEpoch: 0,
    onComposerReturnToLive: () => {},
    transcriptAnchor: null,
    onTranscriptPageChange: () => {},
    onTranscriptAnchorChange: () => {},
    project: "litlabs-website",
    branch: "main",
    localRuntime: "ready",
    brain: "LiTT Auto",
    activeModel: null,
    activeProvider: null,
    mode: "act",
    approvalPrompt: null,
    onApprovalDecision: () => {},
    approvalSince: null,
    approvalAccumMs: 0,
    ...over,
  } as LiTTShellProps;
}

function makeFakeStdin() {
  const l = new Map<string, () => void>();
  return {
    isTTY: true, setRawMode() {}, setEncoding() {}, ref() {}, unref() {},
    pause() {}, resume() {},
    addListener(e: string, f: () => void) { l.set(e, f); return this; },
    removeListener(e: string) { l.delete(e); return this; },
    on(e: string, f: () => void) { l.set(e, f); return this; },
    off(e: string) { l.delete(e); return this; },
    emit() {},
  };
}

function makeFakeStdout(): { stdout: Writable & { columns?: number; rows?: number; isTTY?: boolean }; text: () => string } {
  let out = "";
  const stdout = new Writable({
    write(chunk, _enc, cb) { out += chunk.toString(); cb(); },
  }) as Writable & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  return { stdout, text: () => out };
}

describe("slash-command UX: Welcome stays visible while typing", () => {
  it("Welcome remains rendered while the composer contains '/doctor'", async () => {
    const { stdout, text } = makeFakeStdout();
    const instance = render(
      <LiTTShell {...shellProps({ composerValue: "/doctor" })} />,
      {
        stdin: makeFakeStdin() as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        exitOnCtrlC: false,
        patchConsole: false,
      },
    );
    try {
      // Welcome has a ~300ms reveal timer — poll until the tagline shows.
      await expect.poll(
        () => stripAnsi(text()).includes("BUILD · SHIP · CREATE"),
        { timeout: 10_000, interval: 40 },
      ).toBe(true);
      const frame = stripAnsi(text());
      // Welcome identity + project context stay on screen…
      expect(frame).toContain("What do you want to build?");
      expect(frame).toContain("litlabs-website");
      // …AND the composer shows the slash draft in the same frame.
      expect(frame).toContain("/doctor");
    } finally {
      instance.unmount();
    }
  });
});

// ─── Palette: leading-slash-normalized filtering ─────────────────────

describe("slash-command UX: palette filter normalization", () => {
  it.each(["doctor", "/doctor", "doc", "/doc"])(
    "filtering %s finds /doctor",
    (q) => {
      const normalized = normalizeCommandQuery(q);
      const idScore = fuzzyScore(normalized, normalizeCommandQuery("/doctor"));
      const labelScore = fuzzyScore(normalized, "Diagnose LiTT");
      expect(Math.max(idScore, labelScore)).toBeGreaterThan(0);
    },
  );

  it("normalization strips all leading slashes and trims", () => {
    expect(normalizeCommandQuery("doctor")).toBe("doctor");
    expect(normalizeCommandQuery("/doctor")).toBe("doctor");
    expect(normalizeCommandQuery("//doctor")).toBe("doctor");
    expect(normalizeCommandQuery(" /doc ")).toBe("doc");
    expect(normalizeCommandQuery("/")).toBe("");
  });
});

// ─── App-level Ctrl+K wiring (the explicit palette entry point) ──────

describe("slash-command UX: Ctrl+K remains the palette entry point", () => {
  it("app shortcut handler still opens command-palette on Ctrl+K", () => {
    // Source-level canary: the app shortcut wiring must keep opening the
    // command palette on Ctrl+K. (The full App graph is too heavy to
    // mount here; this guards against accidental removal.)
    const appSrc = readFileSync(
      join(dirname(__filename), "..", "ink", "app.tsx"),
      "utf8",
    );
    expect(appSrc).toMatch(/isCtrl\(input,\s*key,\s*"k"\)/);
    expect(appSrc).toMatch(/setOverlay\("command-palette"\)/);
  });
});