/**
 * RuntimeClient — desktop runtime connection state for LiTT Shell.
 */

import { io, type Socket } from "socket.io-client";
import type { RuntimeState, RuntimeEvent } from "@litt/agent-core";

export type ConnectionState = "OFFLINE" | "CONNECTING" | "AUTHENTICATING" | "SYNCING" | "SHARED" | "DEGRADED" | "RECONNECTING";

export type WorkspaceState = {
  name: string;
  path: string;
  branch: string | null;
  status: "loaded" | "loading" | "error";
};

export type LocationSource = "user" | "manual" | "ip" | "unavailable";
export type LocationPermission = "granted" | "denied" | "unavailable";

export type LocationContext = {
  source: LocationSource;
  permission: LocationPermission;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  city?: string;
  region?: string;
  country?: string;
  timezone?: string;
  updatedAt: number;
};

// Re-export canonical types from @litt/agent-core
export type { RuntimeState, RuntimeEvent };

/** A single streamed LiTT turn event, as forwarded by terminal-server. */
export interface LiTTTurnEvent {
  type: string;
  turnId: string;
  text?: string;
  message?: string;
  model?: string;
  usage?: { total_tokens: number };
  timing?: { ttftMs: number; generationMs: number; totalMs: number };
}

/**
 * The payload each subscribable event carries — the ONE source of
 * per-event listener typing. subscribe() and emit() are both keyed off
 * it, so a listener for "state" is typed with ConnectionState and a
 * mismatched emit is a compile error.
 */
export interface RuntimeClientEventMap {
  state: ConnectionState;
  workspace: WorkspaceState;
  "litt:event": LiTTTurnEvent;
}

export type RuntimeClientEventName = keyof RuntimeClientEventMap;

/**
 * A listener with its payload type erased, for storage only.
 *
 * The listener map holds subscribers for several event types at once, so
 * no single entry type can describe them all. subscribe() erases on the
 * way in and emit() restores on the way out — both keyed by the SAME
 * event name, so a listener is only ever invoked with the payload its
 * event declares above. These two casts are the only ones, and neither
 * widens the public API: callers keep full per-event typing.
 */
type ErasedListener = (value: never) => void;

const TERMINAL_SERVER_URL = "http://127.0.0.1:4001";

export class DesktopRuntimeClient {
  private socket: Socket | null = null;
  private _state: ConnectionState = "OFFLINE";
  private _runtimeState: RuntimeState | null = null;
  private _workspace: WorkspaceState = { name: "Desktop", path: "", branch: null, status: "loading" };
  private listeners: Map<RuntimeClientEventName, ErasedListener[]> = new Map();
  private _cwd: string | null = null;

  /**
   * Hydrate workspace cwd from Tauri's read_workspace_context command.
   * This reads the canonical desktop-cwd.json file written by the CLI launcher.
   * Called once during connect() before authentication.
   */
  private async hydrateCwdFromTauri(): Promise<void> {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const jsonStr = await invoke<string>("read_workspace_context");
      if (typeof jsonStr === "string" && jsonStr.trim()) {
        const parsed = JSON.parse(jsonStr);
        if (typeof parsed.cwd === "string" && parsed.cwd.trim()) {
          this._cwd = parsed.cwd;
          if (this._cwd) {
            this._workspace = { ...this._workspace, path: this._cwd };
          }
          console.log("[DesktopRuntime] Hydrated cwd from Tauri:", this._cwd);
          return;
        }
      }
    } catch {
      // Fall through to fallback logic
    }
    // Tauri invoke failed or returned invalid data; log warning
    console.warn("[DesktopRuntime] read_workspace_context failed or returned invalid JSON");
  }

  private get cwd(): string {
    if (this._cwd === null) {
      try {
        // Only available in Tauri/Node context, not browser
        this._cwd = typeof process !== "undefined" ? process.cwd() : "";
      } catch {
        this._cwd = "";
      }
    }
    return this._cwd;
  }

  get state(): ConnectionState { return this._state; }
  get runtimeState(): RuntimeState | null { return this._runtimeState; }
  get workspace(): WorkspaceState { return this._workspace; }
  get isConnected(): boolean { return this._state === "SHARED"; }

  private emit<E extends RuntimeClientEventName>(event: E, value: RuntimeClientEventMap[E]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    // Restore the payload type erased by subscribe() — same event key,
    // so this is the type the listener was registered with.
    for (const listener of [...listeners]) {
      (listener as (value: RuntimeClientEventMap[E]) => void)(value);
    }
  }

  /**
   * Subscribe to a runtime event. Returns an unsubscribe function.
   *
   * "state" and "workspace" replay their current value immediately, so a
   * late subscriber is never left waiting for the next change.
   */
  subscribe<E extends RuntimeClientEventName>(
    event: E,
    listener: (value: RuntimeClientEventMap[E]) => void,
  ): () => void {
    const erased = listener as ErasedListener;
    let listeners = this.listeners.get(event);
    if (!listeners) { listeners = []; this.listeners.set(event, listeners); }
    listeners.push(erased);
    // Immediate replay of current state, where one exists.
    if (event === "state") {
      (listener as (value: ConnectionState) => void)(this._state);
    } else if (event === "workspace") {
      (listener as (value: WorkspaceState) => void)(this._workspace);
    }
    return () => {
      const idx = listeners.indexOf(erased);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  private setupEventHandlers(): void {
    if (!this.socket) return;
    this.socket
      .on("connect", () => { this._state = "AUTHENTICATING"; this.emit("state", this._state); })
      .on("runtime:snapshot", (state: RuntimeState) => {
        this._runtimeState = state;
        const project = state.project;
        this._workspace = {
          name: project?.name || "Desktop",
          path: project?.root || this.cwd || "",
          branch: project?.branch || state.branch || null,
          status: "loaded"
        };
        this._state = "SHARED";
        this.emit("state", this._state);
        this.emit("workspace", this._workspace);
      })
      .on("runtime:state", (state: RuntimeState) => {
        this._runtimeState = state;
        const project = state.project;
        if (project) {
          this._workspace = { name: project.name || "Desktop", path: project.root || this.cwd || "", branch: project.branch || null, status: "loaded" };
          this.emit("workspace", this._workspace);
        }
      })
      .on("runtime:event", (event: RuntimeEvent) => { /* events tracked */ })
      .on("litt:event", (event: { type: string; turnId: string; text?: string; message?: string; model?: string; usage?: { total_tokens: number }; timing?: { ttftMs: number; generationMs: number; totalMs: number } }) => {
        this.emit("litt:event", event);
      })
      .on("disconnect", () => { this._state = "OFFLINE"; this.emit("state", this._state); });
  }

  // ── Chat API ────────────────────────────────────────────────────────
  // Send a natural-language turn to the terminal-server LiTT runtime
  async sendMessage(turnId: string, message: string): Promise<void> {
    if (!this.socket || this._state !== "SHARED") return;
    this.socket.emit("litt:chat", { turnId, message });
  }

  subscribeChatEvent(listener: (event: { type: string; turnId: string; text?: string; message?: string; usage?: { total_tokens: number }; timing?: { ttftMs: number; generationMs: number; totalMs: number } }) => void): () => void {
    return this.subscribe("litt:event", listener);
  }

  private async getAuthToken(): Promise<string> {
    // The desktop app NEVER holds TERMINAL_AUTH_SECRET. It exchanges a
    // Clerk token (from the webview's Clerk session) for a short-lived
    // terminal JWT via the terminal-server's /api/token-exchange endpoint.
    //
    // In local dev mode (no Clerk token available), falls back to an
    // unsigned dev token that only works when the server has no
    // TERMINAL_AUTH_SECRET configured.
    try {
      const { invoke } = await import("@tauri-apps/api/core");

      // Try to get a Clerk token from the webview session
      // (injected by the frontend Clerk provider)
      const clerkToken = (window as Window & { __clerkToken?: string }).__clerkToken;
      if (clerkToken) {
        const terminalToken = await invoke<string>("exchange_clerk_token", {
          clerkToken,
          terminalUrl: TERMINAL_SERVER_URL,
        });
        return terminalToken;
      }

      // Dev fallback: unsigned dev token (only works in local dev mode)
      const canonicalCwd = this.cwd;
      console.log("[DesktopRuntime] No Clerk token — using dev token. cwd:", canonicalCwd);
      const token = await invoke<string>("generate_dev_token", { cwd: canonicalCwd });
      return token;
    } catch {
      // Last-resort dev fallback: unsigned dev token
      const userId = "desktop-local-dev";
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = { sub: userId, aud: "littree-terminal", iat: timestamp, exp: timestamp + 3600 };
      const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
      return "dev-" + encodedPayload;
    }
  }

  async connect(): Promise<void> {
    if (this._state !== "OFFLINE" && this._state !== "DEGRADED") return;
    this._state = "CONNECTING";
    this.emit("state", this._state);
    try {
      // Hydrate cwd from Tauri's read_workspace_context first
      await this.hydrateCwdFromTauri();
      const token = await this.getAuthToken();
      this.socket = io(TERMINAL_SERVER_URL, { transports: ["websocket"], reconnection: true, reconnectionAttempts: 5, auth: { token } });
      this.setupEventHandlers();
    } catch (err) {
      console.error("[DesktopRuntime] Connection error:", err);
      this._state = "DEGRADED";
      this.emit("state", this._state);
    }
  }

  disconnect(): void {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
    this._state = "OFFLINE";
    this.emit("state", this._state);
  }

  reconnect(): void {
    if (this.socket) { this._state = "RECONNECTING"; this.emit("state", this._state); this.socket.connect(); }
    else { this.connect(); }
  }
}

export const desktopRuntime = new DesktopRuntimeClient();
