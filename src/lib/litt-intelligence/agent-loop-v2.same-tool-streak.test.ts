// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

/**
 * Coordination fix (b) — the same-tool-different-arguments loop
 * breaker. The identical-call circuit breaker (detectRepeatedCalls)
 * keys on identical inputs, so it could never see the acceptance
 * trace's loop: image.stock called 4 times post-approval with
 * DIFFERENT queries, every call successful, zero project files
 * written — only the build guard's zero-write step count stopped
 * that run, and non-build runs carry no such guard.
 *
 * The breaker now also counts a trailing streak of consecutive
 * successful calls to the same NON-WRITING tool (the zero-write
 * guard's own progress definition: a successful file-writing call
 * is the mutation that resets). Bound: 3 proven successes are a
 * working set; the 4th consecutive call earns the bounded
 * corrective nudge (shared budget with the read-loop path), and
 * the run cancels honestly once the nudge budget is spent.
 *
 * Scope (pinned by the pre-existing suites this breaker must not
 * regress): the streak is consulted only for tools that are NOT
 * read-only — read-only tools belong to the identical-call breaker,
 * whose per-input design deliberately allows varied research (the
 * rotating-signatures read test) — and only in runs WITHOUT the
 * build capability guard, whose model-switching response to
 * write-less chains must not be pre-empted (the R2 guard tests).
 * What remains is exactly the uncovered class: a non-read-only,
 * non-file-writing tool (image.stock, image.generate) succeeding
 * repeatedly with varying inputs in an unguarded run.
 */

vi.mock("./llm-tool-calling", async (original) => ({
  ...(await (original() as Promise<Record<string, unknown>>)),
  callLLMWithTools: vi.fn(),
}));
vi.mock("@/lib/metering", () => ({
  emitUsageEvent: vi.fn(async () => ({})),
  getMeteringContext: vi.fn(() => null),
  runWithMeteringContext: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/action-runtime/tool-runtime", async (original) => ({
  ...(await original() as Record<string, unknown>),
  recordActionToolStarted: vi.fn(async () => ({})),
  recordActionToolCompleted: vi.fn(async () => ({})),
  recordActionToolFailed: vi.fn(async () => ({})),
  markActionToolRunPersistenceDegraded: vi.fn(async () => undefined),
}));

import { callLLMWithTools } from "./llm-tool-calling";
import {
  countSameToolNonWritingStreak,
  runAgentLoopV2,
  SAME_TOOL_STREAK_LIMIT,
  type AgentLoopConfig,
} from "./agent-loop-v2";
import { toolRegistry } from "./tool-registry";
import type { WorkspaceTransport } from "./workspace-transport";

type Records = Parameters<typeof countSameToolNonWritingStreak>[0];
function rec(toolId: string, success?: boolean): Records[number] {
  return { toolId, inputsHash: "h", resultHash: "r", step: 1, success, mutating: true } as Records[number];
}

describe("countSameToolNonWritingStreak (coordination fix b)", () => {
  it("counts the image.stock-shaped streak: same tool, all success, varying inputs", () => {
    // image.stock records carry mutating:true in the ledger (the
    // tool is workspace-write by permission), but it is not a
    // file-writing tool — the guard's taxonomy, not the ledger flag,
    // defines progress.
    const records = [rec("image.stock", true), rec("image.stock", true), rec("image.stock", true), rec("image.stock", true)];
    expect(countSameToolNonWritingStreak(records, "image.stock")).toBe(4);
    expect(countSameToolNonWritingStreak(records.slice(0, 3), "image.stock")).toBe(SAME_TOOL_STREAK_LIMIT);
  });

  it("a file-writing tool's streak is 0 by definition, and a landed write resets the streak", () => {
    expect(countSameToolNonWritingStreak([rec("files.write", true), rec("files.write", true)], "files.write")).toBe(0);
    const records = [
      rec("image.stock", true),
      rec("image.stock", true),
      rec("files.write", true),
      rec("image.stock", true),
      rec("image.stock", true),
    ];
    expect(countSameToolNonWritingStreak(records, "image.stock")).toBe(2);
  });

  it("a different tool, a failure, or an unknown outcome ends the streak", () => {
    expect(
      countSameToolNonWritingStreak(
        [rec("image.stock", true), rec("files.read", true), rec("image.stock", true)],
        "image.stock",
      ),
    ).toBe(1);
    expect(
      countSameToolNonWritingStreak(
        [rec("image.stock", true), rec("image.stock", false), rec("image.stock", true)],
        "image.stock",
      ),
    ).toBe(1);
    expect(
      countSameToolNonWritingStreak(
        [rec("image.stock", true), rec("image.stock", undefined), rec("image.stock", true)],
        "image.stock",
      ),
    ).toBe(1);
    expect(countSameToolNonWritingStreak([], "image.stock")).toBe(0);
  });
});

// ─── Loop-level fixtures ────────────────────────────────────────────

function makeTransport() {
  const files = new Map<string, string>();
  const transport = {
    workspaceId: "ws-1",
    projectId: "project-1",
    userId: "owner",
    workspaceRoot: "/workspace",
    listFiles: vi.fn(async () => ({
      entries: [...files.keys()].map((name) => ({ name, type: "file" as const })),
    })),
    readFile: vi.fn(async (path: string) => {
      const content = files.get(path);
      if (content === undefined) throw new Error("not found");
      return { content, size: content.length };
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
      return { saved: true };
    }),
    createCheckpointBeforeMutation: vi.fn(async () => null),
    exec: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 })),
    gitStatus: vi.fn(async () => ({
      branch: "main", ahead: 0, behind: 0,
      staged: [], modified: [], untracked: [], clean: true,
    })),
    gitDiff: vi.fn(async () => ({ diff: "" })),
  } as unknown as WorkspaceTransport;
  return { transport, files };
}

// A granted build scope (the acceptance trace's posture: one
// approval already covered the build's tools) and NO build
// capability guard — the run shape that had no loop protection.
const config: AgentLoopConfig = {
  maxSteps: 12,
  maxRuntimeMs: 600_000,
  maxOutputChars: 40_000,
  maxRetries: 0,
  executionMode: "act",
  systemPrompt: "test system prompt",
  enableBuildFix: false,
  userId: "owner",
  isStaticWorkspace: true,
  buildScopeApproved: true,
};

function toolReply(toolCallId: string, toolId: string, inputs: Record<string, unknown>) {
  return {
    text: "",
    model: "test-model",
    finishReason: "tool_calls",
    toolCalls: [{ toolCallId, toolId, inputs }],
  } as never;
}
const doneReply = {
  text: "Done.",
  model: "test-model",
  finishReason: "stop",
  toolCalls: [],
} as never;

describe("same-tool streak breaker — loop behavior (coordination fix b)", () => {
  let executeSpy: MockInstance<typeof toolRegistry.execute>;
  let stockExecutions = 0;

  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    stockExecutions = 0;
    const original = toolRegistry.execute.bind(toolRegistry);
    executeSpy = vi.spyOn(toolRegistry, "execute").mockImplementation((async (
      toolId: string,
      inputs: Record<string, unknown>,
      ctx: unknown,
    ) => {
      if (toolId === "image.stock") {
        stockExecutions += 1;
        return {
          ok: true,
          result: {
            success: true,
            sitePath: `assets/images/stock-${stockExecutions}.jpg`,
            savedToProject: true,
          },
        };
      }
      return original(toolId, inputs, ctx as never);
    }) as typeof toolRegistry.execute);
  });

  afterEach(() => {
    executeSpy.mockRestore();
  });

  it("an image.stock varying-args streak is nudged at the bound, then the run recovers by writing", async () => {
    const { transport, files } = makeTransport();
    // Three successful stock fetches with DIFFERENT queries (the
    // identical-call detector can never fire), then a fourth — the
    // streak breaker must answer it with the nudge, not execute it.
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("tc-1", "image.stock", { projectId: "project-1", query: "bakery interior" }))
      .mockResolvedValueOnce(toolReply("tc-2", "image.stock", { projectId: "project-1", query: "sourdough loaf" }))
      .mockResolvedValueOnce(toolReply("tc-3", "image.stock", { projectId: "project-1", query: "croissant closeup" }))
      .mockResolvedValueOnce(toolReply("tc-4", "image.stock", { projectId: "project-1", query: "bakery counter" }))
      .mockResolvedValueOnce(toolReply("tc-5", "files.write", {
        projectId: "project-1",
        path: "index.html",
        content: "<!doctype html><html><body><h1>Sunny Crust</h1></body></html>",
      }))
      .mockResolvedValue(doneReply);

    const result = await runAgentLoopV2("Build the bakery page with photos", transport, config);

    // The 4th fetch never executed — the breaker intervened.
    expect(stockExecutions).toBe(3);
    const statusTexts = result.events.filter((e) => e.type === "status").map((e) => ("summary" in e ? e.summary : ""));
    expect(statusTexts.some((s) => s.includes("instead of fetching more"))).toBe(true);
    // …and the run recovered: the write landed and the run completed.
    expect(files.has("index.html")).toBe(true);
    expect(result.cancelled).toBe(false);
  }, 30_000);

  it("a mutating varied-tool run never trips the breaker", async () => {
    const { transport, files } = makeTransport();
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce(toolReply("tc-1", "files.write", { projectId: "project-1", path: "p1.html", content: "<html>1</html>" }))
      .mockResolvedValueOnce(toolReply("tc-2", "files.write", { projectId: "project-1", path: "p2.html", content: "<html>2</html>" }))
      .mockResolvedValueOnce(toolReply("tc-3", "files.write", { projectId: "project-1", path: "p3.html", content: "<html>3</html>" }))
      .mockResolvedValueOnce(toolReply("tc-4", "files.write", { projectId: "project-1", path: "p4.html", content: "<html>4</html>" }))
      .mockResolvedValue(doneReply);

    const result = await runAgentLoopV2("Write four pages", transport, config);

    expect(["p1.html", "p2.html", "p3.html", "p4.html"].every((p) => files.has(p))).toBe(true);
    const statusTexts = result.events.filter((e) => e.type === "status").map((e) => ("summary" in e ? e.summary : ""));
    expect(statusTexts.some((s) => s.includes("instead of fetching more"))).toBe(false);
    expect(result.cancelled).toBe(false);
  }, 30_000);

  it("a model that ignores the nudges is cancelled honestly with the streak reason", async () => {
    const { transport } = makeTransport();
    const queries = ["bakery interior", "sourdough loaf", "croissant closeup", "bakery counter", "pastry case", "bread shelves", "cafe seating"];
    for (let i = 0; i < queries.length; i++) {
      vi.mocked(callLLMWithTools).mockResolvedValueOnce(
        toolReply(`tc-${i + 1}`, "image.stock", { projectId: "project-1", query: queries[i] }),
      );
    }
    vi.mocked(callLLMWithTools).mockResolvedValue(doneReply);

    const result = await runAgentLoopV2("Keep fetching photos", transport, config);

    // 3 executions + 2 nudges; the next attempt cancels the run.
    expect(stockExecutions).toBe(3);
    expect(result.cancelled).toBe(true);
    expect(result.cancelReason).toContain("different inputs");
    expect(result.cancelReason).toContain("no intervening file write");
  }, 30_000);
});
