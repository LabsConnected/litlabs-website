/**
 * Phase 3B tests — CommandExecutor lifecycle events.
 *
 * Tests the hardened CommandExecutor wrapper:
 *   - runId + toolCallId propagation
 *   - tool_call / tool_stream / tool_result event emission
 *   - litt_event unified broadcast
 *   - cancellation via cancel()
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CommandExecutor } from "../command-executor.js";
import { NodeShellExecutor } from "../shell.js";
import type { RuntimeEvent, ShellExecutor, ShellExecuteOptions, ShellResult, StreamChunk } from "../types.js";

// ─── Event capture ─────────────────────────────────────────────────

class EventCapture {
  events: RuntimeEvent[] = [];

  emitter() {
    return (event: RuntimeEvent) => {
      this.events.push(event);
    };
  }

  filter(type: string): RuntimeEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  filterLitt(subtype: string): RuntimeEvent[] {
    return this.events.filter((e) => e.type === "litt_event" && e.subtype === subtype);
  }

  reset(): void {
    this.events = [];
  }
}

// ─── Mock shell for lifecycle tests ────────────────────────────────

class StreamingMockShell implements ShellExecutor {
  readonly cwd: string;
  readonly platform: NodeJS.Platform | string = process.platform;
  readonly environment: Record<string, string> = {};
  private _cancelled = false;
  private _delayMs: number;

  constructor(cwd: string, delayMs = 0) {
    this.cwd = cwd;
    this._delayMs = delayMs;
  }

  async execute(options: ShellExecuteOptions): Promise<ShellResult> {
    if (this._delayMs > 0) {
      // Wait in a way that cancel can interrupt
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this._delayMs);
        // Check cancellation every 10ms
        const checker = setInterval(() => {
          if (this._cancelled) {
            clearTimeout(timer);
            clearInterval(checker);
            resolve();
          }
        }, 10);
      });
    }

    // Simulate streaming
    if (options.onStream && !this._cancelled) {
      options.onStream({ stream: "stdout", text: "chunk1 ", ts: Date.now() });
      options.onStream({ stream: "stdout", text: "chunk2", ts: Date.now() });
    }

    const status: ShellResult["status"] = this._cancelled ? "cancelled" : "success";
    return {
      ok: status === "success",
      status,
      stdout: this._cancelled ? "" : "chunk1 chunk2",
      stderr: "",
      exitCode: status === "success" ? 0 : -1,
      durationMs: 1,
      command: options.command,
      args: options.args ?? [],
      truncated: false,
      pid: 12345,
    };
  }

  async cancel(): Promise<number[]> {
    this._cancelled = true;
    return [12345];
  }
}

// ─── Tests ─────────────────────────────────────────────────────────

describe("CommandExecutor lifecycle events", () => {
  it("emits tool_call, tool_stream, tool_result, and litt_event", async () => {
    const capture = new EventCapture();
    const shell = new StreamingMockShell(process.cwd());
    const executor = new CommandExecutor(shell, null, capture.emitter());

    const result = await executor.execute("echo", ["hello"], {
      runId: "run_test_1",
      toolCallId: "tc_test_1",
    });

    // Verify result
    assert.equal(result.runId, "run_test_1");
    assert.equal(result.toolCallId, "tc_test_1");
    assert.equal(result.status, "success");

    // Verify tool_call event
    const toolCalls = capture.filter("tool_call");
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].runId, "run_test_1");
    assert.equal(toolCalls[0].toolCallId, "tc_test_1");
    assert.equal(toolCalls[0].data.command, "echo");

    // Verify tool_stream events
    const toolStreams = capture.filter("tool_stream");
    assert.ok(toolStreams.length >= 2);
    for (const stream of toolStreams) {
      assert.equal(stream.runId, "run_test_1");
      assert.equal(stream.toolCallId, "tc_test_1");
    }

    // Verify tool_result event
    const toolResults = capture.filter("tool_result");
    assert.equal(toolResults.length, 1);
    assert.equal(toolResults[0].runId, "run_test_1");
    assert.equal(toolResults[0].toolCallId, "tc_test_1");
    assert.equal(toolResults[0].data.status, "success");

    // Verify litt_event broadcasts
    const littEvents = capture.filter("litt_event");
    assert.ok(littEvents.length >= 3); // tool_call + tool_stream(s) + tool_result
    const littSubtypes = new Set(littEvents.map((e) => e.subtype));
    assert.ok(littSubtypes.has("tool_call"));
    assert.ok(littSubtypes.has("tool_stream"));
    assert.ok(littSubtypes.has("tool_result"));
  });

  it("generates runId and toolCallId if not provided", async () => {
    const capture = new EventCapture();
    const shell = new StreamingMockShell(process.cwd());
    const executor = new CommandExecutor(shell, null, capture.emitter());

    const result = await executor.execute("echo", ["test"]);

    assert.ok(result.runId.startsWith("run_"));
    assert.ok(result.toolCallId.startsWith("tc_"));

    const toolCalls = capture.filter("tool_call");
    assert.equal(toolCalls[0].runId, result.runId);
    assert.equal(toolCalls[0].toolCallId, result.toolCallId);
  });

  it("cancel() emits tool_cancelled litt_event", async () => {
    const capture = new EventCapture();
    const shell = new StreamingMockShell(process.cwd(), 5000); // 5s delay
    const executor = new CommandExecutor(shell, null, capture.emitter());

    // Start a long-running command
    const executePromise = executor.execute("sleep", ["10"], {
      runId: "run_cancel_1",
      toolCallId: "tc_cancel_1",
    });

    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 50));

    // Cancel it
    const killedPids = await executor.cancel("run_cancel_1");
    assert.ok(killedPids.length > 0);

    const result = await executePromise;
    assert.equal(result.status, "cancelled");

    // Verify litt_event with tool_cancelled subtype
    const cancelledEvents = capture.filterLitt("tool_cancelled");
    assert.ok(cancelledEvents.length > 0);
    assert.equal(cancelledEvents[0].runId, "run_cancel_1");
    assert.equal(cancelledEvents[0].toolCallId, "tc_cancel_1");
  });

  it("cancel() with non-matching runId does nothing", async () => {
    const shell = new StreamingMockShell(process.cwd());
    const executor = new CommandExecutor(shell);

    const killedPids = await executor.cancel("wrong_run_id");
    assert.deepEqual(killedPids, []);
  });

  it("isRunning() reflects active state", async () => {
    const shell = new StreamingMockShell(process.cwd());
    const executor = new CommandExecutor(shell);

    assert.equal(executor.isRunning(), false);
    assert.equal(executor.getActiveRun(), null);

    await executor.execute("echo", ["test"], {
      runId: "run_active_1",
      toolCallId: "tc_active_1",
    });

    // After completion, not running
    assert.equal(executor.isRunning(), false);
  });
});

// ─── Real shell integration ────────────────────────────────────────

describe("CommandExecutor with real shell", () => {
  it("executes a real command with lifecycle events", async () => {
    const capture = new EventCapture();
    const shell = new NodeShellExecutor(process.cwd());
    const executor = new CommandExecutor(shell, null, capture.emitter());

    const result = await executor.execute(
      process.platform === "win32" ? "cmd" : "echo",
      process.platform === "win32" ? ["/c", "echo hello"] : ["hello"],
      { runId: "run_real_1", toolCallId: "tc_real_1" },
    );

    assert.equal(result.status, "success");
    // ToolResult.data.stdout contains the output (set by runCommand boundary)
    const stdout = result.result.data.stdout as string;
    assert.ok(stdout.includes("hello"));

    // Verify events were emitted
    assert.ok(capture.filter("tool_call").length > 0);
    assert.ok(capture.filter("tool_result").length > 0);
    assert.ok(capture.filter("litt_event").length > 0);
  });
});
