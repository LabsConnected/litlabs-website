"use client";

import { useCallback, useEffect, useState } from "react";

interface Message {
  id: string;
  role: string;
  content: string;
  status: string;
}

export function ChatWindowBody({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [revision, setRevision] = useState(1);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || "Messages could not be loaded.");
      return;
    }
    setMessages(Array.isArray(body.messages) ? body.messages : []);
    if (typeof body.revision === "number") setRevision(body.revision);
    setError(null);
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function send() {
    const message = draft.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        clientRequestId: crypto.randomUUID(),
        expectedRevision: revision,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) {
      setError(body.error || "The message was not sent.");
      return;
    }
    setDraft("");
    await load();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2 text-[12px] leading-5 text-white/80">
        {messages.length === 0 ? <p className="text-white/40">No messages yet. This window is a real conversation.</p> : null}
        {messages.map((message) => (
          <p key={message.id} className="whitespace-pre-wrap">
            <span className="text-white/45">{message.role === "user" ? "You" : "LiTT"} · {message.status}</span>
            <br />
            {message.content}
          </p>
        ))}
      </div>
      {error ? <p className="px-3 text-[11px] text-red-300">{error}</p> : null}
      <form
        className="flex gap-2 border-t border-white/10 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          aria-label="Message this chat"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-w-0 flex-1 rounded bg-black/40 px-2 py-1 text-[12px] text-white outline-none"
          placeholder="Message this chat"
        />
        <button type="submit" className="rounded px-2 text-[11px] text-white/80" disabled={sending}>
          Send
        </button>
      </form>
    </div>
  );
}
