import { littAuthHeaders } from "./auth-headers";
import { littConversationPaths } from "./endpoints";

/**
 * Headless client for `/api/studio/conversations/*`.
 *
 * Request shapes match Studio's inlined fetches (method, path, JSON
 * body, `credentials: "include"`, Clerk bearer when a token exists).
 * Studio is not rewired onto this client in Phase 0 — the hook also
 * owns optimistic messages, slash commands, revision retry, and the
 * stall watchdog. The LiTT App should call this instead of copying
 * those fetches again.
 *
 * Nothing here polls. Approval polling stays in `approval-polling.ts`
 * and runs only after the user submits a decision or watches one gate.
 */

export interface LittClientDeps {
  fetchImpl?: typeof fetch;
  getToken?: () => Promise<string | null>;
}

export interface SendConversationMessageInput {
  message: string;
  clientRequestId: string;
  expectedRevision: number;
  requestedAgentSlug: string;
  agentMode: string;
  executionMode?: string;
  agentInstanceId?: string;
  provider?: string;
  category?: string;
  model?: string;
  images?: string[];
  runtimeContext?: unknown;
  previewSelection?: unknown;
}

export interface CreateConversationInput {
  projectId?: string;
  activeAgentSlug: string;
}

export interface RegenerateConversationInput {
  assistantMessageId: string;
  clientRequestId: string;
  expectedRevision: number;
  runtimeContext?: unknown;
}

export interface PatchConversationInput {
  expectedRevision: number;
  patch: Record<string, unknown>;
}

interface RequestInitExtras {
  method?: string;
  json?: boolean;
  body?: string;
  signal?: AbortSignal;
  cache?: RequestCache;
}

export function createLittConversationsClient(deps: LittClientDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInitExtras = {}): Promise<Response> {
    const headers = await littAuthHeaders(deps.getToken, Boolean(init.json));
    const requestInit: RequestInit = {
      method: init.method ?? "GET",
      credentials: "include",
      headers,
    };
    if (init.body !== undefined) requestInit.body = init.body;
    if (init.signal) requestInit.signal = init.signal;
    if (init.cache) requestInit.cache = init.cache;
    return fetchImpl(path, requestInit);
  }

  return {
    list(projectId: string, signal?: AbortSignal) {
      return request(littConversationPaths.list(projectId), { cache: "no-store", signal });
    },
    create(body: CreateConversationInput, signal?: AbortSignal) {
      return request(littConversationPaths.collection, {
        method: "POST",
        json: true,
        body: JSON.stringify(body),
        signal,
      });
    },
    getMessages(conversationId: string, signal?: AbortSignal) {
      return request(littConversationPaths.messages(conversationId), { cache: "no-store", signal });
    },
    sendMessage(conversationId: string, body: SendConversationMessageInput, signal?: AbortSignal) {
      return request(littConversationPaths.messages(conversationId), {
        method: "POST",
        json: true,
        body: JSON.stringify(body),
        signal,
      });
    },
    cancel(conversationId: string, clientRequestId: string, signal?: AbortSignal) {
      return request(littConversationPaths.cancel(conversationId), {
        method: "POST",
        json: true,
        body: JSON.stringify({ clientRequestId }),
        signal,
      });
    },
    regenerate(conversationId: string, body: RegenerateConversationInput, signal?: AbortSignal) {
      return request(littConversationPaths.regenerate(conversationId), {
        method: "POST",
        json: true,
        body: JSON.stringify(body),
        signal,
      });
    },
    patch(conversationId: string, body: PatchConversationInput, signal?: AbortSignal) {
      return request(littConversationPaths.conversation(conversationId), {
        method: "PATCH",
        json: true,
        body: JSON.stringify(body),
        signal,
      });
    },
    remove(conversationId: string, signal?: AbortSignal) {
      return request(littConversationPaths.conversation(conversationId), {
        method: "DELETE",
        signal,
      });
    },
    /** One read of the action-run projection. Does not poll. */
    getActionRun(conversationId: string, signal?: AbortSignal) {
      return request(littConversationPaths.actionRun(conversationId), { cache: "no-store", signal });
    },
  };
}

export type LittConversationsClient = ReturnType<typeof createLittConversationsClient>;
