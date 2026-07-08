"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useLiTAssistant } from "@/context/LiTAssistantContext";
import { useLiTVoice } from "@/hooks/useLiTVoice";
import {
  Bot,
  X,
  Send,
  Trash2,
  Sparkles,
  Terminal,
  Image as ImageIcon,
  Wand2,
  Loader2,
  ChevronRight,
  Mic,
  Volume2,
  VolumeX,
  AlertCircle,
} from "lucide-react";

export default function GlobalLiTAssistant() {
  const { resolvedColors: T } = useTheme();
  const {
    open,
    setOpen,
    messages,
    tasks,
    sendMessage,
    clearChat,
    clearTasks,
    setOnNavigate,
    voiceMode,
    setVoiceMode,
  } = useLiTAssistant();
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSpokenIdRef = useRef<string | null>(null);

  useEffect(() => {
    setOnNavigate((href: string) => {
      if (!href) return;
      router.push(href);
      setOpen(false);
    });
  }, [router, setOnNavigate, setOpen]);

  const onVoiceTranscript = async (text: string) => {
    setInput(text);
    await sendMessage(text);
  };

  const {
    state: voiceState,
    transcript: voiceTranscript,
    errorMessage: voiceErrorMessage,
    isSupported,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  } = useLiTVoice({
    onTranscript: onVoiceTranscript,
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, tasks, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Speak only the newest assistant reply once; never repeat old messages
  useEffect(() => {
    if (!voiceMode) return;
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last && last.id !== lastSpokenIdRef.current) {
      lastSpokenIdRef.current = last.id;
      speak(last.content);
    }
  }, [messages, voiceMode, speak]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    await sendMessage(text);
    setLoading(false);
  };

  const handleQuickAction = (prompt: string) => {
    setInput(prompt);
    sendMessage(prompt);
  };

  const toggleVoice = () => {
    if (voiceState === "listening") {
      stopListening();
      return;
    }
    setVoiceMode(true);
    setOpen(true);
    stopSpeaking();
    startListening();
  };

  const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "pending");
  const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "error");

  return (
    <>
      {/* Floating LiT Button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 hidden items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-bold shadow-2xl transition-all hover:scale-105 active:scale-95 md:flex"
        style={{
          background: `linear-gradient(135deg, ${T.accentColor}, ${T.headerColor})`,
          color: T.bgColor,
          boxShadow: `0 0 30px ${T.accentColor}50`,
        }}
      >
        {open ? <X size={18} /> : <Bot size={18} />}
        <span className="hidden sm:inline">LiT</span>
      </button>

      {/* Chat Panel */}
      {open && (
        <div
          className="fixed bottom-24 right-3 z-50 hidden max-h-[72vh] w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border shadow-2xl md:flex sm:right-6 sm:w-[420px]"
          style={{
            backgroundColor: T.boxBg,
            borderColor: T.borderColor + "40",
            backdropFilter: "blur(20px) saturate(180%)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: T.borderColor + "30" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex items-center justify-center w-7 h-7 rounded-full"
                style={{ backgroundColor: T.accentColor + "20" }}
              >
                <Sparkles size={14} style={{ color: T.accentColor }} />
              </div>
              <div>
                <div className="text-xs font-bold" style={{ color: T.textColor }}>
                  LiT Assistant
                </div>
                <div className="text-[10px]" style={{ color: T.textMuted }}>
                  Ask me anything. I route, create, and remember.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {isSupported && (
                <button
                  onClick={toggleVoice}
                  className={`p-1.5 rounded-lg transition hover:bg-white/10 ${voiceState === "listening" ? "animate-pulse" : ""}`}
                  style={{
                    color: voiceState === "listening" ? "#ff4444" : T.textMuted,
                  }}
                  title={voiceState === "listening" ? "Stop listening" : "Voice mode"}
                >
                  <Mic size={16} />
                </button>
              )}
              <button
                onClick={() => {
                  if (voiceMode) stopSpeaking();
                  setVoiceMode(!voiceMode);
                }}
                className="p-1.5 rounded-lg transition hover:bg-white/10"
                style={{ color: voiceMode ? T.accentColor : T.textMuted }}
                title={voiceMode ? "Mute voice replies" : "Speak replies"}
              >
                {voiceMode ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              <button
                onClick={() => {
                  clearChat();
                  clearTasks();
                }}
                className="p-1.5 rounded-lg transition hover:bg-white/10"
                style={{ color: T.textMuted }}
                title="Clear chat"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg transition hover:bg-white/10"
                style={{ color: T.textMuted }}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Active Tasks */}
          {activeTasks.length > 0 && (
            <div
              className="px-4 py-2 border-b"
              style={{ borderColor: T.borderColor + "20" }}
            >
              {activeTasks.map((task) => (
                <div key={task.id} className="mb-1.5 last:mb-0">
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span style={{ color: T.textMuted }}>{task.title}</span>
                    <span style={{ color: T.accentColor }}>
                      {task.progress ?? 0}%
                    </span>
                  </div>
                  <div
                    className="h-1 rounded-full overflow-hidden"
                    style={{ backgroundColor: T.borderColor + "30" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${task.progress ?? 0}%`,
                        backgroundColor: T.accentColor,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]"
          >
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-60">
                <Bot size={32} style={{ color: T.accentColor }} />
                <p className="text-xs" style={{ color: T.textMuted }}>
                  Hi, I&apos;m LiT. I persist across every page. Try:
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    { label: "Build app", icon: Wand2, prompt: "Build me a simple app" },
                    { label: "Generate image", icon: ImageIcon, prompt: "Generate a hero image" },
                    { label: "Chat with LiT", icon: Terminal, prompt: "Hi LiT, what can you do?" },
                  ].map((a) => (
                    <button
                      key={a.label}
                      onClick={() => handleQuickAction(a.prompt)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition hover:bg-white/10"
                      style={{ color: T.accentColor, border: `1px solid ${T.accentColor}30` }}
                    >
                      <a.icon size={11} />
                      {a.label}
                      <ChevronRight size={10} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "rounded-br-none"
                        : m.role === "error"
                          ? "rounded-bl-none"
                          : "rounded-bl-none"
                    }`}
                    style={{
                      backgroundColor:
                        m.role === "user"
                          ? T.accentColor
                          : m.role === "error"
                            ? "#ff444420"
                            : m.role === "progress"
                              ? T.accentColor + "10"
                              : T.boxBg + "80",
                      color:
                        m.role === "user"
                          ? T.bgColor
                          : m.role === "error"
                            ? "#ff4444"
                            : T.textColor,
                      border:
                        m.role === "progress" || m.role === "error"
                          ? "none"
                          : `1px solid ${T.borderColor}30`,
                    }}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}

            {doneTasks.length > 0 && (
              <div className="pt-2 space-y-1">
                {doneTasks.slice(-3).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg"
                    style={{
                      color: task.status === "done" ? T.success : "#ff4444",
                      backgroundColor: T.borderColor + "10",
                    }}
                  >
                    {task.status === "done" ? "✅" : "❌"} {task.title}
                  </div>
                ))}
              </div>
            )}

            {(voiceState === "listening" || voiceState === "error" || voiceState === "speaking") && (
              <div
                className="rounded-2xl border p-3"
                style={{
                  backgroundColor: voiceState === "error" ? "#ff444410" : `${T.accentColor}10`,
                  borderColor: voiceState === "error" ? "#ff444450" : `${T.accentColor}35`,
                }}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={voiceState === "listening" ? stopListening : toggleVoice}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: voiceState === "error" ? "#ff444420" : `${T.accentColor}22`,
                      color: voiceState === "error" ? "#ff4444" : T.accentColor,
                    }}
                    aria-label={voiceState === "listening" ? "Stop listening" : "Start listening"}
                  >
                    {voiceState === "error" ? <AlertCircle size={18} /> : <Mic size={18} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-black" style={{ color: voiceState === "error" ? "#ff4444" : T.textColor }}>
                      {voiceState === "listening" ? "Listening while chat stays open" : voiceState === "speaking" ? "Speaking" : "Voice needs attention"}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug" style={{ color: T.textMuted }}>
                      {voiceTranscript || voiceErrorMessage || "Speak naturally. Your words will appear here before LiT replies."}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="p-3 border-t"
            style={{ borderColor: T.borderColor + "30" }}
          >
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask LiT..."
                className="flex-1 bg-transparent px-3 py-2 text-xs outline-none rounded-lg"
                style={{
                  color: T.textColor,
                  border: `1px solid ${T.borderColor}40`,
                }}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="flex items-center justify-center w-9 h-9 rounded-lg transition disabled:opacity-40"
                style={{
                  backgroundColor: T.accentColor,
                  color: T.bgColor,
                }}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </form>
        </div>
      )}

    </>
  );
}
