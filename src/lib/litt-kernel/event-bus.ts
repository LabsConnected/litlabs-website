/**
 * LiTT Event Bus
 *
 * Typed pub/sub for Kernel events. Subsystems subscribe to events
 * instead of polling the Kernel. The bus is synchronous and in-process
 * (no cross-tab/cross-server messaging in Phase 1).
 *
 * Events:
 *   - decision.created    → a control decision was made
 *   - capability.changed  → a capability state changed
 *   - canvas.focus.changed → active canvas changed
 *   - project.activated   → a project became active
 *   - mission.activated   → a mission became active
 *   - approval.required   → an action needs user approval
 *   - action.blocked      → an action was blocked by governance
 */

import type { KernelEvent, LiTTControlDecision, CapabilityState } from "./types";

type Listener = (event: KernelEvent) => void;

class EventBus {
  private listeners = new Set<Listener>();

  /**
   * Emits an event to all subscribers.
   * Errors in listeners are caught and logged — one bad listener
   * doesn't break the bus.
   */
  emit(event: KernelEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[Kernel:EventBus] listener error:", err);
      }
    }
  }

  /**
   * Subscribes to all events. Returns an unsubscribe function.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribes to a specific event type. Returns an unsubscribe function.
   */
  on<T extends KernelEvent["type"]>(
    type: T,
    listener: (event: Extract<KernelEvent, { type: T }>) => void,
  ): () => void {
    const wrapper: Listener = (event) => {
      if (event.type === type) {
        listener(event as Extract<KernelEvent, { type: T }>);
      }
    };
    this.listeners.add(wrapper);
    return () => this.listeners.delete(wrapper);
  }

  /**
   * Clears all listeners — used in tests.
   */
  clear(): void {
    this.listeners.clear();
  }
}

// ─── Singleton ──────────────────────────────────────────────────

export const kernelEventBus = new EventBus();

// ─── Convenience emitters ───────────────────────────────────────

export function emitDecisionCreated(decision: LiTTControlDecision): void {
  kernelEventBus.emit({ type: "decision.created", decision });
}

export function emitCapabilityChanged(capabilityId: string, newState: CapabilityState): void {
  kernelEventBus.emit({ type: "capability.changed", capabilityId, newState });
}

export function emitCanvasFocusChanged(canvasId: string | null): void {
  kernelEventBus.emit({ type: "canvas.focus.changed", canvasId });
}

export function emitApprovalRequired(decision: LiTTControlDecision, reason: string): void {
  kernelEventBus.emit({ type: "approval.required", decision, reason });
}

export function emitActionBlocked(decision: LiTTControlDecision, reason: string): void {
  kernelEventBus.emit({ type: "action.blocked", decision, reason });
}
