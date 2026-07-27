/**
 * LiTTEventBus — one typed event stream for all Studio surfaces.
 *
 * Chat, Canvas, Voice, Tools, and the Autonomic Loop banner all
 * subscribe to this shared bus. No surface creates its own event
 * format.
 *
 * @see src/lib/litt/types.ts for the LiTTEvent union.
 */

import type { LiTTEvent } from "./types";

type EventHandler = (event: LiTTEvent) => void;

export class LiTTEventBus {
  private handlers = new Set<EventHandler>();
  private history: LiTTEvent[] = [];
  private readonly maxHistory = 200;

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Subscribe to events of a specific type. */
  subscribeToType<T extends LiTTEvent["type"]>(
    type: T,
    handler: (event: Extract<LiTTEvent, { type: T }>) => void,
  ): () => void {
    const wrapped: EventHandler = (event) => {
      if (event.type === type) {
        handler(event as Extract<LiTTEvent, { type: T }>);
      }
    };
    this.handlers.add(wrapped);
    return () => {
      this.handlers.delete(wrapped);
    };
  }

  /** Emit an event to all subscribers. */
  emit(event: LiTTEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[LiTTEventBus] handler error:", err);
      }
    }
  }

  /** Get recent event history (for debugging/replay). */
  getHistory(): readonly LiTTEvent[] {
    return this.history;
  }

  /** Clear history (for testing). */
  clearHistory(): void {
    this.history = [];
  }

  /** Get the count of subscribers (for debugging). */
  subscriberCount(): number {
    return this.handlers.size;
  }
}

/** Singleton event bus for the Studio. */
let globalBus: LiTTEventBus | null = null;

export function getEventBus(): LiTTEventBus {
  if (!globalBus) {
    globalBus = new LiTTEventBus();
  }
  return globalBus;
}

/** Reset the global bus (for testing only). */
export function resetEventBus(): void {
  globalBus = null;
}
