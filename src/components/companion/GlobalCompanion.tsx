"use client";

/**
 * GlobalCompanion — the site-wide LiTT companion.
 *
 * Architecture per the LiTTree LabStudios Ultra Handbook v11.0 directive:
 * - One floating LiTT launcher (NOT a floating microphone)
 * - Normal click → open/close companion panel
 * - Press and hold → optionally start voice listening
 * - Microphone lives inside the composer, not as a separate floating button
 * - Status ring reflects REAL voice state (gray/cyan/purple/green/yellow/red)
 * - Page context is sent with each message
 * - "Open in Studio" handoff for deep work
 * - "Creative with Spark" as a specialist action, not a separate assistant
 *
 * The companion uses the same /api/gemini/chat endpoint as Studio's ChatTool.
 * Voice uses useInworldSession via VoiceSessionProvider (same as Studio).
 *
 * @see src/app/studio/context/VoiceSessionContext.tsx
 * @see src/app/studio/tools/ChatTool.tsx
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useProfile } from "@/context/ProfileContext";
import { useVoiceSession } from "@/app/studio/context/VoiceSessionContext";
import { VoiceSessionProvider } from "@/app/studio/context/VoiceSessionContext";
import { AGENT_META, type ChatMessage } from "@/app/studio/stores/useStudioAgentStore";

// ---------------------------------------------------------------------------
// Page context derivation
// ---------------------------------------------------------------------------

interface CompanionContext {
  surface: "global_companion";
  route: string;
  pageTitle: string;
  activeEntity?: {
    type: "game" | "agent" | "gallery_item" | "marketplace_item" | "plan" | "project";
    id: string;
    name: string;
  };
  authenticated: boolean;
}

function derivePageContext(pathname: string, authenticated: boolean): CompanionContext {
  const route = pathname || "/";
  let pageTitle = "LiTTree LabStudios";
  let activeEntity: CompanionContext["activeEntity"];

  // Derive page title and entity from route
  if (route.startsWith("/games/")) {
    pageTitle = "Games";
    const gameId = route.split("/")[2];
    if (gameId) activeEntity = { type: "game", id: gameId, name: gameId };
  } else if (route.startsWith("/games")) {
    pageTitle = "Games";
  } else if (route.startsWith("/gallery/")) {
    pageTitle = "Gallery";
    const itemId = route.split("/")[2];
    if (itemId) activeEntity = { type: "gallery_item", id: itemId, name: itemId };
  } else if (route.startsWith("/gallery")) {
    pageTitle = "Gallery";
  } else if (route.startsWith("/marketplace/")) {
    pageTitle = "Marketplace";
    const itemId = route.split("/")[2];
    if (itemId) activeEntity = { type: "marketplace_item", id: itemId, name: itemId };
  } else if (route.startsWith("/marketplace")) {
    pageTitle = "Marketplace";
  } else if (route.startsWith("/pricing")) {
    pageTitle = "Pricing";
  } else if (route.startsWith("/agents")) {
    pageTitle = "Agents";
  } else if (route.startsWith("/dashboard")) {
    pageTitle = "Dashboard";
  } else if (route.startsWith("/docs")) {
    pageTitle = "Documentation";
  } else if (route === "/") {
    pageTitle = "Home";
  }

  return { surface: "global_companion", route, pageTitle, activeEntity, authenticated };
}

// ---------------------------------------------------------------------------
// Status ring colors
// ---------------------------------------------------------------------------

type RingColor = "gray" | "cyan" | "purple" | "green" | "yellow" | "red";

function deriveRingColor(
  voiceState: string,
  voiceInputState: string,
  voiceOutputState: string,
): RingColor {
  if (voiceState === "error") return "red";
  if (voiceState === "connecting" || voiceState === "requesting_permission") return "yellow";
  if (voiceOutputState === "speaking") return "green";
  if (voiceState === "processing" || voiceState === "assistant_speaking") return "purple";
  if (voiceInputState === "listening") return "cyan";
  return "gray";
}

const RING_COLORS: Record<RingColor, string> = {
  gray: "#6b7280",
  cyan: "#22d3ee",
  purple: "#a970ff",
  green: "#22c55e",
  yellow: "#f59e0b",
  red: "#ef4444",
};

// ---------------------------------------------------------------------------
// Companion panel (inner component — wrapped by VoiceSessionProvider)
// ---------------------------------------------------------------------------

function CompanionPanel({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useProfile();
  const {
    voiceState,
    voiceInputState,
    voiceOutputState,
    voiceTransportConnected,
    transcript,
    errorMessage,
    startVoice,
    stopVoice,
    speakText,
    setOnTurn,
    interrupt,
  } = useVoiceSession();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [withSpark, setWithSpark] = useState(false);
  const [voiceHealth, setVoiceHealth] = useState<{
    configured: boolean;
    tokenService: "healthy" | "error" | "unknown";
    available: boolean;
  }>({ configured: false, tokenService: "unknown", available: false });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const handleSendRef = useRef<(text: string) => Promise<void>>(async () => {});

  // Fetch voice health on mount + when voice state changes
  useEffect(() => {
    let active = true;
    fetch("/api/voice/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (active) {
          setVoiceHealth({
            configured: !!data.configured,
            tokenService: data.tokenService === "healthy" ? "healthy" : "error",
            available: !!data.available,
          });
        }
      })
      .catch(() => {
        if (active) {
          setVoiceHealth({ configured: false, tokenService: "unknown", available: false });
        }
      });
    return () => { active = false; };
  }, []);

  const activeAgentId = withSpark ? "spark" : "litt";
  const ringColor = deriveRingColor(voiceState, voiceInputState, voiceOutputState);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Wire voice transcript → send as message (uses ref to avoid circular dep)
  useEffect(() => {
    setOnTurn((text: string) => {
      if (text.trim()) {
        void handleSendRef.current(text);
      }
    });
  }, [setOnTurn]);

  // Auto-speak assistant responses
  const lastAssistantRef = useRef<string>("");
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === "assistant" && lastMsg.content !== lastAssistantRef.current) {
      lastAssistantRef.current = lastMsg.content;
      if (voiceTransportConnected) {
        void speakText(lastMsg.content);
      }
    }
  }, [messages, voiceTransportConnected, speakText]);

  const pageContext = useMemo(
    () => derivePageContext(pathname, !!profile),
    [pathname, profile],
  );

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setInput("");
    setBusy(true);
    const userMsg: ChatMessage = { role: "user", content: trimmed, createdAt: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const agentSlug = activeAgentId;
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug,
                    message: trimmed,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          userName: profile?.displayName || "Member",
          capabilities: {
            repository: "none",
            repositoryIndexed: false,
            terminalExecution: "unavailable",
            writeAccess: false,
            connectedProviders: [],
            availableTools: [],
            connectionSummary: "global companion",
            voiceTransportConnected,
            voiceMicrophoneOn: voiceInputState === "listening",
            voiceHealth,
          },
          // Page context so LiTT knows where the user is
          pageContext,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || err.error || "LiTT is reconnecting");
      }

      const data = await response.json();
      const reply =
        data.response || data.text || data.message || data.content ||
        "I'm here. What do you need?";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: reply, createdAt: Date.now() },
      ]);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "LiTT is reconnecting";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: msg, createdAt: Date.now() },
      ]);
    } finally {
      setBusy(false);
    }
  }, [activeAgentId, busy, messages, profile, voiceTransportConnected, voiceInputState, pageContext, voiceHealth]);

  // Keep handleSendRef in sync so the voice transcript callback always calls the latest
  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend(input);
    }
  };

  const handleMicClick = () => {
    if (voiceInputState === "listening" || voiceState === "connecting") {
      stopVoice();
    } else {
      void startVoice();
    }
  };

  const handleOpenInStudio = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const mission = lastUserMsg?.content || "";
    const url = `/studio?tool=chat&mission=${encodeURIComponent(mission)}&source=companion`;
    router.push(url);
    onClose();
  };

  const handleSparkToggle = () => {
    setWithSpark((prev) => !prev);
  };

  const statusLabel = (() => {
    if (voiceState === "error") return errorMessage || "Voice error";
    if (voiceState === "connecting") return "Connecting…";
    if (voiceState === "requesting_permission") return "Requesting mic…";
    if (voiceOutputState === "speaking") return "Speaking";
    if (voiceState === "processing") return "Thinking";
    if (voiceInputState === "listening") return "Listening";
    if (voiceTransportConnected) return "Voice ready";
    return "Idle";
  })();

  return (
    <div
      className="fixed bottom-24 right-6 z-[10000] flex w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0c13]/95 shadow-2xl backdrop-blur-xl"
      style={{ maxHeight: "75dvh" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Avatar with status ring */}
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full" style={{
            background: `radial-gradient(circle, ${RING_COLORS[ringColor]}40 0%, transparent 70%)`,
          }}>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-black"
              style={{
                borderColor: RING_COLORS[ringColor],
                color: RING_COLORS[ringColor],
                background: "#0a0c13",
              }}
            >
              {withSpark ? "✦" : "L"}
            </div>
          </div>
          <div>
            <div className="text-sm font-black text-white">
              {withSpark ? "LiTT · with Spark" : "LiTT"}
            </div>
            <div className="text-[10px] text-white/50">
              {statusLabel} · {pageContext.pageTitle}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-white/40 transition hover:text-white"
          aria-label="Close companion"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18 M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ minHeight: "200px" }}>
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="text-sm text-white/40">
              {pageContext.activeEntity
                ? `Ask about this ${pageContext.activeEntity.type.replace("_", " ")}`
                : `Here to help with ${pageContext.pageTitle}`}
            </div>
            <div className="mt-2 text-xs text-white/25">
              Type a message or tap the microphone to speak
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-cyan-500/15 text-cyan-50"
                      : withSpark
                        ? "bg-pink-500/10 text-pink-50"
                        : "bg-white/5 text-white/80"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-white/40">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                  </span>
                </div>
              </div>
            )}
            {/* Live transcript while listening */}
            {voiceInputState === "listening" && transcript && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200/70 italic">
                  {transcript}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Error banner */}
      {voiceState === "error" && errorMessage && (
        <div className="mx-4 mb-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {errorMessage}
          <button
            onClick={() => void startVoice()}
            className="ml-2 underline hover:text-red-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-white/8 px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={AGENT_META[activeAgentId].placeholder}
            rows={1}
            className="flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-300/40"
            style={{ maxHeight: "100px" }}
          />
          {/* Mic button */}
          <button
            onClick={handleMicClick}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition"
            style={{
              borderColor: voiceInputState === "listening" ? RING_COLORS.cyan : "rgba(255,255,255,0.1)",
              background: voiceInputState === "listening" ? `${RING_COLORS.cyan}20` : "transparent",
            }}
            aria-label={voiceInputState === "listening" ? "Stop voice" : "Start voice"}
            title={voiceInputState === "listening" ? "Stop listening" : "Speak to LiTT"}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={voiceInputState === "listening" ? RING_COLORS.cyan : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/60">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          </button>
          {/* Send button */}
          <button
            onClick={() => void handleSend(input)}
            disabled={!input.trim() || busy}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-300 transition hover:bg-cyan-500/30 disabled:opacity-30"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>

        {/* Secondary actions */}
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={handleSparkToggle}
            className={`rounded-lg px-2.5 py-1 text-[10px] font-bold transition ${
              withSpark
                ? "bg-pink-500/20 text-pink-300 border border-pink-300/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:text-white/70"
            }`}
          >
            ✦ Creative with Spark
          </button>
          <button
            onClick={handleOpenInStudio}
            className="rounded-lg bg-white/5 px-2.5 py-1 text-[10px] font-bold text-white/50 border border-white/10 transition hover:text-white/70"
          >
            Open in Studio →
          </button>
          {voiceOutputState === "speaking" && (
            <button
              onClick={interrupt}
              className="ml-auto rounded-lg bg-red-500/10 px-2.5 py-1 text-[10px] font-bold text-red-400 border border-red-500/20 transition hover:bg-red-500/20"
            >
              Stop speaking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Launcher + Provider wrapper
// ---------------------------------------------------------------------------

export function GlobalCompanion() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const holdTimerRef = useRef<number | null>(null);
  const didHoldRef = useRef(false);

  // Don't show on Studio (it has its own chat) or auth pages
  const hidden = pathname?.startsWith("/studio") ||
    pathname?.startsWith("/sign-in") ||
    pathname?.startsWith("/sign-up") ||
    pathname?.startsWith("/login");

  if (hidden) return null;

  const handleMouseDown = () => {
    didHoldRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      didHoldRef.current = true;
      setOpen(true);
      // Voice will start when the user taps the mic inside the panel
    }, 500);
  };

  const handleMouseUp = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (!didHoldRef.current) {
      setOpen((prev) => !prev);
    }
  };

  const handleMouseLeave = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  return (
    <VoiceSessionProvider>
      {/* Floating LiTT launcher */}
      <button
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        className="fixed bottom-6 right-6 z-[10000] flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-all hover:scale-105 active:scale-95"
        style={{
          background: "radial-gradient(circle at 30% 30%, #1a1f2e 0%, #0a0c13 70%)",
          border: "2px solid rgba(34, 211, 238, 0.3)",
          boxShadow: "0 0 24px rgba(34, 211, 238, 0.15), 0 4px 16px rgba(0,0,0,0.4)",
        }}
        aria-label="Open LiTT companion"
        title="LiTT — tap to chat, hold for voice"
      >
        <span className="text-lg font-black" style={{ color: "#22d3ee" }}>L</span>
      </button>

      {/* Companion panel */}
      {open && <CompanionPanel onClose={() => setOpen(false)} />}
    </VoiceSessionProvider>
  );
}
