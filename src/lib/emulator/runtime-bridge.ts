/**
 * EmulatorRuntimeBridge — parent-side typed postMessage bridge.
 *
 * Manages the communication channel between the React parent and the isolated
 * iframe host (/arcade-runtime/emulator-session.html). Validates message
 * origin, tracks heartbeat age, and exposes a typed event subscription API.
 *
 * Usage:
 *   const bridge = new EmulatorRuntimeBridge();
 *   bridge.on("runtime.running", (event) => { ... });
 *   bridge.on("runtime.error", (event) => { ... });
 *   bridge.attach(iframeElement);  // starts listening
 *   bridge.sendCommand("command.start");
 *   bridge.detach();               // stops listening
 */

import type {
  RuntimeEvent,
  RuntimeEventType,
  RuntimeCommand,
  RuntimeCommandType,
} from "./types";

type EventHandler = (event: RuntimeEvent) => void;

export class EmulatorRuntimeBridge {
  private handlers = new Map<RuntimeEventType | "*", Set<EventHandler>>();
  private messageListener: ((event: MessageEvent) => void) | null = null;
  private iframe: HTMLIFrameElement | null = null;
  private lastHeartbeatAt: number | null = null;
  private lastEventAt: number | null = null;
  private lastEvent: RuntimeEvent | null = null;
  private attached = false;

  /**
   * Subscribe to a specific event type (or "*" for all events).
   * Returns an unsubscribe function.
   */
  on(type: RuntimeEventType | "*", handler: EventHandler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  off(type: RuntimeEventType | "*", handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Attach to an iframe element and start listening for postMessage events. */
  attach(iframe: HTMLIFrameElement): void {
    if (this.attached) this.detach();
    this.iframe = iframe;
    this.lastHeartbeatAt = null;
    this.lastEventAt = null;
    this.lastEvent = null;

    this.messageListener = (event: MessageEvent) => {
      // Origin validation: the iframe is same-origin (loaded from /arcade-runtime/),
      // so event.origin must match window.location.origin. This prevents
      // cross-origin message injection.
      if (event.origin !== window.location.origin) return;

      const data = event.data as RuntimeEvent | null;
      if (!data || data.source !== "arcade") return;

      this.lastEventAt = Date.now();
      this.lastEvent = data;

      if (data.type === "runtime.heartbeat") {
        this.lastHeartbeatAt = this.lastEventAt;
      }

      // Dispatch to specific handlers + wildcard handlers
      const specific = this.handlers.get(data.type);
      if (specific) {
        for (const handler of specific) {
          try {
            handler(data);
          } catch {
            // Handler errors must not break the bridge
          }
        }
      }
      const wildcard = this.handlers.get("*");
      if (wildcard) {
        for (const handler of wildcard) {
          try {
            handler(data);
          } catch {
            // Handler errors must not break the bridge
          }
        }
      }
    };

    window.addEventListener("message", this.messageListener);
    this.attached = true;
  }

  /** Stop listening and clean up. */
  detach(): void {
    if (this.messageListener) {
      window.removeEventListener("message", this.messageListener);
      this.messageListener = null;
    }
    this.iframe = null;
    this.attached = false;
  }

  /** Send a command to the iframe. */
  sendCommand(type: RuntimeCommandType): void {
    if (!this.iframe?.contentWindow) return;
    const command: RuntimeCommand = { source: "arcade-parent", type };
    this.iframe.contentWindow.postMessage(command, window.location.origin);
  }

  /** Age of the last heartbeat in ms, or null if no heartbeat received. */
  getHeartbeatAgeMs(): number | null {
    if (this.lastHeartbeatAt === null) return null;
    return Date.now() - this.lastHeartbeatAt;
  }

  /** Age of the last event of any type in ms, or null if no event received. */
  getLastEventAgeMs(): number | null {
    if (this.lastEventAt === null) return null;
    return Date.now() - this.lastEventAt;
  }

  /** The last event received, or null. */
  getLastEvent(): RuntimeEvent | null {
    return this.lastEvent;
  }

  /** Whether the bridge is currently attached to an iframe. */
  isAttached(): boolean {
    return this.attached;
  }

  /** Reset heartbeat + event tracking (used on retry/reconnect). */
  resetTracking(): void {
    this.lastHeartbeatAt = null;
    this.lastEventAt = null;
    this.lastEvent = null;
  }
}
