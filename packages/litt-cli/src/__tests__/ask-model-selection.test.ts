import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@litt/models";
import { runAgentLoop } from "@litt/agent-core";
import { askCommand, isExactAnswerPrompt } from "../commands/ask.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";
import type { RuntimeSession } from "../lib/runtime-session.js";

vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({ getAuthState: async () => ({ signedIn: false, email: null }) }),
}));
vi.mock("../lib/utils.js", async (original) => ({
  ...await original<typeof import("../lib/utils.js")>(),
  detectProject: () => ({ hasPackageJson: true, rootDir: process.cwd(), packageJson: { name: "ask-test" } }),
}));
vi.mock("@litt/agent-core", async (original) => ({
  ...await original<typeof import("@litt/agent-core")>(),
  runAgentLoop: vi.fn(async (question, options) => {
    await options.model.stream([{ role: "user", content: question }], () => {});
    return { termination: "complete", rounds: 1, toolCalls: [], durationMs: 1 };
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;
const session = { installSigintHandler: () => {}, getMode: () => "act" as const } as unknown as RuntimeSession;

beforeEach(() => {
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
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/tags")) {
      return Response.json({ models: [{ name: "qwen3:4b" }, { name: "qwen3:4b-instruct" }] });
    }
    if (url.endsWith("/api/show")) {
      return Response.json({ capabilities: ["completion", "tools"] });
    }
    if (url.endsWith("/v1/chat/completions")) {
      const { model } = JSON.parse(init!.body as string);
      return new Response(`data: ${JSON.stringify({ model, choices: [{ delta: { content: "OK" } }] })}\n\ndata: [DONE]\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      });
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

describe("litt ask explicit model selection", () => {
  it("sends the exact installed model through the real runtime and streaming adapter", async () => {
    expect(await askCommand(["Say OK"], session)).toBe(0);
    const chat = fetchMock.mock.calls.find(([url]) => url.endsWith("/v1/chat/completions"));
    expect(chat?.[0]).toBe("http://127.0.0.1:11434/v1/chat/completions");
    expect(JSON.parse(chat![1]!.body as string).model).toBe("qwen3:4b-instruct");
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Served by: Ollama | Model: qwen3:4b-instruct"));
  });

  it("fails without sending another model when the selected model is missing", async () => {
    vi.stubEnv("LITT_MODEL", "missing:model");
    expect(await askCommand(["Say OK"], session)).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/v1/chat/completions"))).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("missing:model"));
  });
});

describe("litt ask exact-answer tool boundary", () => {
  it("recognizes only literal echo-style asks", () => {
    expect(isExactAnswerPrompt("Reply with exactly: OK")).toBe(true);
    expect(isExactAnswerPrompt("Say with exactly \"LiTT local model works\"")).toBe(true);
    expect(isExactAnswerPrompt("Reply with exactly: OK, then run project.check")).toBe(false);
    expect(isExactAnswerPrompt("Reply with exactly: the project status")).toBe(false);
    expect(isExactAnswerPrompt("Inspect the project and reply with exactly one sentence")).toBe(false);
  });

  it("gives literal echo asks an empty tool surface", async () => {
    expect(await askCommand(["Reply", "with", "exactly:", "OK"], session)).toBe(0);
    const options = vi.mocked(runAgentLoop).mock.calls.at(-1)?.[1];
    expect(options?.tools.list()).toHaveLength(0);
  });

  it("keeps the authorized tool surface for ordinary coding asks", async () => {
    expect(await askCommand(["Inspect", "the", "project", "status"], session)).toBe(0);
    const options = vi.mocked(runAgentLoop).mock.calls.at(-1)?.[1];
    expect(options?.tools.list().length).toBeGreaterThan(0);
    expect(options?.tools.get("project.check")).toBeTruthy();
  });
});
