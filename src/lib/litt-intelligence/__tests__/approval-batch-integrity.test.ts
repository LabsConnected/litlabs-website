import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  deferredCallsAfterBatchPause,
  executeDeferredToolCalls,
  type DeferredToolBatchContext,
} from "@/lib/litt-intelligence/agent-loop-v2";
import { toolRegistry } from "@/lib/litt-intelligence/tool-registry";

function makeCtx(overrides: Partial<DeferredToolBatchContext> = {}): DeferredToolBatchContext {
  const transport = {
    createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    listFiles: vi.fn(),
    exists: vi.fn(),
    runCommand: vi.fn(),
  };
  return {
    availableTools: toolRegistry.list(),
    executionMode: "auto",
    transport: transport as never,
    llmMessages: [],
    toolCallLog: [],
    toolCallRecords: [],
    executedMutations: new Map(),
    localProgress: { emit: () => {} } as never,
    qualitySession: null,
    startTime: Date.now(),
    stepsUsed: 2,
    maxOutputChars: 100_000,
    state: {
      hasInterveningMutation: false,
      cancelled: false,
      mutationBatchPending: false,
      batchHasMutation: false,
      completedDeployment: null,
    },
    ...overrides,
  };
}

const WRITE_INPUTS = { projectId: "p1", path: "index.html", content: "<h1>x</h1>" };

describe("approval-batch: deferredCallsAfterBatchPause", () => {
  const batch = [
    { toolCallId: "c1", toolId: "files.read", inputs: {} },
    { toolCallId: "c2", toolId: "files.write", inputs: WRITE_INPUTS },
    { toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS },
  ];

  it("captures the calls after the gated call", () => {
    const deferred = deferredCallsAfterBatchPause(batch, "c2");
    expect(deferred.map((d) => d.toolCallId)).toEqual(["c3"]);
  });

  it("pausing on the last call defers nothing", () => {
    expect(deferredCallsAfterBatchPause(batch, "c3")).toEqual([]);
  });

  it("unknown paused call id defers nothing", () => {
    expect(deferredCallsAfterBatchPause(batch, "nope")).toEqual([]);
  });
});

describe("approval-batch: executeDeferredToolCalls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("re-executes deferred calls after approval (AUTO mode, safe-set tool)", async () => {
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockResolvedValue({ ok: true, result: { success: true } });
    const ctx = makeCtx({ executionMode: "auto" });

    const result = await executeDeferredToolCalls(
      [{ toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS }],
      ctx,
    );

    expect(result.nestedApproval).toBeNull();
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0]).toBe("files.write");
    expect(
      ctx.toolCallLog.some((e) => e.toolId === "files.write" && e.success),
    ).toBe(true);
  });

  it("a deferred call that needs approval pauses AGAIN with the remainder attached", async () => {
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockResolvedValue({ ok: true, result: { success: true } });
    // ACT mode: files.write requires approval — repair-style fail-closed is
    // wrong here; the batch must pause again, never truncate.
    const ctx = makeCtx({ executionMode: "act" });
    const deferred = [
      { toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS },
      { toolCallId: "c4", toolId: "files.write", inputs: WRITE_INPUTS },
    ];

    const result = await executeDeferredToolCalls(deferred, ctx);

    expect(result.nestedApproval).not.toBeNull();
    expect(result.nestedApproval!.toolId).toBe("files.write");
    // The gated call becomes the new pending approval; the REST stays attached
    expect(
      result.nestedApproval!.deferredToolCalls!.map((d) => d.toolCallId),
    ).toEqual(["c4"]);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("duplicate of an executed mutation replays the recorded result (no re-execution)", async () => {
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockResolvedValue({ ok: true, result: { success: true } });
    const ctx = makeCtx({ executionMode: "auto" });
    const deferred = [{ toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS }];

    await executeDeferredToolCalls(deferred, ctx);
    await executeDeferredToolCalls(deferred, ctx);

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(
      ctx.toolCallLog.some((e) => e.summary.includes("already executed")),
    ).toBe(true);
  });

  it("executes zero deferred tools when the resumed batch is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockResolvedValue({ ok: true, result: { success: true } });
    const ctx = makeCtx({ executionMode: "auto", signal: controller.signal });

    const result = await executeDeferredToolCalls(
      [
        { toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS },
        { toolCallId: "c4", toolId: "files.write", inputs: { ...WRITE_INPUTS, path: "two.html" } },
      ],
      ctx,
    );

    expect(result.nestedApproval).toBeNull();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(ctx.state.cancelled).toBe(true);
    expect(ctx.state.cancelReason).toBe("Cancelled by user");
  });

  it("stops before the next deferred tool when abort happens mid-batch", async () => {
    const controller = new AbortController();
    const executeSpy = vi
      .spyOn(toolRegistry, "execute")
      .mockImplementation(async () => {
        controller.abort();
        return { ok: true, result: { success: true } };
      });
    const ctx = makeCtx({ executionMode: "auto", signal: controller.signal });

    await executeDeferredToolCalls(
      [
        { toolCallId: "c3", toolId: "files.write", inputs: WRITE_INPUTS },
        { toolCallId: "c4", toolId: "files.write", inputs: { ...WRITE_INPUTS, path: "two.html" } },
      ],
      ctx,
    );

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(ctx.state.cancelled).toBe(true);
    expect(ctx.state.cancelReason).toBe("Cancelled by user");
  });

  it("keeps every deferred registry execution site covered by an abort guard", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/lib/litt-intelligence/agent-loop-v2.ts"),
      "utf8",
    );
    const start = source.indexOf("export async function executeDeferredToolCalls(");
    const end = source.indexOf(
      "\n/**\n * Resume the V2 agent loop after an approval decision.",
      start,
    );

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const deferredFunction = source.slice(start, end);
    const executeSites = deferredFunction.match(/toolRegistry\.execute\(/g) ?? [];
    const abortGuards = deferredFunction.match(/ctx\.signal\?\.aborted/g) ?? [];

    expect(executeSites.length).toBeGreaterThan(0);
    expect(abortGuards.length).toBe(executeSites.length);
  });

  it("unknown tool id is reported honestly to the model, not dropped silently", async () => {
    const ctx = makeCtx({ executionMode: "auto" });
    await executeDeferredToolCalls(
      [{ toolCallId: "cx", toolId: "nope.not-a-tool", inputs: {} }],
      ctx,
    );
    // The model gets an honest error result for the unknown call — it is
    // never executed and never vanishes without a trace.
    const last = ctx.llmMessages[ctx.llmMessages.length - 1] as {
      content: string;
    };
    expect(JSON.stringify(last)).toContain("Unknown tool: nope.not-a-tool");
  });
});
