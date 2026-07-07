"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import {
  Sparkles,
  X,
  Send,
  Lightbulb,
  ShieldCheck,
  Wand2,
  Navigation,
} from "lucide-react";
import { useLitChat, type LiTMessage } from "@/store/lit-chat";
import { detectIntent, buildNavigationMessage } from "@/lib/intent-router";
import { scanPrompt, suggestPromptRewrite } from "@/lib/lit-tip";
import { actionFromIntent, actionMessage, executeAction } from "@/lib/lit-actions";
import { LC } from "@/components/lit-console/lit-console-theme";

export default function LiTDock() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useUser();
  const {
    messages,
    isOpen,
    loading,
    addMessage,
    updateMessage,
    setOpen,
    toggleOpen,
    setLoading,
    setRoute,
  } = useLitChat();

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Track route changes
  useEffect(() => {
    setRoute(pathname);
  }, [pathname, setRoute]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: LiTMessage = {
      id: Math.random().toString(36).slice(2),
      role: "user",
      content: text,
      ts: Date.now(),
    };
    addMessage(userMsg);
    setInput("");
    setLoading(true);

    // 1. Detect intent and execute action in the background
    const intent = detectIntent(text);
    const navMsg = buildNavigationMessage(intent);

    if (intent.isAmbiguous && intent.suggestions.length > 0) {
      addMessage({
        id: Math.random().toString(36).slice(2),
        role: "lit",
        content: navMsg,
        ts: Date.now(),
      });
      setLoading(false);
      return;
    }

    const action = actionFromIntent(text, intent);
    if (action) {
      const isNavigate = action.type === "navigate";
      const actionId = Math.random().toString(36).slice(2);
      addMessage({
        id: actionId,
        role: "lit",
        content: isNavigate ? navMsg : actionMessage(action),
        ts: Date.now(),
        meta: { action: { type: action.type }, status: "running" },
      });

      const result = await executeAction(action);

      updateMessage(actionId, {
        content: result.ok ? (isNavigate ? navMsg : result.message) : result.error || "Failed.",
        meta: { action: { type: result.action?.type || action.type }, status: result.ok ? "done" : "error" },
      });

      if (result.ok && result.images && result.images.length > 0) {
        addMessage({
          id: Math.random().toString(36).slice(2),
          role: "lit",
          content: "Here is your image:",
          ts: Date.now(),
          meta: { images: result.images },
        });
      }

      const targetPath = isNavigate
        ? (action as { path: string }).path
        : intent.route?.path;
      if (targetPath) {
        setTimeout(() => router.push(targetPath), isNavigate ? 800 : 1200);
      }

      setLoading(false);
      return;
    }

    // 2. Fall back to /api/jarvis/think for general questions
    const toolId = Math.random().toString(36).slice(2);
    addMessage({
      id: toolId,
      role: "tool",
      content: "LiT is thinking...",
      ts: Date.now(),
      meta: { tool: "think", status: "running" },
    });

    try {
      const res = await fetch("/api/jarvis/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: {
            route: pathname,
            terminalOutput: "",
            commandHistory: [],
            logs: [],
            fileTree: [],
            agents: [{ name: "LiT", status: "online" }],
            websocketStatus: "offline",
          },
          userContext: {
            username: user?.username || user?.firstName || undefined,
            plan: (user as unknown as { publicMetadata?: { plan?: string } })?.publicMetadata?.plan || undefined,
          },
        }),
      });
      const data = await res.json();
      const answer = data.error
        ? `Error: ${data.error}`
        : data.answer || "I couldn't process that.";

      updateMessage(toolId, {
        content: "",
        meta: { tool: "think", status: "done" },
      });

      addMessage({
        id: Math.random().toString(36).slice(2),
        role: "lit",
        content: answer,
        ts: Date.now(),
      });

      // Auto-navigate if the AI returned a navigate action
      const navAction = data.actions?.find(
        (a: { type: string; url?: string }) => a.type === "navigate" && a.url,
      );
      if (navAction?.url) {
        setTimeout(() => router.push(navAction.url), 1000);
      }
    } catch {
      updateMessage(toolId, {
        content: "LiT failed to respond.",
        meta: { tool: "think", status: "error" },
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, addMessage, updateMessage, setLoading, router, pathname, user]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // LiT-Tip scan
  const tip = input.trim() ? scanPrompt(input, "director", "gemini-2.5-flash") : null;
  const rewrite = tip ? suggestPromptRewrite(input, tip.missing) : undefined;

  const applyRewrite = () => {
    if (rewrite && rewrite !== input) setInput(rewrite);
  };

  const addStopRule = () => {
    if (!input.includes("Stop condition"))
      setInput(input.trim() + "\n\nStop condition: stop after one attempt and ask for approval before continuing.");
  };

  // Don't show on auth pages
  const PUBLIC_ROUTES = ["/", "/sign-in", "/sign-up", "/login", "/privacy", "/terms", "/cookies"];
  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname?.startsWith(r + "/"));
  if (isPublic) return null;

  return (
    <>
      {/* Floating bubble */}
      {!isOpen && (
        <button
          onClick={toggleOpen}
          className="fixed bottom-20 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 md:bottom-6 md:right-6"
          style={{
            background: `linear-gradient(135deg, ${LC.accentCyan}, ${LC.accentPurple})`,
            boxShadow: `0 0 24px ${LC.accentCyan}40`,
          }}
          aria-label="Open LiT"
        >
          <Sparkles size={22} className="text-white" />
          {messages.length > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ backgroundColor: LC.accentOrange, color: "#000" }}
            >
              {messages.length}
            </span>
          )}
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div
          className="fixed bottom-0 right-0 z-50 flex h-[70dvh] w-full flex-col rounded-t-2xl border md:bottom-4 md:right-4 md:h-[600px] md:w-[420px] md:rounded-2xl md:border"
          style={{
            backgroundColor: LC.bg,
            borderColor: LC.border,
            boxShadow: "0 -4px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(37,37,56,0.4)",
          }}
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: LC.border }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: `linear-gradient(135deg, ${LC.accentCyan}, ${LC.accentPurple})` }}
              >
                <Sparkles size={14} className="text-white" />
              </div>
              <div>
                <div className="text-sm font-black" style={{ color: LC.text }}>
                  LiT
                </div>
                <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: LC.textMuted }}>
                  {loading ? "Thinking..." : "Online"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 transition-colors hover:bg-white/5"
              style={{ color: LC.textMuted }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl"
                  style={{ background: `linear-gradient(135deg, ${LC.accentCyan}20, ${LC.accentPurple}20)` }}
                >
                  <Sparkles size={24} style={{ color: LC.accentCyan }} />
                </div>
                <div className="text-sm font-bold" style={{ color: LC.text }}>
                  Hey{user?.firstName ? `, ${user.firstName}` : ""}! I&apos;m LiT.
                </div>
                <div className="text-xs max-w-[260px]" style={{ color: LC.textMuted }}>
                  Tell me what you want to do. I&apos;ll take you to the right tool and keep helping.
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 justify-center max-w-[280px]">
                  {["Make me a wallpaper", "Build me a landing page", "I need an agent", "Play a game"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors hover:bg-white/10"
                      style={{ backgroundColor: `${LC.bgPanel}`, color: LC.textMuted, border: `1px solid ${LC.border}` }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} onNavigate={(path) => router.push(path)} />
            ))}
          </div>

          {/* LiT-Tip mini panel */}
          {tip && input.trim() && (
            <div className="shrink-0 px-3 pb-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold" style={{ color: LC.accentCyan }}>
                  <Lightbulb size={10} className="inline" /> Score {tip.score}
                </span>
                <span
                  className="text-[9px] font-bold uppercase"
                  style={{ color: tip.risk === "low" ? "#4ade80" : tip.risk === "medium" ? "#fbbf24" : "#f87171" }}
                >
                  {tip.risk}
                </span>
                <span className="text-[9px]" style={{ color: LC.textMuted }}>
                  ~{tip.estimatedCredits.min}-{tip.estimatedCredits.max} cr
                </span>
                {rewrite && rewrite !== input && (
                  <button onClick={applyRewrite} className="text-[9px] font-bold flex items-center gap-0.5" style={{ color: LC.accentCyan }}>
                    <Wand2 size={9} /> Fix
                  </button>
                )}
                {!tip.metadata.hasStopCondition && (
                  <button onClick={addStopRule} className="text-[9px] font-bold flex items-center gap-0.5" style={{ color: LC.accentOrange }}>
                    <ShieldCheck size={9} /> Stop rule
                  </button>
                )}
                {tip.tips[0] && (
                  <span className="text-[9px] truncate" style={{ color: LC.textDim }}>
                    {tip.tips[0].message}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="shrink-0 p-3">
            <div
              className="flex items-end gap-2 rounded-xl border px-3 py-2"
              style={{ backgroundColor: LC.bgPanel, borderColor: LC.border }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Tell LiT what you want to do..."
                rows={1}
                className="max-h-24 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none"
                style={{ color: LC.text }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="flex items-center justify-center rounded-lg p-2 transition-all disabled:opacity-30"
                style={{ backgroundColor: LC.accentCyan, color: "#000" }}
                aria-label="Send"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MessageBubble({ msg, onNavigate }: { msg: LiTMessage; onNavigate: (path: string) => void }) {
  if (msg.role === "tool" && msg.meta?.status === "running") {
    return (
      <div className="flex items-center gap-2 text-xs" style={{ color: LC.textMuted }}>
        <div className="h-3 w-3 animate-pulse rounded-full" style={{ backgroundColor: LC.accentCyan }} />
        {msg.content}
      </div>
    );
  }

  if (msg.role === "tool" && msg.meta?.status === "done") {
    return null;
  }

  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";
  const hasNav = msg.meta?.action?.type === "navigate" && msg.meta?.action?.path;
  const hasImages = msg.meta?.images && msg.meta.images.length > 0;
  const isRunning = msg.meta?.status === "running";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-xl px-3 py-2 text-sm"
        style={{
          backgroundColor: isUser ? `${LC.accentCyan}15` : isSystem ? `${LC.accentOrange}10` : LC.bgPanel,
          border: `1px solid ${isUser ? `${LC.accentCyan}30` : isSystem ? `${LC.accentOrange}20` : LC.border}`,
          color: LC.text,
        }}
      >
        {hasNav && !isRunning && (
          <button
            onClick={() => onNavigate(msg.meta!.action!.path!)}
            className="mb-1.5 flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/10"
            style={{ backgroundColor: `${LC.accentCyan}18`, color: LC.accentCyan }}
          >
            <Navigation size={11} />
            Open now
          </button>
        )}
        {isRunning && (
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold" style={{ color: LC.accentCyan }}>
            <div className="h-2 w-2 animate-pulse rounded-full" style={{ backgroundColor: LC.accentCyan }} />
            Working in Studio...
          </div>
        )}
        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
        {hasImages && (
          <div className="mt-2 grid grid-cols-1 gap-2">
            {msg.meta!.images!.map((img, i) => (
              <a
                key={i}
                href={img.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-lg border"
                style={{ borderColor: LC.border }}
              >
                <img src={img.url} alt={img.prompt} className="h-auto w-full object-cover" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
