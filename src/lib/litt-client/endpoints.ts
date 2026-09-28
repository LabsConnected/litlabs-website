/**
 * Canonical Studio conversation HTTP paths.
 *
 * These strings match the fetches already inlined in Studio
 * (`useCanonicalConversation`, `approval-polling`, `ActionRunStatusPanel`,
 * `useStudioAttachments`). The LiTT App calls them through
 * `createLittConversationsClient`. Studio keeps its own call sites in
 * Phase 0 so its behavior cannot drift from a rewrite.
 *
 * Message and approval ids are interpolated the same way Studio does
 * (no extra encoding). The action-run path encodes the id because that
 * is what `ActionRunStatusPanel` already requests.
 */
export const LITT_UPLOAD_PATH = "/api/upload";

/** Multipart field Studio sends on every attachment upload. */
export const LITT_UPLOAD_PURPOSE = "studio-attachment";

export const littConversationPaths = {
  collection: "/api/studio/conversations",
  list(projectId: string): string {
    return `/api/studio/conversations?projectId=${encodeURIComponent(projectId)}`;
  },
  conversation(conversationId: string): string {
    return `/api/studio/conversations/${conversationId}`;
  },
  messages(conversationId: string): string {
    return `/api/studio/conversations/${conversationId}/messages`;
  },
  regenerate(conversationId: string): string {
    return `/api/studio/conversations/${conversationId}/regenerate`;
  },
  cancel(conversationId: string): string {
    return `/api/studio/conversations/${conversationId}/cancel`;
  },
  approval(conversationId: string, pausedRunId: string): string {
    return `/api/studio/conversations/${conversationId}/approvals/${pausedRunId}`;
  },
  actionRun(conversationId: string): string {
    return `/api/studio/conversations/${encodeURIComponent(conversationId)}/action-run`;
  },
} as const;
