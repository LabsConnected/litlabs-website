/**
 * CLI Cockpit — the real-time runtime display for the LiTT CLI.
 *
 * Reads ONLY from the canonical RuntimeClient. No fake "WORKING" indicators.
 * No local guessed state. Every pixel of output comes from the runtime store
 * or from lifecycle events broadcast by terminal-server.
 *
 *   RuntimeClient (Socket.IO)  →  Cockpit  →  terminal output
 *        ↑                           ↑
 *   canonical truth          displays what the runtime says
 */

import { RuntimeClient, type LifecycleEvent, type ConnectionState } from "./runtime-client.js";
import type { RuntimeState } from "@litt/agent-core";
import { c } from "./utils.js";

// ─── Cockpit state ────────────────────────────────────────────────

interface CockpitDisplayState {
  phase: string;
  activeCommand: string | null;
  runId: string | null;
  lastResult: {
    success: boolean;
    message: string;
    durationMs: number;
    status: "success" | "failed" | "cancelled" | "timeout";
  } | null;
  heartbeatSeq: number;
  online: boolean;
  connection: ConnectionState;
}

function initialState(): CockpitDisplayState {
  return {
    phase: "idle",
    activeCommand: null,
    runId: null,
    lastResult: null,
    heartbeatSeq: 0,
    online: false,
    connection: "disconnected",
  };
}

// ─── Cockpit ──────────────────────────────────────────────────────

export class Cockpit {
  private client: RuntimeClient;
  private display: CockpitDisplayState = initialState();
  private cleanupFns: Array<() => void> = [];
  private activityLog: Array<{ ts: number; text: string }> = [];
  private maxLogEntries = 50;

  constructor(client: RuntimeClient) {
    this.client = client;
  }

  /**
   * Start the cockpit — wire all listeners to the RuntimeClient.
   */
  start(): void {
    // State listener — update display from canonical runtime state
    this.cleanupFns.push(
      this.client.onState((state) => this.onRuntimeState(state)),
    );

    // Connection listener — update connection display
    this.cleanupFns.push(
      this.client.onConnectionChange((conn) => this.onConnectionChange(conn)),
    );

    // Lifecycle listener — display events in the activity feed
    this.cleanupFns.push(
      this.client.onLifecycle((event) => this.onLifecycleEvent(event)),
    );
  }

  /**
   * Stop the cockpit — remove all listeners.
   */
  stop(): void {
    for (const cleanup of this.cleanupFns) {
      try { cleanup(); } catch { /* ignore */ }
    }
    this.cleanupFns = [];
  }

  // ─── Listeners ────────────────────────────────────────────────

  private onRuntimeState(state: RuntimeState): void {
    this.display.phase = state.phase;
    this.display.activeCommand = state.activeCommand?.command ?? null;
    this.display.runId = state.activeCommand?.runId ?? state.lastResult?.runId ?? null;
    this.display.heartbeatSeq = state.heartbeat?.seq ?? 0;
    this.display.online = state.online;

    if (state.lastResult) {
      this.display.lastResult = {
        success: state.lastResult.success,
        message: state.lastResult.message,
        durationMs: state.lastResult.durationMs,
        status: state.lastResult.success ? "success" : "failed",
      };
    }
  }

  private onConnectionChange(conn: ConnectionState): void {
    this.display.connection = conn;
    switch (conn) {
      case "connected":
        this.log(`${c.green}●${c.reset} Connected to runtime`);
        break;
      case "disconnected":
        this.log(`${c.red}●${c.reset} Disconnected from runtime`);
        break;
      case "reconnecting":
        this.log(`${c.yellow}●${c.reset} Reconnecting...`);
        break;
      case "connecting":
        this.log(`${c.blue}●${c.reset} Connecting to runtime...`);
        break;
      case "error":
        this.log(`${c.red}●${c.reset} Connection error — falling back to REST`);
        break;
    }
  }

  private onLifecycleEvent(event: LifecycleEvent): void {
    const time = new Date(event.ts).toLocaleTimeString();
    const runTag = `${c.gray}[${event.runId.slice(-8)}]${c.reset}`;

    switch (event.type) {
      case "run.started": {
        const cmd = (event.data.command as string) ?? "command";
        this.log(`${c.cyan}▶${c.reset} ${time} ${runTag} run started: ${c.bold}${cmd}${c.reset}`);
        break;
      }
      case "tool.started": {
        const tool = (event.data.tool as string) ?? "tool";
        const toolTag = event.toolCallId ? `${c.gray}[${event.toolCallId.slice(-6)}]${c.reset}` : "";
        this.log(`${c.blue}○${c.reset} ${time} ${runTag} ${toolTag} tool started: ${tool}`);
        break;
      }
      case "tool.stdout": {
        const chunk = (event.data.chunk as string) ?? "";
        if (chunk.trim()) {
          process.stdout.write(`${c.gray}${chunk}${c.reset}`);
        }
        break;
      }
      case "tool.stderr": {
        const chunk = (event.data.chunk as string) ?? "";
        if (chunk.trim()) {
          process.stderr.write(`${c.red}${chunk}${c.reset}`);
        }
        break;
      }
      case "tool.completed": {
        const tool = (event.data.tool as string) ?? "tool";
        const duration = (event.data.durationMs as number) ?? 0;
        this.log(`${c.green}✓${c.reset} ${time} ${runTag} tool completed: ${tool} (${duration}ms)`);
        break;
      }
      case "tool.failed": {
        const tool = (event.data.tool as string) ?? "tool";
        const error = (event.data.error as string) ?? "unknown error";
        this.log(`${c.red}✗${c.reset} ${time} ${runTag} tool failed: ${tool} — ${error}`);
        break;
      }
      case "tool.cancelled": {
        const tool = (event.data.tool as string) ?? "tool";
        this.log(`${c.yellow}⊘${c.reset} ${time} ${runTag} tool cancelled: ${tool}`);
        break;
      }
      case "tool.timeout": {
        const tool = (event.data.tool as string) ?? "tool";
        const timeout = (event.data.timeoutMs as number) ?? 0;
        this.log(`${c.yellow}⏱${c.reset} ${time} ${runTag} tool timeout: ${tool} (${timeout}ms)`);
        break;
      }
      case "run.completed": {
        const status = (event.data.status as string) ?? "unknown";
        const duration = (event.data.durationMs as number) ?? 0;
        const exitCode = event.data.exitCode as number | null;
        const message = (event.data.message as string) ?? "";

        switch (status) {
          case "success":
            this.log(`${c.green}■${c.reset} ${time} ${runTag} run completed: ${c.green}SUCCESS${c.reset} (${duration}ms) exit=${exitCode}`);
            break;
          case "failed":
            this.log(`${c.red}■${c.reset} ${time} ${runTag} run completed: ${c.red}FAILED${c.reset} (${duration}ms) exit=${exitCode} — ${message}`);
            break;
          case "cancelled":
            this.log(`${c.yellow}■${c.reset} ${time} ${runTag} run completed: ${c.yellow}CANCELLED${c.reset} (${duration}ms)`);
            break;
          case "timeout":
            this.log(`${c.yellow}■${c.reset} ${time} ${runTag} run completed: ${c.yellow}TIMEOUT${c.reset} (${duration}ms)`);
            break;
          default:
            this.log(`${c.gray}■${c.reset} ${time} ${runTag} run completed: ${status} (${duration}ms)`);
        }
        break;
      }
    }
  }

  // ─── Display ──────────────────────────────────────────────────

  private log(text: string): void {
    console.log(text);
    this.activityLog.push({ ts: Date.now(), text });
    if (this.activityLog.length > this.maxLogEntries) {
      this.activityLog.shift();
    }
  }

  /**
   * Render a compact status line showing the current runtime truth.
   */
  renderStatusLine(): string {
    const connIcon =
      this.display.connection === "connected" ? `${c.green}●${c.reset}` :
      this.display.connection === "reconnecting" ? `${c.yellow}●${c.reset}` :
      `${c.red}●${c.reset}`;

    const phase =
      this.display.phase === "idle" ? `${c.gray}idle${c.reset}` :
      this.display.phase === "running" ? `${c.cyan}running${c.reset}` :
      this.display.phase === "complete" ? `${c.green}complete${c.reset}` :
      this.display.phase === "failed" ? `${c.red}failed${c.reset}` :
      `${c.bold}${this.display.phase}${c.reset}`;

    const runId = this.display.runId
      ? `${c.gray}run:${this.display.runId.slice(-8)}${c.reset}`
      : `${c.gray}no active run${c.reset}`;

    const hb = this.display.heartbeatSeq > 0
      ? `${c.gray}hb:${this.display.heartbeatSeq}${c.reset}`
      : "";

    return `${connIcon} ${phase} ${runId} ${hb}`.trim();
  }

  /**
   * Render a full status panel (for `litt status --remote` or cockpit mode).
   */
  renderPanel(): string {
    const lines: string[] = [];
    lines.push(`\n${c.bold}${c.magenta}LiTT Runtime Cockpit${c.reset}`);
    lines.push(`${c.gray}${"─".repeat(40)}${c.reset}`);
    lines.push(`Connection:  ${this.display.connection}`);
    lines.push(`Phase:       ${this.display.phase}`);
    lines.push(`Active:      ${this.display.activeCommand ?? "—"}`);
    lines.push(`Run ID:      ${this.display.runId ?? "—"}`);
    lines.push(`Heartbeat:   seq=${this.display.heartbeatSeq} online=${this.display.online}`);

    if (this.display.lastResult) {
      const r = this.display.lastResult;
      const statusColor =
        r.status === "success" ? c.green :
        r.status === "cancelled" ? c.yellow :
        r.status === "timeout" ? c.yellow :
        c.red;
      lines.push(`Last result: ${statusColor}${r.status}${c.reset} (${r.durationMs}ms) — ${r.message}`);
    }

    if (this.activityLog.length > 0) {
      lines.push(`${c.gray}${"─".repeat(40)}${c.reset}`);
      lines.push(`${c.bold}Activity${c.reset}`);
      for (const entry of this.activityLog.slice(-10)) {
        lines.push(entry.text);
      }
    }

    return lines.join("\n");
  }

  /**
   * Get the current display state (for testing).
   */
  getDisplayState(): CockpitDisplayState {
    return { ...this.display };
  }

  /**
   * Get the activity log (for testing).
   */
  getActivityLog(): Array<{ ts: number; text: string }> {
    return [...this.activityLog];
  }
}
