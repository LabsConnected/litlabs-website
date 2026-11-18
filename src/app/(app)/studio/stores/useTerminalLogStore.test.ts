import { beforeEach, describe, expect, it } from "vitest";
import {
  parseTerminalLogEntry,
  useTerminalLogStore,
} from "./useTerminalLogStore";

/**
 * Terminal log store (Kimi wiring items 9 + 12): the drawer's Logs tab
 * and the phone peek strip read the same captured onLog entries. The
 * parser must classify the TerminalPanel's bracket prefixes honestly —
 * an unprefixed line is "info", never dressed up as a session event.
 */
describe("parseTerminalLogEntry", () => {
  it("classifies each bracket prefix and strips it", () => {
    expect(parseTerminalLogEntry("[WS] Connected", "10:00:00")).toMatchObject({
      kind: "ws",
      text: "Connected",
      time: "10:00:00",
    });
    expect(parseTerminalLogEntry("[SESSION] PTY started", "10:00:01").kind).toBe("session");
    expect(parseTerminalLogEntry("[ERROR] token failed", "10:00:02").kind).toBe("error");
    expect(parseTerminalLogEntry("[AUTH] signed in", "10:00:03").kind).toBe("auth");
    expect(parseTerminalLogEntry("[WORKSPACE] ready", "10:00:04").kind).toBe("workspace");
  });

  it("treats unprefixed lines as info and keeps the text whole", () => {
    const entry = parseTerminalLogEntry("plain output line", "10:00:05");
    expect(entry.kind).toBe("info");
    expect(entry.text).toBe("plain output line");
  });
});

describe("useTerminalLogStore", () => {
  beforeEach(() => {
    useTerminalLogStore.getState().clear();
  });

  it("appends entries in order with stamped times", () => {
    useTerminalLogStore.getState().append("[SESSION] started");
    useTerminalLogStore.getState().append("[WS] pong");
    const entries = useTerminalLogStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("session");
    expect(entries[1].kind).toBe("ws");
    expect(entries[0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("caps the log at 200 entries, dropping the oldest", () => {
    for (let i = 0; i < 205; i += 1) {
      useTerminalLogStore.getState().append(`[WS] line ${i}`);
    }
    const entries = useTerminalLogStore.getState().entries;
    expect(entries).toHaveLength(200);
    expect(entries[0].text).toBe("line 5");
    expect(entries[199].text).toBe("line 204");
  });
});
