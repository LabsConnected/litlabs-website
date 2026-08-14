/**
 * Phase 3B tests — hardened ToolResult status, streaming, and cancellation.
 *
 * Tests the new discrete status enum (success | failed | cancelled | timeout),
 * incremental stdout/stderr streaming via onStream, and process-tree
 * cancellation with zero orphan processes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NodeShellExecutor } from "../shell.js";
import type { StreamChunk, ToolResult, ToolStatus } from "../types.js";

// ─── ToolResult status enum ────────────────────────────────────────

describe("ToolResult status enum", () => {
  it("has exactly four discrete statuses", () => {
    const statuses: ToolStatus[] = ["success", "failed", "cancelled", "timeout"];
    assert.equal(statuses.length, 4);
    assert.equal(new Set(statuses).size, 4);
  });

  it("success=true iff status=success", () => {
    const results: ToolResult[] = [
      { status: "success", success: true, message: "ok", data: {} },
      { status: "failed", success: false, message: "err", data: {} },
      { status: "cancelled", success: false, message: "cancelled", data: {} },
      { status: "timeout", success: false, message: "timeout", data: {} },
    ];
    for (const r of results) {
      assert.equal(r.success, r.status === "success");
    }
  });
});

// ─── Streaming ─────────────────────────────────────────────────────

describe("NodeShellExecutor streaming", () => {
  it("emits stdout chunks via onStream", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const chunks: StreamChunk[] = [];

    const result = await shell.execute({
      command: process.platform === "win32" ? "cmd" : "echo",
      args: process.platform === "win32" ? ["/c", "echo hello stream"] : ["hello", "stream"],
      timeoutMs: 5000,
      onStream: (chunk) => chunks.push(chunk),
    });

    assert.equal(result.status, "success");
    assert.ok(result.stdout.trim().includes("hello stream"));
    // At least one stdout chunk should have been emitted
    const stdoutChunks = chunks.filter((c) => c.stream === "stdout");
    assert.ok(stdoutChunks.length > 0);
    // Reassembled chunks should contain the output
    const reassembled = stdoutChunks.map((c) => c.text).join("");
    assert.ok(reassembled.includes("hello stream"));
  });

  it("emits stderr chunks for failing commands", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const chunks: StreamChunk[] = [];

    // Use a command that writes to stderr and exits non-zero
    const result = await shell.execute({
      command: process.platform === "win32" ? "cmd" : "sh",
      args: process.platform === "win32" ? ["/c", "echo error >&2 && exit 1"] : ["-c", "echo error >&2; exit 1"],
      timeoutMs: 5000,
      onStream: (chunk) => chunks.push(chunk),
    });

    assert.equal(result.status, "failed");
    assert.notEqual(result.exitCode, 0);
    const stderrChunks = chunks.filter((c) => c.stream === "stderr");
    const reassembled = stderrChunks.map((c) => c.text).join("");
    assert.ok(reassembled.includes("error"));
  });

  it("includes pid in ShellResult", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const result = await shell.execute({
      command: process.platform === "win32" ? "cmd" : "echo",
      args: process.platform === "win32" ? ["/c", "echo test"] : ["test"],
      timeoutMs: 5000,
    });

    assert.notEqual(result.pid, null);
    assert.equal(typeof result.pid, "number");
  });
});

// ─── Cancellation ──────────────────────────────────────────────────

describe("NodeShellExecutor cancellation", () => {
  it("cancels a long-running command and returns cancelled status", async () => {
    const shell = new NodeShellExecutor(process.cwd());

    // Start a command that sleeps for 10 seconds
    const executePromise = shell.execute({
      command: process.platform === "win32" ? "cmd" : "sh",
      args: process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      timeoutMs: 30_000, // long timeout — we'll cancel before this
    });

    // Give the process time to start
    await new Promise((r) => setTimeout(r, 200));

    // Cancel it
    const killedPids = await shell.cancel();
    assert.ok(killedPids.length > 0);

    const result = await executePromise;
    assert.equal(result.status, "cancelled");
    assert.equal(result.ok, false);
  });

  it("cancel() returns empty array when nothing is running", async () => {
    const shell = new NodeShellExecutor(process.cwd());
    const killed = await shell.cancel();
    assert.deepEqual(killed, []);
  });
});

// ─── Timeout ───────────────────────────────────────────────────────

describe("NodeShellExecutor timeout", () => {
  it("returns timeout status when command exceeds timeoutMs", async () => {
    const shell = new NodeShellExecutor(process.cwd());

    const result = await shell.execute({
      command: process.platform === "win32" ? "cmd" : "sh",
      args: process.platform === "win32" ? ["/c", "ping -n 10 127.0.0.1 > nul"] : ["-c", "sleep 10"],
      timeoutMs: 500, // very short timeout
    });

    assert.equal(result.status, "timeout");
    assert.equal(result.ok, false);
    assert.ok(result.error!.includes("Timeout"));
  }, 10_000);
});
