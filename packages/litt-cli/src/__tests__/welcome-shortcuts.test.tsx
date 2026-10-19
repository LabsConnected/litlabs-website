/**
 * Welcome-screen h/m/s shortcuts.
 *
 * The welcome screen's footer advertises [Enter] Start [H] Health
 * [M] Models [S] Settings. Composer.tsx owns ALL printable input, so the
 * shortcuts are implemented as a narrow interception inside its own
 * useInput — gated on `welcomeShortcutsEnabled` (no conversation yet) AND
 * an empty draft, the same precedent already used for the "v opens the
 * failure view" shortcut.
 *
 * These tests drive real terminal bytes through real Ink into the real
 * Composer (same harness as composer-caret-reconciliation.test.tsx) to
 * prove:
 *   - h/m/s on an empty draft fire the callback and do NOT get typed
 *   - once a conversation exists (welcomeShortcutsEnabled=false), h/m/s
 *     are plain text again — no regression for normal typing
 *   - h/m/s type normally once the draft is non-empty
 *   - a busy composer (disabled) never fires the shortcut
 */

import React, { useState, useCallback } from "react";
import { PassThrough } from "node:stream";
import { render, Box } from "ink";
import { describe, it, expect } from "vitest";
import { Composer } from "../ink/shell/composer.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type WelcomeAction = "health" | "models" | "settings";

interface Harness {
  send: (data: string) => Promise<void>;
  value: () => string;
  shortcuts: () => WelcomeAction[];
  setWelcomeEnabled: (v: boolean) => Promise<void>;
  setDisabled: (v: boolean) => Promise<void>;
  cleanup: () => void;
}

async function mountComposer(initialWelcomeEnabled: boolean): Promise<Harness> {
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

  const stdout = new PassThrough() as PassThrough & {
    columns?: number;
    rows?: number;
    isTTY?: boolean;
  };
  stdout.columns = 100;
  stdout.rows = 30;
  stdout.isTTY = true;
  stdout.on("data", () => {});

  let current = "";
  const shortcuts: WelcomeAction[] = [];
  let setWelcomeEnabledExternal: ((v: boolean) => void) | null = null;
  let setDisabledExternal: ((v: boolean) => void) | null = null;

  function Wrapper(): React.ReactElement {
    const [value, setValue] = useState("");
    const [welcomeEnabled, setWelcomeEnabled] = useState(initialWelcomeEnabled);
    const [disabled, setDisabled] = useState(false);
    current = value;
    setWelcomeEnabledExternal = setWelcomeEnabled;
    setDisabledExternal = setDisabled;

    const onSubmit = useCallback((text: string) => {
      setValue("");
      void text;
    }, []);

    return (
      <Box>
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={onSubmit}
          onNavigateHistory={() => null}
          onOpenContext={() => {}}
          disabled={disabled}
          welcomeShortcutsEnabled={welcomeEnabled}
          onWelcomeShortcut={(action) => shortcuts.push(action)}
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
    shortcuts: () => [...shortcuts],
    async setWelcomeEnabled(v: boolean) {
      setWelcomeEnabledExternal?.(v);
      await sleep(90);
    },
    async setDisabled(v: boolean) {
      setDisabledExternal?.(v);
      await sleep(90);
    },
    cleanup: () => {
      instance.unmount();
      stdin.end();
    },
  };
}

describe("Welcome-screen h/m/s shortcuts", () => {
  it("h/m/s on an empty draft fire the callback and leave the draft empty", async () => {
    const h = await mountComposer(true);
    try {
      await h.send("h");
      expect(h.value()).toBe("");
      await h.send("m");
      expect(h.value()).toBe("");
      await h.send("s");
      expect(h.value()).toBe("");
      expect(h.shortcuts()).toEqual(["health", "models", "settings"]);
    } finally {
      h.cleanup();
    }
  });

  it("uppercase H/M/S are NOT intercepted — they type normally", async () => {
    const h = await mountComposer(true);
    try {
      await h.send("H");
      expect(h.value()).toBe("H");
      expect(h.shortcuts()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("h/m/s type normally once the draft is non-empty", async () => {
    const h = await mountComposer(true);
    try {
      await h.send("help m");
      expect(h.value()).toBe("help m");
      expect(h.shortcuts()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("once a conversation exists (welcomeShortcutsEnabled=false), h/m/s are plain text", async () => {
    const h = await mountComposer(true);
    try {
      await h.setWelcomeEnabled(false);
      await h.send("hello my settings");
      expect(h.value()).toBe("hello my settings");
      expect(h.shortcuts()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });

  it("a disabled (busy) composer never fires a shortcut", async () => {
    const h = await mountComposer(true);
    try {
      await h.setDisabled(true);
      await h.send("h");
      expect(h.value()).toBe("");
      expect(h.shortcuts()).toEqual([]);
    } finally {
      h.cleanup();
    }
  });
});
