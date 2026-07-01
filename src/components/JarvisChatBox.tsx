"use client";

import { useState } from "react";
import { askJarvis } from "@/lib/ai/client";

export default function JarvisChatBox() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!message.trim() || loading) return;

    setLoading(true);
    setReply("");

    try {
      const data = await askJarvis(message);
      setReply(data.reply || "No reply returned.");
    } catch (err) {
      setReply(err instanceof Error ? err.message : "Jarvis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-4 shadow-2xl space-y-3">
      <div>
        <h2 className="text-xl font-black">🤖 Jarvis Gateway</h2>
        <p className="text-sm text-zinc-400">
          Local AI powered by Ollama through LiTTree&apos;s unified AI route.
        </p>
      </div>

      <textarea
        className="w-full rounded-xl bg-black/70 border border-white/10 p-3 text-white outline-none focus:border-orange-500"
        rows={5}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Ask Jarvis anything..."
      />

      <button
        onClick={send}
        disabled={loading}
        className="rounded-xl bg-orange-500 px-4 py-2 font-bold text-black disabled:opacity-50"
      >
        {loading ? "Thinking..." : "Ask Jarvis"}
      </button>

      {reply && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-3 whitespace-pre-wrap text-sm leading-relaxed">
          {reply}
        </div>
      )}
    </section>
  );
}
