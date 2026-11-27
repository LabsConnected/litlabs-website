/**
 * `litt ask --json` — structured output mode.
 *
 * Contract under test:
 *   - `--json` is stripped from the question before it reaches the loop.
 *   - Exactly one JSON document is written to stdout.
 *   - All human diagnostics (console.log, stream writers, emitter output)
 *     are suppressed so stdout stays machine-parseable.
 *   - Failure paths emit a structured error envelope, never a bare throw.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@litt/models";
import { askCommand } from "../commands/ask.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";

const capturedQuestions: string[] = [];

vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({ getAuthState: async () => ({ signedIn: false, email: null }) }),
}));
vi.mock("../lib/utils.js", async (original) => ({
  ...(await original<typeof import("../lib/utils.js")>()),
  detectProject: () => ({
    hasPackageJson: true,
    rootDir: process.cwd(),
    packageJson: { name: "ask-json-test" },
  }),
}));
vi.mock("@litt/agent-core", async (original) => ({
  ...(await original<typeof import("@litt/agent-core")>()),
  runAgentLoop: vi.fn(async (question: string) => {
    capturedQuestions.push(question);
    return {
      termination: "complete",
      content: "final answer",
      rounds: 2,
      toolCalls: [
        {
          toolCallId: "tc1",
          toolId: "files.read",
          toolName: "files.read",
          inputs: {},
          result: { status: "success", success: true, message: "read ok" },
          durationMs: 5,
        },
      ],
      durationMs: 42,
      usage: { total_tokens: 123 },
    };
  }),
}));

let stdoutWrite: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

function stdoutJson(): Record<string, unknown> {
  const calls = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
  return JSON.parse(calls.trim()) as Record<string, unknown>;
}

beforeEach(() => {
  capturedQuestions.length = 0;
  for (const provider of PROVIDERS) {
    if (provider.envKey) vi.stubEnv(provider.envKey, "");
  }
  vi.stubEnv("LITT_CLERK_TOKEN", "");
  vi.stubEnv("LITT_MODEL", "qwen3:4b-instruct");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("LITT_OLLAMA_URL", "http://127.0.0.1:11434");
  resetLocalLaneCache();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/api/tags")) {
      return Response.json({ models: [{ name: "qwen3:4b-instruct" }] });
    }
    if (url.endsWith("/api/show")) {
      return Response.json({ capabilities: ["completion", "tools"] });
    }
    return new Response("Unavailable", { status: 503 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetLocalLaneCache();
});

describe("litt ask --json", () => {
  it("emits one JSON document and strips the flag from the question", async () => {
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
    const code = await askCommand(["--json", "hello", "world"], session);
    expect(code).toBe(0);
    expect(capturedQuestions).toEqual(["hello world"]);

    const doc = stdoutJson();
    expect(doc.ok).toBe(true);
    expect(doc.termination).toBe("complete");
    expect(doc.content).toBe("final answer");
    expect(doc.rounds).toBe(2);
    expect(doc.usage).toEqual({ total_tokens: 123 });
    const toolCalls = doc.toolCalls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({ toolId: "files.read", status: "success", success: true });
    expect((doc.model as Record<string, unknown>).provider).toBeTruthy();
  });

  it("suppresses all human diagnostics in json mode", async () => {
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
    await askCommand(["--json", "hi"], session);
    // console.log is the human channel — nothing may reach it.
    expect(vi.mocked(console.log)).not.toHaveBeenCalled();
    // stdout carries exactly one line — the JSON document.
    const writes = stdoutWrite.mock.calls.map((c) => String(c[0])).join("");
    expect(writes.trim().split("\n")).toHaveLength(1);
    expect(() => JSON.parse(writes)).not.toThrow();
  });

  it("emits a structured error when the question is missing", async () => {
    const code = await askCommand(["--json"], createRuntimeSession({ cwd: process.cwd() }));
    expect(code).toBe(1);
    const doc = stdoutJson();
    expect(doc.ok).toBe(false);
    expect(doc.termination).toBe("error");
    expect(typeof doc.error).toBe("string");
  });

  it("keeps human output when --json is absent", async () => {
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
    const code = await askCommand(["hello"], session);
    expect(code).toBe(0);
    expect(capturedQuestions).toEqual(["hello"]);
    // Human mode still prints via console.log — stdout.write is only used
    // for raw stream passthrough, so the summary lands on console.log.
    expect(vi.mocked(console.log)).toHaveBeenCalled();
  });
});
