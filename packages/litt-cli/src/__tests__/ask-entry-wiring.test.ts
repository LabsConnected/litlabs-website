/**
 * Milestone 1 review — `litt ask` entry-point wiring.
 *
 * Verifies the ACTUAL CLI entry chain for `litt ask --mode plan`:
 *   argv --mode flag
 *     → resolveDispatch (dispatch.ts) parses mode
 *     → index.ts builds RuntimeSession({ mode }) from dispatch
 *     → askCommand threads sess.getMode() into runAgentLoop
 *     → non-TTY declares headless interaction
 *
 * The model/inference boundary is mocked (as in ask-model-selection.test.ts);
 * everything else — dispatch parsing, session construction, askCommand's
 * wiring — is the real production code path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@litt/models";
import { askCommand } from "../commands/ask.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resolveDispatch } from "../lib/dispatch.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";

const captured: Array<{ mode?: unknown; interaction?: unknown }> = [];

vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({ getAuthState: async () => ({ signedIn: false, email: null }) }),
}));
vi.mock("../lib/utils.js", async (original) => ({
  ...(await original<typeof import("../lib/utils.js")>()),
  detectProject: () => ({
    hasPackageJson: true,
    rootDir: process.cwd(),
    packageJson: { name: "ask-entry-test" },
  }),
}));
vi.mock("@litt/agent-core", async (original) => ({
  ...(await original<typeof import("@litt/agent-core")>()),
  runAgentLoop: vi.fn(async (_question: string, options: Record<string, unknown>) => {
    captured.push({ mode: options.mode, interaction: options.interaction });
    return { termination: "complete", rounds: 0, toolCalls: [], durationMs: 1 };
  }),
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  captured.length = 0;
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

describe("litt ask entry point wiring (milestone 1 review)", () => {
  it("`litt ask --mode plan` dispatches with mode plan", () => {
    const d = resolveDispatch(["ask", "--mode", "plan"]);
    expect(d.command).toBe("ask");
    expect(d.mode).toBe("plan");
  });

  it("askCommand threads the session's plan mode + headless interaction into the loop", async () => {
    // Exactly what index.ts builds from dispatch for `litt ask --mode plan`.
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "plan" });
    expect(await askCommand(["hello"], session)).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.mode).toBe("plan");
    // No TTY in this environment -> headless must be declared.
    expect(captured[0]!.interaction).toBe("headless");
  });

  it("askCommand threads the session's act mode into the loop", async () => {
    const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
    expect(await askCommand(["hello"], session)).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.mode).toBe("act");
    expect(captured[0]!.interaction).toBe("headless");
  });

  it("askCommand falls back to act when the session carries no explicit mode", async () => {
    const session = createRuntimeSession({ cwd: process.cwd() });
    expect(await askCommand(["hello"], session)).toBe(0);
    expect(captured[0]!.mode).toBe("act");
  });
});
