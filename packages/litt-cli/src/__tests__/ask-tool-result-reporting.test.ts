/**
 * Regression tests for the `litt ask` tool-result reporting fix (4becca17,
 * "fix(cli): repair ask tool results and streaming").
 *
 * Before the fix, ask.ts's `agent_tool_result` handler printed only a
 * generic "Tool result" line — the actual success/failure message was
 * discarded. The fix threads `data.message`/`data.status` into the
 * printed line, and wires model deltas through createToolCallStreamFilter()
 * so raw `tool_call`/`tool_result` protocol never reaches stdout.
 *
 * These tests drive the REAL askCommand wiring (same production code path
 * as ask-entry-wiring.test.ts) and invoke the captured `emitter` /
 * `onModelStream` callbacks exactly as runAgentLoop would, asserting on
 * what actually lands in console.log / process.stdout.write.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@litt/models";
import { askCommand } from "../commands/ask.js";
import { createRuntimeSession } from "../lib/runtime-session.js";
import { resetLocalLaneCache } from "../lib/local-lane.js";
import type { RuntimeEvent } from "@litt/agent-core";

let capturedOptions: Record<string, unknown> | null = null;
/**
 * Deltas to feed through options.onModelStream from INSIDE the mocked
 * runAgentLoop, before it resolves — so askCommand's own post-loop
 * `toolCallFilter.flush()` runs against them, exactly as production code
 * does for a real streamed response. Feeding deltas after askCommand has
 * already returned would miss that flush and falsely report a leak.
 */
let scriptedModelDeltas: string[] = [];

vi.mock("../lib/auth/auth-session.js", () => ({
  getAuthSession: () => ({ getAuthState: async () => ({ signedIn: false, email: null }) }),
}));
vi.mock("../lib/utils.js", async (original) => ({
  ...(await original<typeof import("../lib/utils.js")>()),
  detectProject: () => ({
    hasPackageJson: true,
    rootDir: process.cwd(),
    packageJson: { name: "ask-tool-result-test" },
  }),
}));
vi.mock("@litt/agent-core", async (original) => ({
  ...(await original<typeof import("@litt/agent-core")>()),
  runAgentLoop: vi.fn(async (_question: string, options: Record<string, unknown>) => {
    capturedOptions = options;
    const onModelStream = options.onModelStream as ((event: { type: string; text: string }) => void) | undefined;
    for (const text of scriptedModelDeltas) {
      onModelStream?.({ type: "delta", text });
    }
    return { termination: "complete", rounds: 0, toolCalls: [], durationMs: 1 };
  }),
}));

let logSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

function loggedLines(): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
}

function writtenChunks(): string {
  return stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
}

beforeEach(() => {
  capturedOptions = null;
  scriptedModelDeltas = [];
  for (const provider of PROVIDERS) {
    if (provider.envKey) vi.stubEnv(provider.envKey, "");
  }
  vi.stubEnv("LITT_CLERK_TOKEN", "");
  vi.stubEnv("LITT_MODEL", "qwen3:4b-instruct");
  vi.stubEnv("OPENROUTER_MODEL", "");
  vi.stubEnv("LITT_OLLAMA_URL", "http://127.0.0.1:11434");
  resetLocalLaneCache();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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

async function runAsk(): Promise<void> {
  const session = createRuntimeSession({ cwd: process.cwd(), mode: "act" });
  expect(await askCommand(["hello"], session)).toBe(0);
  expect(capturedOptions).not.toBeNull();
}

describe("ask tool-result reporting (regression for 4becca17)", () => {
  it("a successful tool reports its actual message, not a generic line", async () => {
    await runAsk();
    const emitter = capturedOptions!.emitter as (event: RuntimeEvent) => void;

    emitter({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      data: { toolId: "project.status", success: true, message: "Working tree clean on main" },
    } as unknown as RuntimeEvent);

    const out = loggedLines();
    expect(out).toContain("project.status");
    expect(out).toContain("Working tree clean on main");
    // The old behavior collapsed every result to this literal string.
    expect(out).not.toMatch(/✓ Tool result\b/);
  });

  it("a failed tool reports its actual error message, not a generic line", async () => {
    await runAsk();
    const emitter = capturedOptions!.emitter as (event: RuntimeEvent) => void;

    emitter({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      data: {
        toolId: "project.run",
        success: false,
        message: "git push failed: non-fast-forward",
      },
    } as unknown as RuntimeEvent);

    const out = loggedLines();
    expect(out).toContain("project.run");
    expect(out).toContain("git push failed: non-fast-forward");
    expect(out).not.toMatch(/✗ Tool result\b/);
  });

  it("falls back to status when no message is present, never silently empty", async () => {
    await runAsk();
    const emitter = capturedOptions!.emitter as (event: RuntimeEvent) => void;

    emitter({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      data: { toolId: "project.list_files", success: true, status: "ok" },
    } as unknown as RuntimeEvent);

    expect(loggedLines()).toContain("ok");
  });

  it("falls back to 'No details' only when both message and status are absent", async () => {
    await runAsk();
    const emitter = capturedOptions!.emitter as (event: RuntimeEvent) => void;

    emitter({
      type: "litt_event",
      subtype: "agent_tool_result",
      ts: Date.now(),
      data: { toolId: "project.unknown_tool", success: false },
    } as unknown as RuntimeEvent);

    expect(loggedLines()).toContain("No details");
  });

  it("never leaks a fenced tool_call protocol block into stdout, even split across deltas", async () => {
    scriptedModelDeltas = [
      "Checking the branch now.\n",
      "``",
      "`tool",
      "_call\n{ \"tool\": \"project.status\", \"inputs\": {} }\n```",
      "\nThe branch is main.",
    ];
    await runAsk();

    const written = writtenChunks();
    expect(written).toContain("Checking the branch now.");
    expect(written).toContain("The branch is main.");
    expect(written).not.toContain("tool_call");
    expect(written).not.toContain('"tool"');
    expect(written).not.toContain("project.status");
  });

  it("never leaks a bare (unfenced) tool JSON object split across deltas", async () => {
    scriptedModelDeltas = ['{"tool":"', 'project.run","inputs":{}}', "\nDone."];
    await runAsk();

    const written = writtenChunks();
    expect(written).not.toContain("project.run");
    expect(written).not.toContain('"inputs"');
    expect(written).toContain("Done.");
  });
});
