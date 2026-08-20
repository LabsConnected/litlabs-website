/**
 * ToolProgressStore — pure, framework-agnostic tool execution state.
 *
 * Tracks the structured per-tool progress for the current mission:
 *   - Which tools started, are running, completed, or failed
 *   - Friendly labels (from tool-labels.ts)
 *   - Concise result summaries (not raw stdout)
 *   - The latest stdout/stderr chunk (for a "Running…" indicator)
 *
 * This is the state that drives the ToolProgress renderer in the shell's
 * main content area during mission execution — filling the "big empty
 * area" that previously showed only an empty streaming placeholder while
 * tools ran.
 *
 * The CockpitStore hook delegates tool-progress mutations to an instance
 * of this class and mirrors its snapshot into React state for rendering,
 * exactly like ChatTranscriptStore.
 *
 * Invariants (enforced here, covered by tool-progress.test.ts):
 *   1. startTool is idempotent per toolCallId — a duplicate start is a no-op.
 *   2. completeTool/failTool only update an existing running entry.
 *   3. appendChunk only updates a running entry (no-op on completed/failed).
 *   4. The store is bounded to the last MAX_TOOLS entries.
 *   5. startMission resets the store (a new mission starts clean).
 *   6. completeMission/failMission set the mission terminal state but
 *      preserve tool entries (so the final view shows all results).
 *   7. clear() resets everything (Ctrl+L, /clear, Esc cancel).
 */

import { toolLabel, toolSummary } from "../lib/tool-labels.js";

export const MAX_TOOLS = 20;

export type ToolStatus = "running" | "completed" | "failed" | "cancelled" | "timeout";

export type MissionProgressStatus = "running" | "completed" | "failed";

export interface ToolProgressEntry {
  /** The tool call id (unique per execution). */
  id: string;
  /** The tool id (e.g. "project.check"). */
  toolId: string;
  /** The tool name (e.g. "check"). */
  toolName: string;
  /** Human-readable label (e.g. "Type checking"). */
  label: string;
  /** Current status. */
  status: ToolStatus;
  /** Start timestamp. */
  startedAt: number;
  /** Completion timestamp (null while running). */
  completedAt: number | null;
  /** Duration in ms (null while running). */
  durationMs: number | null;
  /** Concise result summary (null while running). */
  summary: string | null;
  /** Latest stdout/stderr chunk (for "Running…" indicator). */
  lastChunk: string | null;
}

export interface ToolProgressSnapshot {
  /** Tool entries in execution order. */
  entries: ToolProgressEntry[];
  /** Whether a mission is active. */
  missionActive: boolean;
  /** Mission terminal status (null while running, set on complete/fail). */
  missionStatus: MissionProgressStatus | null;
  /** True if any tool is currently running. */
  hasRunning: boolean;
}

export class ToolProgressStore {
  private entries: ToolProgressEntry[] = [];
  private missionActive = false;
  private missionStatus: MissionProgressStatus | null = null;

  snapshot(): ToolProgressSnapshot {
    return {
      entries: this.entries,
      missionActive: this.missionActive,
      missionStatus: this.missionStatus,
      hasRunning: this.entries.some((e) => e.status === "running"),
    };
  }

  /** Start a new mission — resets tool entries. */
  startMission(): void {
    this.entries = [];
    this.missionActive = true;
    this.missionStatus = null;
  }

  /** Mark the mission completed. Preserves tool entries for the final view. */
  completeMission(): void {
    this.missionActive = false;
    this.missionStatus = "completed";
  }

  /** Mark the mission failed. Preserves tool entries for the final view. */
  failMission(): void {
    this.missionActive = false;
    this.missionStatus = "failed";
  }

  /**
   * Start a tool. Idempotent per toolCallId — a duplicate start is a no-op
   * (the agent loop emits agent_tool_call once per call, but defensive
   * idempotency prevents double-entries from event bridge quirks).
   */
  startTool(toolCallId: string, toolId: string, toolName: string): void {
    if (!toolCallId) return;
    // Idempotent — if this toolCallId already exists, no-op.
    if (this.entries.some((e) => e.id === toolCallId)) return;

    const label = toolLabel(toolId, toolName);
    const entry: ToolProgressEntry = {
      id: toolCallId,
      toolId,
      toolName: toolName || toolId,
      label,
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      durationMs: null,
      summary: null,
      lastChunk: null,
    };
    this.entries = [...this.entries.slice(-(MAX_TOOLS - 1)), entry];
  }

  /** Mark a tool completed with a concise summary. */
  completeTool(
    toolCallId: string,
    success: boolean,
    message: string,
    durationMs?: number,
  ): void {
    const idx = this.entries.findIndex((e) => e.id === toolCallId);
    if (idx === -1) return;
    const entry = this.entries[idx];
    if (entry.status !== "running") return; // already terminal

    const now = Date.now();
    const dur = durationMs ?? (now - entry.startedAt);
    this.entries = [
      ...this.entries.slice(0, idx),
      {
        ...entry,
        status: success ? "completed" : "failed",
        completedAt: now,
        durationMs: dur,
        summary: toolSummary(entry.toolId, success, message, dur),
        lastChunk: null,
      },
      ...this.entries.slice(idx + 1),
    ];
  }

  /** Mark a tool failed (alias for completeTool with success=false). */
  failTool(toolCallId: string, message: string, durationMs?: number): void {
    this.completeTool(toolCallId, false, message, durationMs);
  }

  /** Mark a tool cancelled or timed out. */
  terminalTool(
    toolCallId: string,
    status: "cancelled" | "timeout",
    message: string,
    durationMs?: number,
  ): void {
    const idx = this.entries.findIndex((e) => e.id === toolCallId);
    if (idx === -1) return;
    const entry = this.entries[idx];
    if (entry.status !== "running") return;

    const now = Date.now();
    const dur = durationMs ?? (now - entry.startedAt);
    this.entries = [
      ...this.entries.slice(0, idx),
      {
        ...entry,
        status,
        completedAt: now,
        durationMs: dur,
        summary: status === "cancelled" ? "Cancelled" : "Timed out",
        lastChunk: null,
      },
      ...this.entries.slice(idx + 1),
    ];
  }

  /**
   * Append a stdout/stderr chunk to a running tool. Only updates the
   * lastChunk field (for a "Running…" indicator) — does NOT accumulate
   * raw output (the activity feed already captures fullText for /activity).
   */
  appendChunk(toolCallId: string, chunk: string): void {
    if (!chunk || !chunk.trim()) return;
    const idx = this.entries.findIndex((e) => e.id === toolCallId);
    if (idx === -1) return;
    const entry = this.entries[idx];
    if (entry.status !== "running") return;

    // Keep only the last meaningful chunk — concise, not accumulated.
    const trimmed = chunk.trim().slice(0, 80);
    this.entries = [
      ...this.entries.slice(0, idx),
      { ...entry, lastChunk: trimmed },
      ...this.entries.slice(idx + 1),
    ];
  }

  /** Clear everything (Ctrl+L, /clear, Esc cancel, new session). */
  clear(): void {
    this.entries = [];
    this.missionActive = false;
    this.missionStatus = null;
  }

  /** Number of tool entries. */
  length(): number {
    return this.entries.length;
  }

  /** True if there are no entries and no active mission. */
  isEmpty(): boolean {
    return this.entries.length === 0 && !this.missionActive;
  }
}
