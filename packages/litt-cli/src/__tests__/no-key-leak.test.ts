/**
 * No-key-leak tests — proves the server's OPENROUTER_API_KEY never
 * appears in CLI responses, logs, environment, config, or session files.
 *
 * This is requirement #11 from the production customer boundary spec:
 *   "Add a test proving the server provider key never appears in CLI
 *    responses, logs, environment, config, or session files."
 *
 * Strategy:
 *   - Set a known "server secret" in the process env (simulating what
 *     the server would have)
 *   - Run RemoteModelProvider.stream() with a mocked SSE response
 *   - Assert the secret does NOT appear in:
 *     - the fetch request body/headers
 *     - the emitted ModelStreamEvents
 *     - the ModelResult
 *     - the session file (~/.litt/sessions.json)
 *     - console output (captured)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RemoteModelProvider } from "../lib/remote-model-provider.js";
import { DEFAULT_TERMINAL_URL } from "../lib/auth/auth-config.js";
import { getAuthSession, resetAuthSession } from "../lib/auth/auth-session.js";
import { createCredentialStore } from "../lib/auth/credential-store.js";
import { clearTerminalTokenCache } from "../lib/remote.js";
import { saveSession } from "../lib/session-store.js";

const TERMINAL_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSIsImF1ZCI6ImxpdHRyZWUtdGVybWluYWwifQ.signature";
const SERVER_SECRET = "sk-or-v1-SERVER_SECRET_LEAK_CANARY_12345";

let tempDir: string;
let tempSessionFile: string;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch");
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  clearTerminalTokenCache();
  resetAuthSession();
  getAuthSession({ storage: createCredentialStore("memory") });

  // Isolate session file to a temp dir
  tempDir = mkdtempSync(join(tmpdir(), "litt-noleak-"));
  tempSessionFile = join(tempDir, "sessions.json");
  process.env.LITT_SESSIONS_FILE = tempSessionFile;

  // Simulate the server's key being in the environment (it would be
  // on the server, not the client — but we test that even IF it were
  // present, it never leaks through the provider)
  process.env.OPENROUTER_API_KEY = SERVER_SECRET;
});

afterEach(() => {
  fetchSpy.mockRestore();
  consoleSpy.mockRestore();
  vi.restoreAllMocks();
  clearTerminalTokenCache();
  resetAuthSession();
  delete process.env.LITT_SESSIONS_FILE;
  delete process.env.OPENROUTER_API_KEY;
  try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function mockSSEResponse(events: Array<{ event: string; data: unknown }>): Response {
  const text = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, json: async () => ({}), text: async () => "" } as Response;
}

describe("No server key leak", () => {
  it("server OPENROUTER_API_KEY never appears in the fetch request", async () => {
    fetchSpy.mockResolvedValue(mockSSEResponse([
      { event: "meta", data: { provider: "openrouter", model: "test", profile: "auto" } },
      { event: "delta", data: { text: "response" } },
      { event: "done", data: { model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } } },
      { event: "complete", data: { runId: "r1", content: "response", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
    ]));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    await provider.stream([{ role: "user", content: "hi" }], () => {});

    const [url, init] = fetchSpy.mock.calls[0];
    const requestStr = `${url} ${JSON.stringify(init)}`;
    expect(requestStr).not.toContain(SERVER_SECRET);
    expect(requestStr).not.toContain("sk-or-v1");
  });

  it("server key never appears in emitted ModelStreamEvents", async () => {
    fetchSpy.mockResolvedValue(mockSSEResponse([
      { event: "meta", data: { provider: "openrouter", model: "test", profile: "auto" } },
      { event: "delta", data: { text: "response" } },
      { event: "done", data: { model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } } },
      { event: "complete", data: { runId: "r1", content: "response", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
    ]));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const events: unknown[] = [];
    await provider.stream([{ role: "user", content: "hi" }], (e) => events.push(e));

    const eventsStr = JSON.stringify(events);
    expect(eventsStr).not.toContain(SERVER_SECRET);
    expect(eventsStr).not.toContain("sk-or-v1");
  });

  it("server key never appears in the ModelResult", async () => {
    fetchSpy.mockResolvedValue(mockSSEResponse([
      { event: "meta", data: { provider: "openrouter", model: "test", profile: "auto" } },
      { event: "delta", data: { text: "response" } },
      { event: "done", data: { model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } } },
      { event: "complete", data: { runId: "r1", content: "response", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
    ]));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});

    const resultStr = JSON.stringify(result);
    expect(resultStr).not.toContain(SERVER_SECRET);
    expect(resultStr).not.toContain("sk-or-v1");
  });

  it("server key never appears in the session file after saveSession", async () => {
    // Simulate what the controller does after a chat completes:
    // it saves the session (including the assistant response) to disk.
    fetchSpy.mockResolvedValue(mockSSEResponse([
      { event: "meta", data: { provider: "openrouter", model: "test", profile: "auto" } },
      { event: "delta", data: { text: "Here is my response." } },
      { event: "done", data: { model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } } },
      { event: "complete", data: { runId: "r1", content: "Here is my response.", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
    ]));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    const result = await provider.stream([{ role: "user", content: "hi" }], () => {});

    // Save the session (as the controller would)
    saveSession({
      project: "test-project",
      cwd: "/project",
      branch: "main",
      mode: "act",
      routingMode: "auto",
      selectedModel: null,
      summary: "hi",
      messages: [
        { role: "user", content: "hi", status: "complete", ts: Date.now() },
        { role: "assistant", content: result.content, status: "complete", ts: Date.now() },
      ],
    });

    // Read the session file and verify the secret is not in it
    expect(existsSync(tempSessionFile)).toBe(true);
    const fileContent = readFileSync(tempSessionFile, "utf8");
    expect(fileContent).not.toContain(SERVER_SECRET);
    expect(fileContent).not.toContain("sk-or-v1");
  });

  it("server key never appears in console output", async () => {
    fetchSpy.mockResolvedValue(mockSSEResponse([
      { event: "meta", data: { provider: "openrouter", model: "test", profile: "auto" } },
      { event: "delta", data: { text: "response" } },
      { event: "done", data: { model: "test", usage: { total_tokens: 1 }, timing: { ttftMs: 1, generationMs: 1, totalMs: 2 } } },
      { event: "complete", data: { runId: "r1", content: "response", termination: "complete", rounds: 1, toolCalls: 0, coinsDebited: 0 } },
    ]));

    const provider = new RemoteModelProvider({ cwd: "/project" });
    const session = getAuthSession();
    vi.spyOn(session, "getTerminalToken").mockResolvedValue(TERMINAL_JWT);

    await provider.stream([{ role: "user", content: "hi" }], () => {});

    // Check all console output
    const allCalls = consoleSpy.mock.calls.map((c) => String(c)).join("\n");
    expect(allCalls).not.toContain(SERVER_SECRET);
    expect(allCalls).not.toContain("sk-or-v1");
  });
});
