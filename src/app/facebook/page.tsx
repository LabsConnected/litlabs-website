"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

const MAX_LENGTH = 63206; // Facebook's published message cap

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

export default function FacebookPublisherPage() {
  const { resolvedColors: T } = useTheme();
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<
    | { type: "idle" }
    | { type: "loading" }
    | { type: "success"; postId: string; permalink: string | null }
    | { type: "error"; message: string }
  >({ type: "idle" });

  const charsUsed = message.length;
  const overLimit = charsUsed > MAX_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || overLimit || status.type === "loading") return;

    setStatus({ type: "loading" });

    try {
      const res = await fetch("/api/facebook/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });

      const json = (await res.json().catch(() => ({
        error: "Could not read server response.",
      }))) as { success?: boolean; postId?: string; permalink?: string | null; error?: string };

      if (!res.ok || !json.success) {
        setStatus({
          type: "error",
          message: json.error || `Request failed (${res.status}).`,
        });
        return;
      }

      setStatus({
        type: "success",
        postId: json.postId || "",
        permalink: json.permalink || null,
      });
      setMessage("");
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Network error.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-bold transition-opacity hover:opacity-80"
        style={{ color: T.textMuted }}
      >
        <ArrowLeft size={14} /> Back to dashboard
      </Link>

      <div
        className="mt-6 rounded-2xl border p-6"
        style={{
          borderColor: `${T.accentColor}30`,
          backgroundColor: `${T.boxBg}`,
        }}
      >
        <div className="flex items-center gap-3">
          <FacebookIcon className="h-6 w-6 text-[#1877F2]" />
          <div>
            <h1 className="text-xl font-black text-white">Facebook Page Publisher</h1>
            <p className="text-xs" style={{ color: T.textMuted }}>
              Create and publish text posts to your connected Facebook Page.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="fb-message"
              className="mb-1.5 block text-xs font-black uppercase tracking-wider text-slate-300"
            >
              Post message
            </label>
            <textarea
              id="fb-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write something for your Facebook Page..."
              rows={6}
              className="w-full resize-y rounded-xl border bg-black/20 p-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#1877F2]/50"
              style={{ borderColor: `${T.borderColor}30` }}
              maxLength={MAX_LENGTH + 1}
            />
            <div className="mt-1.5 flex justify-between text-[10px] font-bold">
              <span style={{ color: T.textMuted }}>
                {charsUsed.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
              </span>
              {overLimit && (
                <span className="text-rose-400">
                  Message exceeds Facebook limit
                </span>
              )}
            </div>
          </div>

          {message.trim() && (
            <div
              className="rounded-xl border p-4"
              style={{
                borderColor: `${T.borderColor}20`,
                backgroundColor: "rgba(24,119,242,.05)",
              }}
            >
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                Preview
              </span>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
                {message}
              </p>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                status.type === "loading" ||
                !message.trim() ||
                overLimit
              }
              className="inline-flex items-center gap-2 rounded-xl bg-[#1877F2] px-5 py-2.5 text-xs font-black text-white transition hover:bg-[#166fe5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status.type === "loading" ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Send size={14} />
                  Publish to Facebook
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setMessage("");
                setStatus({ type: "idle" });
              }}
              className="rounded-xl border px-4 py-2.5 text-xs font-bold text-slate-300 transition hover:bg-white/5"
              style={{ borderColor: `${T.borderColor}30` }}
            >
              Clear
            </button>
          </div>
        </form>

        {status.type === "success" && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-black text-emerald-300">
                Published successfully
              </p>
              <p className="mt-1 text-xs" style={{ color: T.textMuted }}>
                Post ID: <code className="rounded bg-black/30 px-1 py-0.5 text-slate-200">{status.postId}</code>
              </p>
              {status.permalink && (
                <a
                  href={status.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-xs font-bold text-[#1877F2] hover:underline"
                >
                  View post on Facebook →
                </a>
              )}
            </div>
          </div>
        )}

        {status.type === "error" && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-black text-rose-300">
                Could not publish
              </p>
              <p className="mt-1 text-xs" style={{ color: T.textMuted }}>
                {status.message}
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-[10px]" style={{ color: T.textMuted }}>
        Publishing is restricted to admins. The Page access token is stored server-side.
      </p>
    </div>
  );
}
