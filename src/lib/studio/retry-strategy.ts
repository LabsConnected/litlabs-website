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
