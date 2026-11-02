/**
 * Optimistic send placeholders ("pending_<clientRequestId>") are client-only
 * conversation ids seeded while POST /api/studio/conversations is in flight.
 * They have no server row — any API call that binds one (task adoption,
 * action-run lookup, transcript fetch) is a guaranteed 403/404 until the
 * canonical id replaces the selection when the conversation POST resolves.
 */
export const OPTIMISTIC_CONVERSATION_ID_PREFIX = "pending_";

export function isOptimisticConversationId(
  conversationId: string | null | undefined,
): boolean {
  return Boolean(conversationId?.startsWith(OPTIMISTIC_CONVERSATION_ID_PREFIX));
}
