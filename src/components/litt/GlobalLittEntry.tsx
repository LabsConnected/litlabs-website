"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useConversationStore } from "@/app/(app)/studio/stores/useConversationStore";
import { buildLittPageContext, resolveLittNavigation, studioBridgeUrl } from "@/lib/litt/page-context";

/** Persistent navigation/composer bridge. Studio owns the sole runtime and conversation controller. */
export default function GlobalLittEntry() {
  const pathname = usePathname() ?? "/dashboard";
  const params = useSearchParams();
  const router = useRouter();
  const { isSignedIn, userId } = useClerkAuth();
  const [draft, setDraft] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const selectedId = useConversationStore(state => state.selectedConversationId);
  const conversations = useConversationStore(state => state.conversations);
  const conversation = conversations.find(item => item.id === selectedId && item.ownerId === userId) ?? null;
  const context = buildLittPageContext(pathname, new URLSearchParams(params.toString()), userId);

  useEffect(() => { dialog.current?.close(); }, [pathname, params]);
  useEffect(() => { setDraft(""); dialog.current?.close(); }, [userId]);

  if (!isSignedIn) return null;
  // Studio already supplies the operator/composer. Never overlay a competing assistant there.
  if (pathname.startsWith("/studio")) return null;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    const destination = resolveLittNavigation(draft, context, conversation) ?? studioBridgeUrl(context, draft, conversation);
    dialog.current?.close();
    setDraft("");
    router.push(destination);
  }

  return <>
    <div className="flex shrink-0 items-center justify-end border-b border-white/10 px-3 py-2">
      <button type="button" className="min-h-11 rounded-xl border border-lime-400/30 px-4 text-sm text-lime-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-lime-300" onClick={() => dialog.current?.showModal()}>
        Ask LiTT
      </button>
    </div>
    <dialog ref={dialog} aria-labelledby="global-litt-title" className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-white/15 bg-zinc-950 p-4 text-white shadow-2xl backdrop:bg-black/60 md:inset-auto md:bottom-6 md:right-6 md:m-0 md:w-[28rem] md:rounded-2xl" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="global-litt-title" className="text-base font-semibold">Ask LiTT</h2>
        <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-lg px-3 focus-visible:outline focus-visible:outline-lime-300" aria-label="Close Ask LiTT">Close</button>
      </div>
      <p className="mb-3 text-sm text-zinc-400">Navigate here, or continue with LiTT in Studio.</p>
      <form onSubmit={submit}>
        <label htmlFor="global-litt-prompt" className="sr-only">Ask LiTT about this page</label>
        <textarea id="global-litt-prompt" autoFocus value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask LiTT about this page…" rows={3} maxLength={4000} className="w-full resize-y rounded-xl border border-white/20 bg-black/30 p-3 text-base focus-visible:outline focus-visible:outline-lime-300" />
        <button type="submit" disabled={!draft.trim()} className="mt-3 min-h-11 w-full rounded-xl bg-lime-300 px-4 font-semibold text-black disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Continue</button>
      </form>
      <details className="mt-3 text-xs text-zinc-400"><summary className="min-h-8 cursor-pointer">Current page</summary><pre className="max-w-full whitespace-pre-wrap break-all">{JSON.stringify(context, null, 2)}</pre></details>
    </dialog>
  </>;
}
