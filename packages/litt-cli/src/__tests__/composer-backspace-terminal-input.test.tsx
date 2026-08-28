/**
 * Backspace — REAL terminal input path (integration).
 *
 * The pre-existing composer-backspace tests assert against hand-built
 * key objects (`makeKey({ backspace: true })`). That proves the reducer
 * branch, but it CANNOT prove the live bug is fixed: it skips the two
 * layers that actually decide whether the branch is ever reached —
 * Ink's input parser and Ink's `useInput` key-object construction.
 *
 * This suite drives the bytes a terminal really sends:
 *
 *   PassThrough stdin  →  Ink InputParser  →  parseKeypress
 *                      →  useInput key object  →  the REAL <Composer/>
 *
 * The byte shapes below are not invented. They were captured by driving
 * the installed global `litt` binary through a real Windows ConPTY
 * (node-pty) and observing what a physical Backspace delivers:
 *
 *   0x7F        physical Backspace (Windows Terminal, macOS, xterm family)
 *   0x08        conhost / Ctrl+H / some remote sessions
 *   ESC [ 3 ~   Delete key
 *
 * plus the chunking shapes a real terminal produces: one byte per read,
 * a whole burst in a single read, and text+Backspace arriving together
 * in the SAME read (fast typing).
 */

import React, { useState } from "react";
import { PassThrough } from "node:stream";
import { render, Box } from "ink";
import { describe, it, expect } from "vitest";
// Imported by path on purpose: ink's package exports expose only ".", and
// this test must use the SAME parser the running app uses, not a copy.
// Resolve via the package root + path.join to bypass the exports map.
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
const _require = createRequire(import.meta.url);
const _inkRoot = dirname(_require.resolve("ink"));
const parseKeypress = _require(join(_inkRoot, "parse-keypress.js")).default as typeof import("../../node_modules/ink/build/parse-keypress.js").default;
import { Composer } from "../ink/shell/composer.js";
import { isBackspace, type KeyInfo } from "../ink/keyboard-utils.js";

const DEL = String.fromCharCode(0x7f); // physical Backspace
const BS = String.fromCharCode(0x08); // conhost / Ctrl+H
const ESC = String.fromCharCode(0x1b);
const DELETE_KEY = `${ESC}[3~`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

/**
 * Build the key object exactly as ink's useInput does, from a raw
 * sequence. Mirrors ink/build/hooks/use-input.js so a drift in Ink's
 * classification shows up here as a failure.
 */
function keyFromSequence(sequence: string): { input: string; key: KeyInfo } {
  const kp = parseKeypress(sequence) as {
    name: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    sequence: string;
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
  // useInput blanks input for non-alphanumeric keys.
  const input = key.backspace || key.delete ? "" : kp.sequence;
  return { input, key };
}

// ─── Harness: the REAL Composer behind real Ink render ───────────────

interface Harness {
  /** Feed raw bytes exactly as a terminal read would deliver them. */
  send: (data: string) => Promise<void>;
  /** Current composer draft (controlled value the component reports). */
  value: () => string;
  /** Last rendered frame, ANSI stripped. */
  frame: () => string;
  cleanup: () => void;
}

async function mountComposer(): Promise<Harness> {
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (v: boolean) => void;
    ref?: () => void;
    unref?: () => void;
  };
  stdin.isTTY = true;
  stdin.setRawMode = () => {};
  stdin.ref = () => {};
  stdin.unref = () => {};

  let out = "";
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => {
    out += c.toString();
  });

  let current = "";
  let setter: ((v: string) => void) | null = null;

  function Wrapper(): React.ReactElement {
    const [value, setValue] = useState("");
    current = value;
    setter = setValue;
    return (
      <Box>
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
          onNavigateHistory={() => null}
          onOpenPalette={() => {}}
          onOpenContext={() => {}}
          disabled={false}
        />
      </Box>
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
  void setter;

  return {
    async send(data: string) {
      stdin.write(data);
      await sleep(90);
    },
    value: () => current,
    frame: () => stripAnsi(out),
    cleanup: () => {
      instance.unmount();
      stdin.end();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────

describe("Backspace — Ink classification of real terminal bytes", () => {
  it("classifies 0x7F (physical Backspace) as backspace", () => {
    const { key } = keyFromSequence(DEL);
    expect(key.backspace).toBe(true);
  });

  it("classifies 0x08 (conhost / Ctrl+H) as backspace", () => {
    const { key } = keyFromSequence(BS);
    expect(key.backspace).toBe(true);
  });

  it("classifies ESC[3~ (Delete) as delete", () => {
    const { key } = keyFromSequence(DELETE_KEY);
    expect(key.delete).toBe(true);
  });

  it("isBackspace accepts every real erase sequence", () => {
    for (const seq of [DEL, BS, DELETE_KEY]) {
      const { input, key } = keyFromSequence(seq);
      expect(isBackspace(key, input)).toBe(true);
    }
  });

  it("isBackspace still rejects ordinary typed characters", () => {
    for (const seq of ["a", "Z", "/", "@", " "]) {
      const { input, key } = keyFromSequence(seq);
      expect(isBackspace(key, input)).toBe(false);
    }
  });

  it("isBackspace matches the raw byte even if Ink fails to classify it", () => {
    // Defense in depth: an unclassified chunk must never make Backspace a
    // silent no-op — that is the exact reported failure mode.
    const unclassified = { backspace: false, delete: false } as KeyInfo;
    expect(isBackspace(unclassified, DEL)).toBe(true);
    expect(isBackspace(unclassified, BS)).toBe(true);
    expect(isBackspace(unclassified, "a")).toBe(false);
  });

  it("does not treat pasted text containing a DEL byte as a keypress", () => {
    const pasted = { backspace: false, delete: false } as KeyInfo;
    expect(isBackspace(pasted, `abc${DEL}def`)).toBe(false);
  });
});

describe("Backspace — real Composer driven by real terminal bytes", () => {
  it("types abcdef, one Backspace leaves abcde — no Esc first", async () => {
    const h = await mountComposer();
    try {
      for (const ch of "abcdef") await h.send(ch);
      expect(h.value()).toBe("abcdef");

      await h.send(DEL);

      expect(h.value()).toBe("abcde");
      expect(h.frame()).toContain("abcde");
    } finally {
      h.cleanup();
    }
  });

  it("erases with 0x08 as well as 0x7F", async () => {
    const h = await mountComposer();
    try {
      await h.send("abcdef");
      await h.send(BS);
      expect(h.value()).toBe("abcde");
    } finally {
      h.cleanup();
    }
  });

  it("handles text and Backspace arriving in the SAME read (fast typing)", async () => {
    // The stale-ref failure: two useInput calls in one macrotask, where
    // the second read a pre-typing value/caret and became a no-op.
    const h = await mountComposer();
    try {
      await h.send(`abcdef${DEL}`);
      expect(h.value()).toBe("abcde");
    } finally {
      h.cleanup();
    }
  });

  it("handles a held Backspace (repeat bytes in one read)", async () => {
    const h = await mountComposer();
    try {
      await h.send("abcdef");
      await h.send(DEL + DEL + DEL);
      expect(h.value()).toBe("abc");
    } finally {
      h.cleanup();
    }
  });

  it("erases back to empty and stays empty (no underflow)", async () => {
    const h = await mountComposer();
    try {
      await h.send("ab");
      await h.send(DEL + DEL + DEL + DEL);
      expect(h.value()).toBe("");
    } finally {
      h.cleanup();
    }
  });

  it("Backspace works on the very first keystroke after mount", async () => {
    // Guards the reported symptom directly: no Esc, no overlay, no prior
    // interaction needed to "wake up" the composer.
    const h = await mountComposer();
    try {
      await h.send("x");
      await h.send(DEL);
      expect(h.value()).toBe("");
    } finally {
      h.cleanup();
    }
  });

  // ─── First-Backspace-after-startup (physical device regression) ─────
  // On Termux/Android, the reported bug was: "The first Backspace after
  // LiTT starts may be ignored until Esc or another interaction
  // initializes input state." These tests prove the fix: the very first
  // Backspace after mount (simulating fresh launch) edits the composer
  // immediately, with no Esc or second key required.

  it("first Backspace after fresh mount: abc → ab (no Esc needed)", async () => {
    // Exact reproduction of the physical-device test:
    // 1. Mount composer (simulates LiTT startup)
    // 2. Type "abc"
    // 3. Press Backspace ONCE
    // 4. Verify value is "ab" (not "abc")
    const h = await mountComposer();
    try {
      // Type abc one char at a time (as a physical keyboard does)
      await h.send("a");
      await h.send("b");
      await h.send("c");
      expect(h.value()).toBe("abc");

      // THE FIRST Backspace — must work immediately
      await h.send(DEL);

      expect(h.value()).toBe("ab");
      // The value is the source of truth — the frame accumulates render
      // history so we check the value, not the frame for "not abc".
    } finally {
      h.cleanup();
    }
  });

  it("first Backspace after fresh mount with pasted text: abc → ab", async () => {
    // Same scenario but text arrives as a single paste event
    const h = await mountComposer();
    try {
      await h.send("abc");
      expect(h.value()).toBe("abc");

      await h.send(DEL);

      expect(h.value()).toBe("ab");
    } finally {
      h.cleanup();
    }
  });

  it("first Backspace with 0x08 (conhost/Ctrl+H) after fresh mount", async () => {
    // Some terminals send 0x08 instead of 0x7f — both must work
    const h = await mountComposer();
    try {
      await h.send("abc");
      await h.send(BS);
      expect(h.value()).toBe("ab");
    } finally {
      h.cleanup();
    }
  });

  it("first Backspace after fresh mount: abc + DEL in same read → ab", async () => {
    // Fast typing: text and Backspace arrive in the same stdin read
    const h = await mountComposer();
    try {
      await h.send(`abc${DEL}`);
      expect(h.value()).toBe("ab");
    } finally {
      h.cleanup();
    }
  });

  it("repeated fresh-mount first-Backspace is consistent", async () => {
    // Run the test 3 times with fresh mounts to prove consistency
    // (matches the physical-device consistency test)
    for (let i = 0; i < 3; i++) {
      const h = await mountComposer();
      try {
        await h.send("abc");
        expect(h.value()).toBe("abc");
        await h.send(DEL);
        expect(h.value()).toBe("ab");
      } finally {
        h.cleanup();
      }
    }
  });
});
