/**
 * Retry strategy for failed assistant turns (pure — unit tested).
 *
 * A failed turn means the work never completed. The chat-only regenerate API
 * cannot re-run workspace operations — the mission would stay Idle while a
 * fresh chat reply appears, a silent downgrade of Retry. When the failed
 * message has a parent user message, Retry re-sends that message through the
 * normal send pipeline so the turn is genuinely re-run (V2 agent loop,
 * approvals, streaming). Returns the parent text to re-send, or null when
 * the caller should fall back to the regenerate API.
 */
export function findRetryResendText(
  target: { status?: string | null; parentMessageId?: string | null },
  allMessages: Array<{ id: string; role: string; content?: string | null }>,
): string | null {
  if (target.status !== "failed") return null;
  const parent = target.parentMessageId
    ? allMessages.find((m) => m.id === target.parentMessageId && m.role === "user")
    : undefined;
  const text = parent?.content?.trim();
  return text ? text : null;
}

export interface RetryTargetRef {
  id: string;
  role: string;
  status?: string | null;
  parentMessageId?: string | null;
  clientRequestId?: string | null;
}

/**
 * Resolve a Retry target against freshly fetched canonical messages.
 *
 * The client store's copy of a failed turn can diverge from the persisted
 * row: locally constructed shapes carry `parentMessageId: null`, and
 * optimistic/canonical identity mixing can leave the pressed message with
 * an id the canonical list no longer holds. The server persists the real
 * linkage, so before Retry decides anything it re-reads the turn from the
 * canonical list. Matching is deliberately conservative — exact id first,
 * then the persisted clientRequestId, then the conversation's ONLY failed
 * assistant message (never a guess among several) — and returns null when
 * the turn cannot be identified canonically, so the caller can say so
 * honestly instead of silently downgrading to a chat-only reply.
 */
export function resolveCanonicalRetryTarget<T extends RetryTargetRef>(
  target: { id?: string | null; status?: string | null; clientRequestId?: string | null },
  freshMessages: T[],
): T | null {
  if (target.id) {
    const byId = freshMessages.find(
      (m) => m.id === target.id && m.role === "assistant",
    );
    if (byId) return byId;
  }
  if (target.clientRequestId) {
    const byRequest = freshMessages.find(
      (m) => m.role === "assistant" && m.clientRequestId === target.clientRequestId,
    );
    if (byRequest) return byRequest;
  }
  // Identity fully lost: only a target the store itself shows as failed
  // may adopt the conversation's single failed turn.
  if (target.status !== "failed") return null;
  const failed = freshMessages.filter(
    (m) => m.role === "assistant" && m.status === "failed",
  );
  return failed.length === 1 ? failed[0] : null;
}
