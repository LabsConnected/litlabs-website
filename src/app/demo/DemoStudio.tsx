"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  Hammer,
  Eye,
  Bot,
  FolderOpen,
  SquareTerminal,
  Rocket,
  Send,
  Loader2,
  Sparkles,
  X,
  ArrowRight,
} from "lucide-react";
import { DEMO_LIMIT_MESSAGE, DEMO_TRANSCRIPT_KEY } from "@/lib/demo/constants";

/**
 * DemoStudio — the anonymous limited demo lane, rendered in the real Studio
 * visual shell (dark command-studio surfaces, lime accent) but WITHOUT any
 * of the authenticated machinery: no CommandStudio, no workspace loading, no
 * terminal-server connection, no project fetches, no authed API calls.
 *
 * The ONLY network call this component ever makes is POST /api/demo/chat
 * with { message, history }. Every capability affordance (builder, preview,
 * agents, files, terminal, deploy) renders visibly but opens the signup wall
 * instead of executing — nothing is ever fake-executed.
 */

const TRANSCRIPT_KEY = DEMO_TRANSCRIPT_KEY;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface PersistedTranscript {
  messages: ChatMessage[];
  updatedAt: number;
}

const LIME = "#a8ff2f";

const CAPABILITIES = [
  { id: "builder", label: "Builder", icon: Hammer },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "deploy", label: "Deploy", icon: Rocket },
] as const;

function loadTranscript(): ChatMessage[] {
  try {
    const raw = window.localStorage.getItem(TRANSCRIPT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedTranscript;
    if (!Array.isArray(parsed.messages)) return [];
    return parsed.messages
      .filter(
        (m) =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string",
      )
      .slice(-40);
  } catch {
    return [];
  }
}

function saveTranscript(messages: ChatMessage[]) {
  try {
    const payload: PersistedTranscript = {
      messages: messages.slice(-40),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(payload));
  } catch {
    // Storage full / private mode — the demo still works, history just
    // won't carry through signup on this device.
  }
}

const WELCOME_MESSAGE: ChatMessage = {
  role: "assistant",
  content:
    "Hey — I'm LiTT. In the full Studio I turn ideas into working software: I build, preview, and deploy real projects with you. This is a limited demo, so I can chat and answer questions, but building, previews, and deploys unlock after you sign up. What are you thinking of building?",
};

export default function DemoStudio({
  maxMessages,
  disabled,
  killSwitch,
}: {
  maxMessages: number;
  disabled: boolean;
  killSwitch: boolean;
}) {
  const { isSignedIn } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [remaining, setRemaining] = useState<number>(maxMessages);
  const [wallOpen, setWallOpen] = useState(false);
  const [wallCapability, setWallCapability] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore the demo transcript so momentum survives a refresh — and the
  // sign-in round-trip (same browser, same localStorage).
  useEffect(() => {
    const restored = loadTranscript();
    if (restored.length > 0) {
      setMessages([WELCOME_MESSAGE, ...restored]);
    }
  }, []);

  useEffect(() => {
    // scrollIntoView is unavailable in some environments (jsdom, SSR) — guard it.
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const openWall = useCallback((capability?: string) => {
    setWallCapability(capability ?? null);
    setWallOpen(true);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || disabled) return;
    setError(null);
    setSending(true);

    const userMessage: ChatMessage = { role: "user", content: text };
    const history = [...messages, userMessage]
      .filter((m) => m !== WELCOME_MESSAGE)
      .slice(-12);
    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    try {
      const res = await fetch("/api/demo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        remaining?: number;
        limitReached?: boolean;
        error?: string;
      };

      if (!res.ok) {
        if (res.status === 429) {
          setError("You're sending messages quickly — give it a few seconds and try again.");
        } else if (res.status === 503) {
          setError("The demo is temporarily unavailable. Please try again later.");
        } else {
          setError("Something went wrong sending that. Please try again.");
        }
        setMessages((prev) => prev.slice(0, -1));
        setInput(text);
        return;
      }

      if (data.limitReached) {
        // Exact copy per spec.
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.reply ?? DEMO_LIMIT_MESSAGE },
        ]);
        setRemaining(0);
        saveTranscript([...messages, userMessage, { role: "assistant", content: data.reply ?? DEMO_LIMIT_MESSAGE }]);
        openWall();
        return;
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.reply ?? "",
      };
      const next = [...messages, userMessage, assistantMessage];
      setMessages(next);
      saveTranscript(next.filter((m) => m !== WELCOME_MESSAGE));
      if (typeof data.remaining === "number") setRemaining(data.remaining);
    } catch {
      setError("Couldn't reach the demo assistant. Check your connection and try again.");
      setMessages((prev) => prev.slice(0, -1));
      setInput(text);
    } finally {
      setSending(false);
    }
  }, [input, sending, disabled, messages, openWall]);

  if (disabled) {
    return (
      <div
        data-testid="demo-disabled"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
        style={{ backgroundColor: "var(--studio-bg, #08060f)", color: "var(--text-primary, #f5f1fa)" }}
      >
        <div
          data-testid="demo-badge"
          className="rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest"
          style={{ borderColor: `${LIME}55`, color: LIME }}
        >
          Demo — limited preview
        </div>
        <h1 className="text-2xl font-bold">The LiTT demo is temporarily unavailable.</h1>
        <p className="max-w-md text-sm" style={{ color: "var(--text-secondary, #a29aaf)" }}>
          {killSwitch
            ? "We've paused the public demo for now."
            : "The demo lane is currently turned off."}{" "}
          Sign up for a free account to keep building with LiTT in the full Studio.
        </p>
        <Link
          href="/sign-in?redirect_url=/demo"
          className="rounded-xl px-6 py-3 text-sm font-bold"
          style={{ backgroundColor: LIME, color: "#0a0f02" }}
        >
          Sign up free
        </Link>
      </div>
    );
  }

  const signedInBanner = isSignedIn ? (
    <div
      data-testid="demo-continue-banner"
      className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5"
      style={{ borderColor: `${LIME}33`, backgroundColor: `${LIME}0d` }}
    >
      <div className="text-sm">
        <span className="font-bold" style={{ color: LIME }}>
          You&apos;re signed in.
        </span>{" "}
        <span style={{ color: "var(--text-secondary, #a29aaf)" }}>
          {messages.length > 1
            ? `Pick up your demo thread (${messages.length - 1} messages) in the full Studio.`
            : "Open the full Studio to keep building."}
        </span>
      </div>
      <Link
        href="/studio"
        data-testid="demo-continue-studio"
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold"
        style={{ backgroundColor: LIME, color: "#0a0f02" }}
      >
        Continue in Studio <ArrowRight size={16} />
      </Link>
    </div>
  ) : null;

  return (
    <div
      data-testid="demo-studio"
      className="flex h-dvh flex-col overflow-hidden"
      style={{ backgroundColor: "var(--studio-bg, #08060f)", color: "var(--text-primary, #f5f1fa)" }}
    >
      {/* ── Top bar: real Studio chrome, honest demo badge ─────────── */}
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b px-3 sm:px-4"
        style={{ borderColor: "var(--studio-border, rgba(155,77,255,0.12))", backgroundColor: "var(--studio-surface, #0d0916)" }}
      >
        <div className="flex items-center gap-3">
          <span className="text-base font-black tracking-tight">
            LiTT
          </span>
          <span
            data-testid="demo-badge"
            className="rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest"
            style={{ borderColor: `${LIME}55`, color: LIME }}
          >
            Demo — limited preview
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="hidden text-xs sm:inline"
            style={{ color: "var(--text-secondary, #a29aaf)" }}
            data-testid="demo-remaining"
          >
            {remaining} of {maxMessages} demo messages left
          </span>
          {isSignedIn ? (
            <Link
              href="/studio"
              className="rounded-xl px-4 py-1.5 text-sm font-bold"
              style={{ backgroundColor: LIME, color: "#0a0f02" }}
            >
              Open Studio
            </Link>
          ) : (
            <Link
              href="/sign-in?redirect_url=/demo"
              data-testid="demo-signin-top"
              className="rounded-xl px-4 py-1.5 text-sm font-bold"
              style={{ backgroundColor: LIME, color: "#0a0f02" }}
            >
              Sign in
            </Link>
          )}
        </div>
      </header>

      {signedInBanner}

      <div className="flex min-h-0 flex-1">
        {/* ── Capability rail: visible, gated — never executes ─────── */}
        <nav
          aria-label="Studio capabilities"
          className="flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3"
          style={{ borderColor: "var(--studio-border, rgba(155,77,255,0.12))", backgroundColor: "var(--studio-surface, #0d0916)" }}
        >
          {CAPABILITIES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-testid={`demo-cap-${id}`}
              title={`${label} — sign up to unlock`}
              aria-label={`${label} (sign up to unlock)`}
              onClick={() => openWall(label)}
              className="grid h-11 w-11 place-items-center rounded-xl transition hover:opacity-100"
              style={{ color: "var(--text-muted, #8a8299)", opacity: 0.75 }}
            >
              <Icon size={20} />
            </button>
          ))}
          <div className="mt-auto px-1 text-center text-[9px] leading-tight" style={{ color: "var(--text-muted, #8a8299)" }}>
            Sign up to unlock
          </div>
        </nav>

        {/* ── Chat panel ─────────────────────────────────────────── */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            data-testid="demo-messages"
            className="flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-8"
            role="log"
            aria-live="polite"
            aria-label="Demo conversation"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[70%]"
                  style={
                    m.role === "user"
                      ? { backgroundColor: `${LIME}1a`, border: `1px solid ${LIME}44`, color: "var(--text-primary, #f5f1fa)" }
                      : { backgroundColor: "var(--studio-card, rgba(20,15,31,0.72))", border: "1px solid var(--studio-border, rgba(155,77,255,0.12))", color: "var(--text-primary, #f5f1fa)" }
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm"
                  style={{ backgroundColor: "var(--studio-card, rgba(20,15,31,0.72))", color: "var(--text-secondary, #a29aaf)" }}
                >
                  <Loader2 size={16} className="animate-spin" style={{ color: LIME }} />
                  LiTT is thinking…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div
              role="alert"
              className="mx-4 mb-2 rounded-xl border px-4 py-2.5 text-sm sm:mx-8"
              style={{ borderColor: "rgba(239,68,68,0.4)", backgroundColor: "rgba(239,68,68,0.08)", color: "#fca5a5" }}
            >
              {error}
            </div>
          )}

          {/* ── Composer ─────────────────────────────────────────── */}
          <div
            className="shrink-0 border-t px-4 py-3 sm:px-8"
            style={{ borderColor: "var(--studio-border, rgba(155,77,255,0.12))", backgroundColor: "var(--studio-surface, #0d0916)" }}
          >
            {remaining === 0 ? (
              <button
                type="button"
                data-testid="demo-limit-cta"
                onClick={() => openWall()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold"
                style={{ backgroundColor: LIME, color: "#0a0f02" }}
              >
                <Sparkles size={16} /> {DEMO_LIMIT_MESSAGE}
              </button>
            ) : (
              <form
                data-testid="demo-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
                className="flex items-end gap-2"
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask LiTT anything… (demo chat only — building unlocks after signup)"
                  aria-label="Message LiTT"
                  maxLength={4000}
                  disabled={sending}
                  className="min-w-0 flex-1 rounded-2xl border px-4 py-3 text-sm outline-none placeholder:text-[var(--text-muted)]"
                  style={{
                    backgroundColor: "var(--bg-elevated, #0d0917)",
                    borderColor: "var(--studio-border-strong, rgba(155,77,255,0.22))",
                    color: "var(--text-primary, #f5f1fa)",
                  }}
                />
                <button
                  type="submit"
                  data-testid="demo-send"
                  disabled={sending || !input.trim()}
                  aria-label="Send message"
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl font-bold transition disabled:opacity-40"
                  style={{ backgroundColor: LIME, color: "#0a0f02" }}
                >
                  {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                </button>
              </form>
            )}
            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--text-muted, #8a8299)" }}>
              Demo chat is limited to {maxMessages} messages and can&apos;t build, run code, or deploy.{" "}
              <button type="button" onClick={() => openWall()} className="underline" style={{ color: LIME }}>
                Sign up free
              </button>{" "}
              for the full Studio.
            </p>
          </div>
        </main>
      </div>

      {/* ── Signup wall ──────────────────────────────────────────── */}
      {wallOpen && (
        <div
          data-testid="signup-wall"
          role="dialog"
          aria-modal="true"
          aria-label="Sign up to continue"
          className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
          onClick={() => setWallOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border p-6 text-center"
            style={{ backgroundColor: "var(--studio-surface, #0d0916)", borderColor: `${LIME}44` }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setWallOpen(false)}
              className="float-right grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10"
              style={{ color: "var(--text-muted, #8a8299)" }}
            >
              <X size={16} />
            </button>
            <div
              className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl"
              style={{ backgroundColor: `${LIME}1a`, border: `1px solid ${LIME}55` }}
            >
              <Sparkles size={22} style={{ color: LIME }} />
            </div>
            <h2 className="text-xl font-black">{DEMO_LIMIT_MESSAGE}</h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-secondary, #a29aaf)" }}>
              {wallCapability ? (
                <>
                  <span className="font-bold" style={{ color: "var(--text-primary, #f5f1fa)" }}>{wallCapability}</span>{" "}
                  lives in the full Studio — along with the builder, live previews, agents, terminal, and deploys.
                </>
              ) : (
                "You've used your demo messages. Create a free account to keep chatting with LiTT and unlock the full Studio — builder, live previews, agents, terminal, and deploys."
              )}{" "}
              Your demo conversation is saved on this device and comes with you.
            </p>
            <Link
              href="/sign-in?redirect_url=/demo"
              data-testid="signup-wall-cta"
              className="mt-5 block w-full rounded-2xl px-4 py-3.5 text-sm font-black"
              style={{ backgroundColor: LIME, color: "#0a0f02" }}
            >
              Sign up free — keep building
            </Link>
            <button
              type="button"
              onClick={() => setWallOpen(false)}
              className="mt-3 text-xs underline"
              style={{ color: "var(--text-muted, #8a8299)" }}
            >
              Keep looking around the demo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
