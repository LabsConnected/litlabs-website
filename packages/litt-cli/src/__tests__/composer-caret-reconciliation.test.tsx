/**
 * Composer caret reconciliation — the "Backspace is unreliable" bug.
 *
 * The pre-existing terminal-input suite mounts the Composer with a
 * parent that ONLY ever changes `value` in response to the Composer's
 * own onChange. That is not how the real cockpit drives it.
 *
 * In the real app (ink/app.tsx) the parent writes `value` from OUTSIDE
 * the Composer on every one of these paths:
 *
 *   - onSubmit            → store.actions.setComposerValue("")
 *   - palette selection   → store.actions.setComposerValue("")
 *   - submit-threw        → setComposerValue(draft)  (restore)
 *   - controller.attachToken / restoreSession
 *
 * The Composer keeps `caret` in its OWN state and syncs `valueRef` from
 * the prop in an effect — but never reconciles `caret`. So after any
 * external write the caret keeps pointing at the old offset, and because
 * the editor ops do not clamp, Backspace decrements a caret that is past
 * the end of the text and produces NO visible change.
 *
 * Symptom seen on the device: type, press Enter, type again, and the
 * first N Backspaces do nothing.
 *
 * These tests drive real terminal bytes through real Ink into the real
 * Composer, with a parent that behaves like the real cockpit.
 */

import React, { useState, useCallback } from "react";
import { PassThrough } from "node:stream";
import { render, Box } from "ink";
import { describe, it, expect } from "vitest";
import { Composer } from "../ink/shell/composer.js";

const DEL = String.fromCharCode(0x7f); // physical Backspace
const CR = "\r"; // Enter
const ESC = String.fromCharCode(0x1b);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stripAnsi = (s: string) =>
  s
    .replace(new RegExp(`${ESC}\\][^\\u0007]*\\u0007`, "g"), "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "");

interface Harness {
  send: (data: string) => Promise<void>;
  value: () => string;
  frame: () => string;
  submitted: () => string[];
  /** Write the draft from outside, exactly as the cockpit's store does. */
  setExternal: (v: string) => Promise<void>;
  cleanup: () => void;
}

/**
 * Mount the real Composer behind a parent that mirrors app.tsx:
 * the draft lives in the parent and the parent CLEARS it on submit.
 */
async function mountCockpitComposer(): Promise<Harness> {
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
  const stdout = new PassThrough() as PassThrough & {
    columns?: number;
    rows?: number;
    isTTY?: boolean;
  };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => {
    out += c.toString();
  });

  let current = "";
  const submits: string[] = [];
  let external: ((v: string) => void) | null = null;

  function Wrapper(): React.ReactElement {
    const [value, setValue] = useState("");
    current = value;
    external = setValue;

    // Exactly app.tsx's onSubmit: clear the draft from the PARENT.
    const onSubmit = useCallback((text: string) => {
      submits.push(text);
      setValue("");
    }, []);

    return (
      <Box>
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
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
    interactive: true,
  });

  // Ink probes for kitty-keyboard support for ~200ms on mount and
  // buffers stdin while probing. Wait it out.
  await sleep(320);

  return {
    async send(data: string) {
      stdin.write(data);
      await sleep(90);
    },
    value: () => current,
    frame: () => stripAnsi(out),
    submitted: () => [...submits],
    async setExternal(v: string) {
      external?.(v);
      await sleep(90);
    },
    cleanup: () => {
      instance.unmount();
      stdin.end();
    },
  };
}

describe("Composer — caret stays reconciled with the controlled value", () => {
  it("P0 acceptance: abcdef, Backspace x6 → empty, then xyz → 'xyz'", async () => {
    const h = await mountCockpitComposer();
    try {
      for (const ch of "abcdef") await h.send(ch);
      expect(h.value()).toBe("abcdef");

      for (let i = 0; i < 6; i++) await h.send(DEL);
      expect(h.value()).toBe("");

      for (const ch of "xyz") await h.send(ch);
      expect(h.value()).toBe("xyz");
    } finally {
      h.cleanup();
    }
  });

  it("every printable key registers exactly once", async () => {
    const h = await mountCockpitComposer();
    try {
      for (const ch of "abcdef") await h.send(ch);
      // Exactly six graphemes, in order — no doubles, no drops.
      expect(h.value()).toBe("abcdef");
      expect(h.value()).toHaveLength(6);
    } finally {
      h.cleanup();
    }
  });

  it("each Backspace removes exactly one character", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("abcdef");
      const seen: string[] = [];
      for (let i = 0; i < 6; i++) {
        await h.send(DEL);
        seen.push(h.value());
      }
      expect(seen).toEqual(["abcde", "abcd", "abc", "ab", "a", ""]);
    } finally {
      h.cleanup();
    }
  });

  // ─── The regression: an EXTERNAL write to `value` ──────────────────

  it("first Backspace after a submit-clear is NOT swallowed", async () => {
    // Reproduces the device report exactly:
    //   type → Enter (parent clears draft) → type → Backspace
    // Before the fix the caret was still at the pre-submit offset, so
    // backspace() decremented a past-the-end caret and changed nothing.
    const h = await mountCockpitComposer();
    try {
      await h.send("hello");
      expect(h.value()).toBe("hello");

      await h.send(CR);
      expect(h.submitted()).toEqual(["hello"]);
      expect(h.value()).toBe("");

      await h.send("abc");
      expect(h.value()).toBe("abc");

      // THE first Backspace after the submit — must delete exactly one.
      await h.send(DEL);
      expect(h.value()).toBe("ab");
    } finally {
      h.cleanup();
    }
  });

  it("full type/Backspace cycle still works after a submit", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("first message");
      await h.send(CR);
      expect(h.value()).toBe("");

      for (const ch of "abcdef") await h.send(ch);
      expect(h.value()).toBe("abcdef");

      for (let i = 0; i < 6; i++) await h.send(DEL);
      expect(h.value()).toBe("");

      for (const ch of "xyz") await h.send(ch);
      expect(h.value()).toBe("xyz");
    } finally {
      h.cleanup();
    }
  });

  it("Enter submits exactly once", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("one");
      await h.send(CR);
      expect(h.submitted()).toEqual(["one"]);

      await h.send("two");
      await h.send(CR);
      expect(h.submitted()).toEqual(["one", "two"]);
    } finally {
      h.cleanup();
    }
  });

  it("Escape clears the draft and leaves typing correct afterwards", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("abcdef");
      await h.send(ESC);
      expect(h.value()).toBe("");

      await h.send("xyz");
      expect(h.value()).toBe("xyz");

      await h.send(DEL);
      expect(h.value()).toBe("xy");
    } finally {
      h.cleanup();
    }
  });

  it("an external draft write (restore/attach) leaves the caret at the end", async () => {
    // controller.attachToken and the submit-error draft restore both
    // write `value` from outside. Typing must continue at the END of the
    // restored text, and Backspace must remove its last character.
    const h = await mountCockpitComposer();
    try {
      await h.setExternal("restored draft");
      expect(h.value()).toBe("restored draft");

      await h.send("!");
      expect(h.value()).toBe("restored draft!");

      await h.send(DEL);
      expect(h.value()).toBe("restored draft");
    } finally {
      h.cleanup();
    }
  });

  it("an external write to a SHORTER value cannot strand the caret", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("a long draft here");
      await h.setExternal("ab");
      expect(h.value()).toBe("ab");

      // Two Backspaces must empty it — not "decrement an invisible caret".
      await h.send(DEL);
      expect(h.value()).toBe("a");
      await h.send(DEL);
      expect(h.value()).toBe("");
    } finally {
      h.cleanup();
    }
  });

  it("input stays correct across a re-render that does not touch the draft", async () => {
    // A model response / tool call re-renders the tree. The draft and
    // caret must survive untouched.
    const h = await mountCockpitComposer();
    try {
      await h.send("abc");
      // Re-render with the SAME value (what a transcript update does).
      await h.setExternal("abc");
      await h.send("d");
      expect(h.value()).toBe("abcd");
      await h.send(DEL);
      expect(h.value()).toBe("abc");
    } finally {
      h.cleanup();
    }
  });

  it("the rendered frame shows the final text after the P0 sequence", async () => {
    const h = await mountCockpitComposer();
    try {
      await h.send("abcdef");
      for (let i = 0; i < 6; i++) await h.send(DEL);
      await h.send("xyz");
      expect(h.value()).toBe("xyz");
      // The last frame written must contain the current draft.
      const frames = h.frame();
      expect(frames).toContain("xyz");
    } finally {
      h.cleanup();
    }
  });
});
