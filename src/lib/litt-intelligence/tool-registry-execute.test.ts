// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { toolRegistry, ToolExecutionTimeoutError } from "./tool-registry";
import type { LiTTToolDefinition } from "./types";

/**
 * Regression tests for tool-execution deadlines.
 *
 * Production defect (2026-09-21): `ToolRegistry.execute()` awaited the
 * handler with no bound — every tool's declared `timeoutMs` was ignored.
 * A wedged workspace call (unanswered /ws-files fetch on a stalled
 * terminal-server pod) hung the agent loop indefinitely: `maxRuntimeMs`
 * is only checked between steps, so the run never reached its own error
 * handling and the transcript reconciled to "the previous run ended
 * before it produced a result" with the real cause lost.
 *
 * These tests pin the fix: a tool call is bounded by its declared
 * timeoutMs and by the run's abort signal, and both surfaces as an
 * ordinary tool failure the loop can report and recover from.
 *
 * NOTE: test handlers must accept an `inputs` parameter — the registry
 * treats a zero-arg function as a lazy handler LOADER, not a handler.
 */

function fakeToolDef(id: string, timeoutMs: number): LiTTToolDefinition {
  return {
    id,
    name: id,
    description: `${id} (test double)`,
    source: "internal",
    version: "1.0.0",
    inputSchema: { type: "object", properties: {}, required: [] },
    outputSchema: { type: "object" },
    requiredCapabilities: [],
    requiredPermissions: [],
    risk: "low",
    approvalPolicy: {
      required: false,
      autoApproveReadOnly: false,
      requireExplicitForMutations: false,
      neverAllow: false,
    },
    timeoutMs,
    idempotent: false,
    readOnly: false,
    permissionLevel: "read",
    enabled: true,
  };
}

type TestHandler = (inputs: Record<string, unknown>, transport?: unknown) => Promise<unknown>;

describe("toolRegistry.execute — execution deadline", () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails a handler that never resolves once its timeoutMs elapses", async () => {
    const hang: TestHandler = (_inputs) => new Promise<never>(() => {});
    toolRegistry.register(fakeToolDef("test.hang", 50), hang);

    const started = Date.now();
    const result = await toolRegistry.execute("test.hang", {});

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Tool "test.hang" timed out after 50ms');
    }
  });

  it("fails a slow handler that would resolve after its deadline", async () => {
    const slow: TestHandler = async (_inputs) => {
      await new Promise((r) => setTimeout(r, 300));
      return { success: true };
    };
    toolRegistry.register(fakeToolDef("test.slow", 40), slow);

    const result = await toolRegistry.execute("test.slow", {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("timed out");
  });

  it("returns the handler result when it settles inside the deadline", async () => {
    const fast: TestHandler = async (_inputs) => ({ success: true, value: 42 });
    toolRegistry.register(fakeToolDef("test.fast", 5_000), fast);

    const result = await toolRegistry.execute("test.fast", {});

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result).toEqual({ success: true, value: 42 });
  });

  it("aborts an in-flight tool call when the run's signal fires", async () => {
    const hang: TestHandler = (_inputs) => new Promise<never>(() => {});
    toolRegistry.register(fakeToolDef("test.abortable", 60_000), hang);
    const controller = new AbortController();

    const pending = toolRegistry.execute("test.abortable", {}, { signal: controller.signal });
    controller.abort();
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Tool "test.abortable" was aborted');
  });

  it("does not start a tool call against an already-aborted signal", async () => {
    const calls: unknown[] = [];
    const handler: TestHandler = async (inputs) => {
      calls.push(inputs);
      return { success: true };
    };
    toolRegistry.register(fakeToolDef("test.late", 60_000), handler);
    const controller = new AbortController();
    controller.abort();

    const result = await toolRegistry.execute("test.late", {}, { signal: controller.signal });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("aborted");
    expect(calls).toHaveLength(0);
  });

  it("a timeout is a plain failure — the registry stays usable for the next call", async () => {
    const hang: TestHandler = (_inputs) => new Promise<never>(() => {});
    const ok: TestHandler = async (_inputs) => ({ success: true });
    toolRegistry.register(fakeToolDef("test.hang", 40), hang);
    toolRegistry.register(fakeToolDef("test.ok", 5_000), ok);

    const hung = await toolRegistry.execute("test.hang", {});
    const next = await toolRegistry.execute("test.ok", {});

    expect(hung.ok).toBe(false);
    expect(next.ok).toBe(true);
  });

  it("ToolExecutionTimeoutError carries the tool id and deadline", () => {
    const err = new ToolExecutionTimeoutError("files.write", 10_000);
    expect(err.toolId).toBe("files.write");
    expect(err.timeoutMs).toBe(10_000);
    expect(err.message).toContain("timed out after 10000ms");
  });
});
