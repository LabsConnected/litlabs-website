/**
 * Regression suite: LiTT must never leave the parent shell in a modified
 * terminal state.
 *
 * The bug this locks down: after leaving LiTT, PowerShell echoed mouse
 * escape sequences (`[<35;9;1M`) and behaved as if still in raw mode.
 * Terminal modes are process-external — once set they persist in the
 * parent shell until something clears them.
 *
 * These tests prove the disable sequences are emitted and stdin raw mode
 * is restored on BOTH a normal exit and an interrupted/cancelled exit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MOUSE_DISABLE_SEQUENCES,
  BRACKETED_PASTE_DISABLE,
  SHOW_CURSOR,
  EXIT_ALTERNATE_SCREEN,
  KITTY_PROTOCOL_POP,
  RESET_ATTRIBUTES,
  TEARDOWN_SIGNALS,
  buildRestoreSequence,
  restoreTerminal,
  installTerminalTeardown,
  markAlternateScreenEntered,
  markKittyProtocolPushed,
  getRestoreCount,
  resetTerminalTeardownStateForTests,
  signalExitCode,
  type TerminalStreams,
  type TeardownProcess,
} from "../lib/terminal-teardown.js";

// ── Test doubles ─────────────────────────────────────────────────────

interface FakeStreams extends TerminalStreams {
  written: string[];
  rawModeCalls: boolean[];
  all(): string;
}

function makeStreams(opts: {
  stdoutTTY?: boolean;
  stdinTTY?: boolean;
  writeThrows?: boolean;
  rawModeThrows?: boolean;
} = {}): FakeStreams {
  const written: string[] = [];
  const rawModeCalls: boolean[] = [];
  return {
    written,
    rawModeCalls,
    all: () => written.join(""),
    stdout: {
      isTTY: opts.stdoutTTY ?? true,
      write(chunk: string) {
        if (opts.writeThrows) throw new Error("EPIPE");
        written.push(chunk);
        return true;
      },
    },
    stdin: {
      isTTY: opts.stdinTTY ?? true,
      setRawMode(mode: boolean) {
        if (opts.rawModeThrows) throw new Error("ENOTTY");
        rawModeCalls.push(mode);
        return true;
      },
    },
  };
}

interface FakeProcess extends TeardownProcess {
  listeners: Map<string, Array<(...args: never[]) => void>>;
  exitCodes: number[];
  emit(event: string, ...args: unknown[]): void;
  listenerCount(event: string): number;
}

function makeProcess(): FakeProcess {
  const listeners = new Map<string, Array<(...args: never[]) => void>>();
  const exitCodes: number[] = [];
  return {
    listeners,
    exitCodes,
    on(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return this;
    },
    off(event, listener) {
      const list = listeners.get(event) ?? [];
      const i = list.indexOf(listener);
      if (i >= 0) list.splice(i, 1);
      listeners.set(event, list);
      return this;
    },
    exit(code?: number) {
      exitCodes.push(code ?? 0);
      return undefined;
    },
    emit(event, ...args) {
      for (const l of [...(listeners.get(event) ?? [])]) {
        (l as (...a: unknown[]) => void)(...args);
      }
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
  };
}

/** Every sequence that must be present after ANY LiTT shutdown. */
function expectTerminalHandedBackClean(payload: string): void {
  for (const seq of MOUSE_DISABLE_SEQUENCES) {
    expect(payload).toContain(seq);
  }
  expect(payload).toContain(BRACKETED_PASTE_DISABLE);
  expect(payload).toContain(SHOW_CURSOR);
}

beforeEach(() => {
  resetTerminalTeardownStateForTests();
});

// ─────────────────────────────────────────────────────────────────────

describe("buildRestoreSequence", () => {
  it("disables every mouse reporting mode the terminal can be left in", () => {
    const payload = buildRestoreSequence();
    // The exact modes named in the bug report.
    expect(payload).toContain("\x1b[?1000l");
    expect(payload).toContain("\x1b[?1002l");
    expect(payload).toContain("\x1b[?1003l");
    expect(payload).toContain("\x1b[?1005l");
    expect(payload).toContain("\x1b[?1006l");
    expect(payload).toContain("\x1b[?1015l");
  });

  it("disables bracketed paste and shows the cursor", () => {
    const payload = buildRestoreSequence();
    expect(payload).toContain(BRACKETED_PASTE_DISABLE);
    expect(payload).toContain(SHOW_CURSOR);
    expect(payload.endsWith(RESET_ATTRIBUTES)).toBe(true);
  });

  it("clears mouse modes BEFORE showing the cursor", () => {
    const payload = buildRestoreSequence();
    expect(payload.indexOf("\x1b[?1003l")).toBeLessThan(payload.indexOf(SHOW_CURSOR));
  });

  it("omits alternate-screen exit unless LiTT entered it", () => {
    expect(buildRestoreSequence()).not.toContain(EXIT_ALTERNATE_SCREEN);
    markAlternateScreenEntered();
    expect(buildRestoreSequence()).toContain(EXIT_ALTERNATE_SCREEN);
  });

  it("omits the kitty protocol pop unless LiTT pushed flags", () => {
    // Popping unconditionally would clobber a push made by the parent
    // program, since the kitty flags are a stack.
    expect(buildRestoreSequence()).not.toContain(KITTY_PROTOCOL_POP);
    markKittyProtocolPushed();
    expect(buildRestoreSequence()).toContain(KITTY_PROTOCOL_POP);
  });

  it("honours explicit overrides over recorded state", () => {
    markAlternateScreenEntered();
    expect(buildRestoreSequence({ alternateScreen: false })).not.toContain(
      EXIT_ALTERNATE_SCREEN,
    );
  });
});

describe("restoreTerminal", () => {
  it("emits the full disable payload and drops raw mode", () => {
    const streams = makeStreams();
    expect(restoreTerminal({}, streams)).toBe(true);
    expectTerminalHandedBackClean(streams.all());
    expect(streams.rawModeCalls).toEqual([false]);
  });

  it("is idempotent — running it twice is harmless and still restores", () => {
    const streams = makeStreams();
    restoreTerminal({}, streams);
    restoreTerminal({}, streams);
    expect(getRestoreCount()).toBe(2);
    expect(streams.rawModeCalls).toEqual([false, false]);
    // Both writes are complete restores; neither is a partial payload.
    expect(streams.written).toHaveLength(2);
    for (const payload of streams.written) expectTerminalHandedBackClean(payload);
  });

  it("writes nothing when stdout is not a TTY", () => {
    const streams = makeStreams({ stdoutTTY: false });
    expect(restoreTerminal({}, streams)).toBe(false);
    expect(streams.written).toHaveLength(0);
  });

  it("skips setRawMode when stdin is not a TTY", () => {
    const streams = makeStreams({ stdinTTY: false });
    restoreTerminal({}, streams);
    expect(streams.rawModeCalls).toHaveLength(0);
  });

  it("never throws when the stream is already closed", () => {
    const streams = makeStreams({ writeThrows: true, rawModeThrows: true });
    expect(() => restoreTerminal({}, streams)).not.toThrow();
    expect(restoreTerminal({}, streams)).toBe(false);
  });

  it("restores raw mode even when the stdout write fails", () => {
    const streams = makeStreams({ writeThrows: true });
    restoreTerminal({}, streams);
    expect(streams.rawModeCalls).toEqual([false]);
  });
});

describe("installTerminalTeardown — every exit path", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("restores on normal exit", () => {
    const streams = makeStreams();
    const proc = makeProcess();
    installTerminalTeardown({ streams, proc });

    proc.emit("exit", 0);

    expectTerminalHandedBackClean(streams.all());
    expect(streams.rawModeCalls).toEqual([false]);
  });

  it("restores on an interrupted exit (process.exit from the SIGINT path)", () => {
    // RuntimeSession's Ctrl+C handler calls process.exit(130), which skips
    // React/Ink effect cleanup. Node still emits 'exit'.
    const streams = makeStreams();
    const proc = makeProcess();
    installTerminalTeardown({ streams, proc });

    proc.emit("exit", 130);

    expectTerminalHandedBackClean(streams.all());
    expect(streams.rawModeCalls).toEqual([false]);
  });

  it.each(TEARDOWN_SIGNALS)("restores on %s and exits 128+n", (signal) => {
    const streams = makeStreams();
    const proc = makeProcess();
    installTerminalTeardown({ streams, proc });

    proc.emit(signal);

    expectTerminalHandedBackClean(streams.all());
    expect(proc.exitCodes).toEqual([signalExitCode(signal)]);
  });

  it("restores before printing an uncaught exception", () => {
    const streams = makeStreams();
    const proc = makeProcess();
    const order: string[] = [];
    errorSpy.mockImplementation(() => {
      order.push("printed");
    });
    const originalWrite = streams.stdout.write.bind(streams.stdout);
    streams.stdout.write = (chunk: string) => {
      order.push("restored");
      return originalWrite(chunk);
    };

    installTerminalTeardown({ streams, proc });
    proc.emit("uncaughtException", new Error("boom"));

    expectTerminalHandedBackClean(streams.all());
    // A stack printed into a raw-mode terminal is unreadable — reset first.
    expect(order).toEqual(["restored", "printed"]);
    expect(proc.exitCodes).toEqual([1]);
  });

  it("restores on an unhandled rejection", () => {
    const streams = makeStreams();
    const proc = makeProcess();
    installTerminalTeardown({ streams, proc });

    proc.emit("unhandledRejection", new Error("nope"));

    expectTerminalHandedBackClean(streams.all());
    expect(proc.exitCodes).toEqual([1]);
  });

  it("does not register a SIGINT listener — RuntimeSession owns Ctrl+C", () => {
    // RuntimeSession calls process.removeAllListeners('SIGINT') and treats
    // Ctrl+C as "cancel the running agent", not "exit". A teardown listener
    // here would either be wiped or would kill an in-flight cancellation.
    const proc = makeProcess();
    installTerminalTeardown({ streams: makeStreams(), proc });
    expect(proc.listenerCount("SIGINT")).toBe(0);
  });

  it("the disposer removes every listener it added", () => {
    const proc = makeProcess();
    const dispose = installTerminalTeardown({ streams: makeStreams(), proc });

    const events = ["exit", "uncaughtException", "unhandledRejection", ...TEARDOWN_SIGNALS];
    for (const e of events) expect(proc.listenerCount(e)).toBe(1);

    dispose();
    for (const e of events) expect(proc.listenerCount(e)).toBe(0);
  });

  it("teardown running twice (finally block + exit event) is harmless", () => {
    const streams = makeStreams();
    const proc = makeProcess();
    installTerminalTeardown({ streams, proc });

    restoreTerminal({}, streams); // the explicit finally-block call
    proc.emit("exit", 0); // and then Node's exit event

    expect(streams.written).toHaveLength(2);
    for (const payload of streams.written) expectTerminalHandedBackClean(payload);
  });
});

describe("RuntimeSession SIGINT wiring — interrupted exit", () => {
  it("hands the terminal back before process.exit(130) on idle Ctrl+C", async () => {
    const { createRuntimeSession } = await import("../lib/runtime-session.js");

    const writes: string[] = [];
    const rawModeCalls: boolean[] = [];
    const stdout = process.stdout as unknown as { isTTY?: boolean };
    const stdin = process.stdin as unknown as { isTTY?: boolean };
    const originalStdoutTTY = stdout.isTTY;
    const originalStdinTTY = stdin.isTTY;
    stdout.isTTY = true;
    stdin.isTTY = true;

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(((chunk: string) => {
        writes.push(String(chunk));
        return true;
      }) as typeof process.stdout.write);
    // Vitest's node environment gives a non-TTY stdin with no setRawMode.
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const hadSetRawMode = "setRawMode" in stdinAny;
    const originalSetRawMode = stdinAny["setRawMode"];
    stdinAny["setRawMode"] = (mode: boolean) => {
      rawModeCalls.push(mode);
      return process.stdin;
    };
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as typeof process.stderr.write);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`exit:${code}`);
      }) as never);

    const previousSigint = process.listeners("SIGINT");

    try {
      const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
      session.installSigintHandler();

      // No run in flight -> the handler exits, bypassing Ink's unmount.
      expect(() => {
        for (const l of process.listeners("SIGINT")) {
          (l as () => void)();
        }
      }).toThrow("exit:130");

      const payload = writes.join("");
      expectTerminalHandedBackClean(payload);
      expect(rawModeCalls).toContain(false);
    } finally {
      writeSpy.mockRestore();
      if (hadSetRawMode) {
        stdinAny["setRawMode"] = originalSetRawMode;
      } else {
        delete stdinAny["setRawMode"];
      }
      stderrSpy.mockRestore();
      exitSpy.mockRestore();
      stdout.isTTY = originalStdoutTTY;
      stdin.isTTY = originalStdinTTY;
      process.removeAllListeners("SIGINT");
      for (const l of previousSigint) process.on("SIGINT", l);
    }
  });
});
