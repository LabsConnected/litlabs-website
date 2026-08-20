/**
 * SessionStore tests — persisted shell sessions (/resume, /new).
 * Uses LITT_SESSIONS_FILE → temp file, never touches ~/.litt.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  saveSession, listSessions, loadSession, deleteSession,
  summarize, timeAgo, newSessionId, type SessionSnapshot,
} from "../lib/session-store.js";

let tempFile: string;
let tempDir: string;

const base = {
  project: "litt-cli",
  cwd: "C:\\repos\\litt-cli",
  branch: "main",
  mode: "act" as const,
  routingMode: "auto",
  selectedModel: null,
  summary: "Fix the git-status verification",
};

function messages(n: number): { role: "user" | "assistant"; content: string; status: string; ts: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    content: `message ${i}`,
    status: "complete",
    ts: 1000 + i,
  }));
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "litt-sessions-"));
  tempFile = join(tempDir, "sessions.json");
  process.env.LITT_SESSIONS_FILE = tempFile;
});

afterEach(() => {
  delete process.env.LITT_SESSIONS_FILE;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("session-store", () => {
  it("saves, lists, loads, and deletes a session", () => {
    const saved = saveSession({ ...base, messages: messages(3) });
    expect(saved.id).toBeTruthy();
    expect(saved.messages).toHaveLength(3);

    const listed = listSessions();
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(saved.id);

    const loaded = loadSession(saved.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.summary).toBe("Fix the git-status verification");

    deleteSession(saved.id);
    expect(listSessions()).toHaveLength(0);
    expect(loadSession(saved.id)).toBeNull();
  });

  it("updates the same conversation in place (same project + summary within 10m)", () => {
    const first = saveSession({ ...base, messages: messages(2) });
    const second = saveSession({ ...base, messages: messages(4) });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(listSessions()).toHaveLength(1);
    // Latest save wins the transcript.
    expect(loadSession(first.id)?.messages).toHaveLength(4);
  });

  it("creates a new session for a different conversation", () => {
    saveSession({ ...base, messages: messages(2) });
    const other = saveSession({
      ...base,
      summary: "A totally different task",
      messages: messages(2),
    });
    expect(other.id).not.toBe(base.summary);
    expect(listSessions()).toHaveLength(2);
  });

  it("bounds saved messages to the last 30", () => {
    const saved = saveSession({ ...base, messages: messages(50) });
    expect(saved.messages).toHaveLength(30);
    expect(saved.messages[0].content).toBe("message 20");
  });

  it("truncates oversized message bodies", () => {
    const huge = "x".repeat(10_000);
    const saved = saveSession({ ...base, messages: [{ role: "user", content: huge, status: "complete", ts: 1 }] });
    expect(saved.messages[0].content.length).toBeLessThan(7000);
    expect(saved.messages[0].content.endsWith("…[truncated]")).toBe(true);
  });

  it("prunes to the 12 most recent sessions", () => {
    for (let i = 0; i < 15; i++) {
      saveSession({ ...base, summary: `session ${i}`, messages: messages(1) });
    }
    expect(listSessions()).toHaveLength(12);
  });

  it("summarize collapses whitespace and truncates", () => {
    expect(summarize("  hello\nworld  ")).toBe("hello world");
    expect(summarize("x".repeat(200)).length).toBe(90);
    expect(summarize("")).toBe("(untitled)");
  });

  it("timeAgo produces short relative labels", () => {
    expect(timeAgo(Date.now())).toBe("now");
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe("5m");
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe("3h");
    expect(timeAgo(Date.now() - 2 * 86_400_000)).toBe("2d");
  });

  it("newSessionId is unique", () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });

  it("tolerates a missing/corrupt store file", () => {
    expect(listSessions()).toEqual([]);
    expect(loadSession("nope")).toBeNull();
    // Corrupt the file, then verify reads fall back cleanly.
    writeFileSync(tempFile, "{not json", "utf8");
    expect(listSessions()).toEqual([]);
  });
});
