/**
 * Canonical sensory event contracts.
 *
 * A SensoryEvent is a normalized observation from any source (terminal,
 * browser, Git, compiler, deployment, voice, camera, etc.) that flows
 * through the attention router before reaching model context.
 *
 * Key principles:
 *   - Browser/MCP/tool content is DATA, not POLICY.
 *   - Untrusted content can never become a system instruction.
 *   - Secret events must be filtered before persistence.
 *   - High-volume streams receive backpressure.
 *
 * This is the ONE canonical source. No existing system defines this concept.
 */

// ─── Trust levels ─────────────────────────────────────────────────

/**
 * The trust level of an event source.
 *
 * system: LiTT internal system (kernel, scheduler) — highest trust
 * verified_provider: A verified external provider (GitHub, Vercel, Stripe)
 * user: Direct user input
 * external_untrusted: Browser content, MCP output, web pages — lowest trust
 */
export type EventTrust = "system" | "verified_provider" | "user" | "external_untrusted";

// ─── Sensitivity levels ───────────────────────────────────────────

/**
 * The sensitivity of event payload data.
 *
 * public: Safe to log, display, and persist
 * internal: Safe for internal systems, not for external display
 * private: User-private data, requires access control
 * secret: Must be filtered/redacted before any persistence or display
 */
export type EventSensitivity = "public" | "internal" | "private" | "secret";

// ─── Sensory event ────────────────────────────────────────────────

/**
 * A normalized observation from any source.
 *
 * Flows through the attention router:
 *   event → schema validation → trust classification → sensitivity
 *   → secret filtering → dedup → debounce → relevance scoring
 *   → summarization → context budget → Kernel
 */
export interface SensoryEvent {
  /** Unique event ID */
  eventId: string;
  /** Schema version for forward compatibility */
  schemaVersion: number;

  /** Tenant/organization ID */
  tenantId: string;
  /** User ID (may be null for system events) */
  userId: string | null;

  /** Conversation ID this event relates to */
  conversationId: string | null;
  /** Mission ID this event relates to */
  missionId: string | null;
  /** Run ID this event relates to */
  runId: string | null;

  /** Source system (e.g. "terminal", "browser", "git", "compiler") */
  source: string;
  /** Event type (e.g. "command.completed", "file.changed", "console.log") */
  type: string;

  /** ISO timestamp when the event was observed */
  observedAt: string;
  /** ISO timestamp when LiTT received the event */
  receivedAt: string;

  /** Correlation ID for grouping related events */
  correlationId: string | null;
  /** Causation ID (the event that caused this one) */
  causationId: string | null;

  /** Trust level of the source */
  trust: EventTrust;
  /** Sensitivity of the payload */
  sensitivity: EventSensitivity;

  /** Confidence score (0.0-1.0), if applicable */
  confidence: number | null;

  /** Reference to the payload (for large payloads stored externally) */
  payloadRef: string | null;
  /** Hash of the payload (for dedup) */
  payloadHash: string | null;

  /** Retention TTL in seconds (after which the event may be deleted) */
  retentionTtlSeconds: number | null;
}

// ─── Attention router rules ───────────────────────────────────────

/**
 * The attention router processes events before they reach model context.
 *
 * Rules:
 *   1. Schema validation — reject malformed events
 *   2. Trust classification — label by source trust
 *   3. Sensitivity classification — label by data sensitivity
 *   4. Secret filtering — redact/remove secret payloads
 *   5. Deduplication — collapse duplicate events
 *   6. Debounce/coalescing — batch rapid events
 *   7. Relevance scoring — rank by relevance to current task
 *   8. Summarization — compress for context budget
 *   9. Context budget — enforce token/size limits
 *  10. Kernel — deliver to the persistent brain
 */

/**
 * Check if an event should be filtered (never persisted or sent to model context).
 *
 * Events with sensitivity "secret" are always filtered.
 * Events from "external_untrusted" sources with high sensitivity are filtered.
 */
export function shouldFilterEvent(event: SensoryEvent): boolean {
  if (event.sensitivity === "secret") {
    return true;
  }
  if (event.trust === "external_untrusted" && event.sensitivity === "private") {
    return true;
  }
  return false;
}

/**
 * Check if event content may be used as a system instruction.
 *
 * Only system and verified_provider events may influence system behavior.
 * User and external_untrusted events are data, never instructions.
 */
export function canBeSystemInstruction(event: SensoryEvent): boolean {
  return event.trust === "system" || event.trust === "verified_provider";
}

// ─── Event creation helper ────────────────────────────────────────

/**
 * Generate a sensory event ID.
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
