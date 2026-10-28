"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { Conversation, ConversationMessage } from "@/lib/studio/types";
import {
  buildLittPageContext,
  resolveLittNavigation,
  studioBridgeUrl,
} from "@/lib/litt/page-context";

interface GlobalConversationPayload {
  projectId: string;
  conversation: Conversation;
  messages: ConversationMessage[];
}

interface GlobalTurnPayload {
  projectId?: string;
  conversationId?: string;
  userMessage?: ConversationMessage;
  assistantMessage?: ConversationMessage;
  duplicate?: boolean;
  revision?: number;
  error?: string;
  detail?: string;
}

function mergeCanonicalMessages(
  current: ConversationMessage[],
  incoming: Array<ConversationMessage | undefined>,
): ConversationMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message) byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function clientRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `global_${crypto.randomUUID()}`;
  }
  return `global_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function messageDisplayContent(message: ConversationMessage): string {
  if (message.status === "streaming" && !message.content) return "LiTT is working…";
  return message.content;
}

/**
 * Persistent authenticated Global LiTT operator.
 *
 * Unlike the old navigation bridge, this component owns a real persisted
 * server conversation via /api/litt/global. It stays mounted in AppShell as
 * routes change, while Studio hides the overlay and keeps its own full work
 * surface. Real-project work is an explicit "Continue in Studio" handoff.
 */
export default function GlobalLittEntry() {
  const pathname = usePathname() ?? "/dashboard";
  const params = useSearchParams();
  const router = useRouter();
  const { isSignedIn, userId, getToken } = useClerkAuth();
  const [draft, setDraft] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);

  const context = useMemo(
    () => buildLittPageContext(pathname, new URLSearchParams(params.toString()), userId),
    [pathname, params, userId],
  );

  const authHeaders = useCallback(async (json = false): Promise<HeadersInit> => {
    const token = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const loadGlobalConversation = useCallback(async (): Promise<GlobalConversationPayload | null> => {
    if (!isSignedIn || !userId) return null;
    setLoading(true);
    try {
      const response = await fetch("/api/litt/global", {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
      });
      const data = await response.json().catch(() => null) as GlobalConversationPayload | null;
      if (!response.ok || !data?.conversation) {
        throw new Error("Global LiTT could not load its conversation.");
      }
      setConversation(data.conversation);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setError(null);
      return data;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Global LiTT is unavailable.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [authHeaders, isSignedIn, userId]);

  // The controller is user-scoped and loads once per signed-in identity. It is
  // intentionally NOT keyed to pathname so navigation does not reset the chat.
  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setDraft("");
    setError(null);
    dialog.current?.close();
    if (isSignedIn && userId) void loadGlobalConversation();
  }, [isSignedIn, userId, loadGlobalConversation]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView?.({ block: "end" });
  }, [messages, busy]);

  if (!isSignedIn) return null;
  // Studio already supplies the full operator/composer. Keep this controller
  // mounted but never overlay a second assistant there.
  if (pathname.startsWith("/studio")) return null;

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    // Closed-set navigation stays deterministic and provider-free. The panel
    // remains open across the route transition instead of forcing a Studio hop.
    const navigation = resolveLittNavigation(trimmed, context, null);
    if (navigation) {
      setDraft("");
      router.push(navigation);
      return;
    }

    let activeConversation = conversation;
    if (!activeConversation) {
      const loaded = await loadGlobalConversation();
      activeConversation = loaded?.conversation ?? null;
    }
    if (!activeConversation) return;

    const requestId = clientRequestId();
    const pageContext = {
      surface: "global_companion",
      route: context.pathname,
      pageTitle: context.surface,
      activeEntity: context.selectedEntity
        ? { type: context.selectedEntity.kind, name: context.selectedEntity.id }
        : undefined,
      authenticated: true,
    };

    setBusy(true);
    setError(null);
    setDraft("");

    const post = async (expectedRevision: number) => fetch("/api/litt/global", {
      method: "POST",
      credentials: "include",
      headers: await authHeaders(true),
      body: JSON.stringify({
        message: trimmed,
        clientRequestId: requestId,
        expectedRevision,
        pageContext,
      }),
    });

    try {
      let response = await post(activeConversation.revision);
      let data = await response.json().catch(() => ({})) as GlobalTurnPayload;

      // A second tab may have advanced the same canonical conversation. Refresh
      // once and retry the SAME clientRequestId; the server's preflight keeps
      // this from becoming a second provider action if the first already won.
      if (response.status === 409) {
        const refreshed = await loadGlobalConversation();
        if (refreshed?.conversation) {
          response = await post(refreshed.conversation.revision);
          data = await response.json().catch(() => ({})) as GlobalTurnPayload;
        }
      }

      if (data.userMessage || data.assistantMessage) {
        setMessages((current) => mergeCanonicalMessages(current, [data.userMessage, data.assistantMessage]));
      }
      if (typeof data.revision === "number") {
        setConversation((current) => current ? { ...current, revision: data.revision! } : current);
      }

      if (!response.ok) {
        const persistedFailure = data.assistantMessage?.content;
        setError(persistedFailure || data.detail || data.error || "LiTT could not complete that turn.");
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Connection lost while talking to LiTT.");
      // Canonical DB is authoritative. Rehydrate in case the server finished
      // after the client lost the response.
      await loadGlobalConversation();
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void sendTurn(draft);
  }

  const visibleMessages = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-50);
  const lastUserMessage = [...visibleMessages].reverse().find((message) => message.role === "user");

  function continueInStudio() {
    router.push(studioBridgeUrl(context, lastUserMessage?.content ?? draft, null));
  }

  return <>
    <div className="flex shrink-0 items-center justify-end border-b border-white/10 px-3 py-2">
      <button
        type="button"
        className="min-h-11 rounded-xl border border-lime-400/30 px-4 text-sm font-medium text-lime-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-300"
        onClick={() => dialog.current?.showModal()}
      >
        Ask LiTT
      </button>
    </div>

    <dialog
      ref={dialog}
      aria-labelledby="global-litt-title"
      className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-hidden rounded-t-2xl border border-white/15 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/60 md:inset-auto md:bottom-6 md:right-6 md:m-0 md:w-[28rem] md:rounded-2xl"
    >
      <div className="flex max-h-[85dvh] flex-col" style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h2 id="global-litt-title" className="text-base font-semibold">Global LiTT</h2>
            <p className="truncate text-xs text-zinc-400">{context.pathname}</p>
          </div>
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="min-h-11 rounded-lg px-3 text-sm focus-visible:outline focus-visible:outline-lime-300"
            aria-label="Close Ask LiTT"
          >
            Close
          </button>
        </div>

        <div className="min-h-40 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
          {loading && !conversation ? (
            <p className="text-sm text-zinc-400">Loading LiTT…</p>
          ) : visibleMessages.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm font-medium text-zinc-200">LiTT is with you across the app.</p>
              <p className="mt-1 text-xs text-zinc-500">Ask about this page, navigate, or continue real project work in Studio.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleMessages.map((message) => (
                <div
                  key={message.id}
                  className={message.role === "user"
                    ? "ml-8 rounded-2xl bg-lime-300 px-3 py-2 text-sm text-black"
                    : "mr-8 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-100"}
                >
                  <p className="whitespace-pre-wrap break-words">{messageDisplayContent(message)}</p>
                  {message.status === "failed" ? <p className="mt-1 text-[11px] opacity-70">Failed</p> : null}
                </div>
              ))}
              {busy ? (
                <div className="mr-8 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-400">
                  LiTT is working…
                </div>
              ) : null}
              <div ref={messagesEnd} />
            </div>
          )}
        </div>

        {error ? (
          <div className="mx-4 mb-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        ) : null}

        <form onSubmit={submit} className="border-t border-white/10 p-4">
          <label htmlFor="global-litt-prompt" className="sr-only">Ask LiTT about this page</label>
          <textarea
            id="global-litt-prompt"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask LiTT about this page…"
            rows={3}
            maxLength={4000}
            disabled={busy}
            className="w-full resize-y rounded-xl border border-white/20 bg-black/30 p-3 text-base focus-visible:outline focus-visible:outline-lime-300 disabled:opacity-60"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={!draft.trim() || busy || loading}
              className="min-h-11 flex-1 rounded-xl bg-lime-300 px-4 font-semibold text-black disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              {busy ? "Working…" : "Send"}
            </button>
            <button
              type="button"
              onClick={continueInStudio}
              disabled={busy}
              className="min-h-11 rounded-xl border border-white/15 px-3 text-sm text-zinc-200 disabled:opacity-40 focus-visible:outline focus-visible:outline-lime-300"
            >
              Studio
            </button>
          </div>
        </form>
      </div>
    </dialog>
  </>;
}
