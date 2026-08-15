/**
 * Hardened CommandExecutor — Phase 3B.
 *
 * This is the canonical execution boundary that the CLI cockpit, Studio,
 * and voice surfaces use. It wraps:
 *
 *   - ShellExecutor (process spawning + streaming + cancellation)
 *   - runCommand() security boundary (capability classification, approval)
 *   - RuntimeStore lifecycle (runId, toolCallId, command_start/end events)
 *   - litt_event unified broadcast
 *
 * Lifecycle:
 *
 *   execute({ runId, toolCallId, command, args, ... })
 *     │
 *     ├─ emit tool_call  { runId, toolCallId, command, args }
 *     ├─ emit litt_event { subtype: "tool_call", runId, toolCallId, ... }
 *     │
 *     ├─ store.commandStart(command, args, cwd, runId)
 *     │
 *     ├─ for each stream chunk:
 *     │    emit tool_stream { runId, toolCallId, stream, text, ts }
 *     │    emit litt_event  { subtype: "tool_stream", runId, toolCallId, ... }
 *     │
 *     ├─ runCommand() security boundary (classify, approve, execute)
 *     │
 *     ├─ store.commandEnd(command, success, exitCode, durationMs, message, runId)
 *     │
 *     ├─ emit tool_result { runId, toolCallId, status, message, data }
 *     └─ emit litt_event  { subtype: "tool_result", runId, toolCallId, ... }
 *
 * Cancellation:
 *
 *   cancel(runId?)
 *     │
 *     ├─ shell.cancel() → kills process tree (zero orphans)
 *     ├─ emit litt_event { subtype: "tool_cancelled", runId, toolCallId }
 *     └─ the pending execute() promise resolves with status: "cancelled"
 */

import type {
  ShellExecutor,
  ToolResult,
  ToolStatus,
  RuntimeEvent,
  RuntimeEventEmitter,
  StreamChunk,
} from "./types.js";
import type { RuntimeStore } from "./state.js";
import { runCommand as runCommandSecure, type ExecutionOptions } from "./execution.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface CommandExecutorOptions extends ExecutionOptions {
  /** Canonical run ID — shared across CLI, Studio, and Socket.IO */
  runId?: string;
  /** Canonical tool call ID — unique per tool invocation within a run */
  toolCallId?: string;
  /** Human-readable label for the command (defaults to command name) */
  label?: string;
  /** Optional emitter for direct event broadcast (in addition to store) */
  emitter?: RuntimeEventEmitter;
}

export interface CommandExecutorResult {
  /** The ToolResult from the execution boundary */
  result: ToolResult;
  /** Canonical run ID */
  runId: string;
  /** Canonical tool call ID */
  toolCallId: string;
  /** Discrete status */
  status: ToolStatus;
  /** Duration in milliseconds */
  durationMs: number;
}

// ─── CommandExecutor ───────────────────────────────────────────────

/**
 * Hardened command executor with lifecycle events and streaming.
 *
 * This is the ONE canonical execution path. CLI, Studio, and voice must
 * all route through this (or through runCommand() directly for lower-level
 * cases). It ensures:
 *   - Every execution has a runId and toolCallId
 *   - Lifecycle events are emitted to the RuntimeStore
 *   - litt_event is broadcast for every lifecycle transition
 *   - Streaming chunks are forwarded as tool_stream events
 *   - Cancellation kills the process tree and resolves with "cancelled"
 */
export class CommandExecutor {
  private _shell: ShellExecutor;
  private _store: RuntimeStore | null;
  private _emitter: RuntimeEventEmitter | null;
  private _activeRun: { runId: string; toolCallId: string } | null = null;

  constructor(shell: ShellExecutor, store?: RuntimeStore | null, emitter?: RuntimeEventEmitter | null) {
    this._shell = shell;
    this._store = store ?? null;
    this._emitter = emitter ?? null;
  }

  /**
   * Set or replace the event emitter (e.g. when wiring to Socket.IO).
   */
  setEmitter(emitter: RuntimeEventEmitter | null): void {
    this._emitter = emitter;
  }

  /**
   * Execute a command with full lifecycle management.
   *
   * Emits:
   *   - tool_call (start)
   *   - tool_stream (for each stdout/stderr chunk)
   *   - tool_result (end)
   *   - litt_event (unified broadcast for each of the above)
   */
  async execute(
    command: string,
    args: string[],
    options: CommandExecutorOptions = {},
  ): Promise<CommandExecutorResult> {
    const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const toolCallId = options.toolCallId ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const label = options.label ?? command;
    const t0 = Date.now();

    this._activeRun = { runId, toolCallId };

    // Emit tool_call start
    this.emit({
      type: "tool_call",
      ts: t0,
      data: { command, args, runId, toolCallId, label },
      runId,
      toolCallId,
    });
    this.emitLittEvent("tool_call", t0, { command, args, runId, toolCallId, label }, runId, toolCallId);

    // Wrap the onStream callback to also emit tool_stream events
    const userOnStream = options.onStream;
    const streamingOnStream = (chunk: StreamChunk) => {
      // Forward to user callback
      userOnStream?.(chunk);
      // Emit tool_stream event
      this.emit({
        type: "tool_stream",
        ts: chunk.ts,
        data: { stream: chunk.stream, text: chunk.text, runId, toolCallId },
        runId,
        toolCallId,
      });
      this.emitLittEvent("tool_stream", chunk.ts, { stream: chunk.stream, text: chunk.text, runId, toolCallId }, runId, toolCallId);
    };

    // Execute through the security boundary
    const result = await runCommandSecure(this._shell, command, args, {
      ...options,
      commandLabel: label,
      onStream: streamingOnStream,
    });

    const durationMs = Date.now() - t0;
    this._activeRun = null;

    // Emit tool_result
    const resultTs = Date.now();
    this.emit({
      type: "tool_result",
      ts: resultTs,
      data: {
        runId,
        toolCallId,
        status: result.status,
        success: result.success,
        message: result.message,
        durationMs,
      },
      runId,
      toolCallId,
    });
    this.emitLittEvent(
      "tool_result",
      resultTs,
      { runId, toolCallId, status: result.status, success: result.success, message: result.message, durationMs },
      runId,
      toolCallId,
    );

    return {
      result,
      runId,
      toolCallId,
      status: result.status,
      durationMs,
    };
  }

  /**
   * Cancel the active command.
   * Kills the entire process tree and resolves the pending execute()
   * with status: "cancelled".
   *
   * If a runId is provided, only cancels if it matches the active run.
   * Returns the list of PIDs that were killed.
   */
  async cancel(runId?: string): Promise<number[]> {
    if (runId && this._activeRun?.runId !== runId) {
      return [];
    }

    const active = this._activeRun;
    const killedPids = await this._shell.cancel();

    if (active) {
      const ts = Date.now();
      this.emit({
        type: "tool_result",
        ts,
        data: {
          runId: active.runId,
          toolCallId: active.toolCallId,
          status: "cancelled",
          success: false,
          message: "Cancelled by user",
          killedPids,
        },
        runId: active.runId,
        toolCallId: active.toolCallId,
      });
      this.emitLittEvent(
        "tool_cancelled",
        ts,
        { runId: active.runId, toolCallId: active.toolCallId, killedPids },
        active.runId,
        active.toolCallId,
      );
    }

    this._activeRun = null;
    return killedPids;
  }

  /**
   * Check if a command is currently active.
   */
  isRunning(): boolean {
    return this._activeRun !== null;
  }

  /**
   * Get the active run's identity (runId + toolCallId), or null.
   */
  getActiveRun(): { runId: string; toolCallId: string } | null {
    return this._activeRun;
  }

  // ─── Internal ────────────────────────────────────────────────────

  private emit(event: RuntimeEvent): void {
    // Emit to the store's emitter (if any)
    if (this._store) {
      // The store has its own emitter — we don't duplicate here.
      // The store emits command_start/command_end via runCommand's store calls.
    }
    // Emit to our direct emitter (e.g. Socket.IO)
    if (this._emitter) {
      try {
        this._emitter(event);
      } catch {
        // emitter must never crash the executor
      }
    }
  }

  private emitLittEvent(
    subtype: string,
    ts: number,
    data: Record<string, unknown>,
    runId: string,
    toolCallId: string,
  ): void {
    this.emit({
      type: "litt_event",
      ts,
      subtype,
      data,
      runId,
      toolCallId,
    });
  }
}

/**
 * Create a hardened CommandExecutor.
 */
export function createCommandExecutor(
  shell: ShellExecutor,
  store?: RuntimeStore | null,
  emitter?: RuntimeEventEmitter | null,
): CommandExecutor {
  return new CommandExecutor(shell, store, emitter);
}
