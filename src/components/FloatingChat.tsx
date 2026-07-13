"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Mic,
  Volume2,
  VolumeX,
  StopCircle,
} from "lucide-react";

type ChatMessage = {
  role: "user" | "agent";
  content: string;
};

const SUGGESTIONS = [
  "What can you do?",
  "Generate an image",
  "Build a page",
  "Recall a memory",
];

const VOICES = [
  { value: "Puck", label: "Puck", desc: "Upbeat · Male" },
  { value: "Kore", label: "Kore", desc: "Firm · Female" },
  { value: "Charon", label: "Charon", desc: "Informational · Male" },
  { value: "Fenrir", label: "Fenrir", desc: "Excitable · Male" },
  { value: "Orus", label: "Orus", desc: "Steady · Male" },
];

export function FloatingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content:
        "Hey, I'm LiTT Director — your AI crew chief. Ask me to build, generate, research, or recall memories. What's the mission?",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState("Puck");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, open]);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        voiceMenuRef.current &&
        !voiceMenuRef.current.contains(e.target as Node)
      )
        setVoiceMenuOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setLoading(true);
      try {
        const res = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: "director", message: trimmed }),
        });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Chat failed");
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: data.response || "I'm on it." },
        ]);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: `Error: ${msg}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        void processRecording(mimeType || "audio/webm");
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };

      recorder.start();
      setRecording(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "agent",
          content: "Microphone access is needed for voice input.",
        },
      ]);
    }
  };

  const processRecording = async (mimeType: string) => {
    if (!chunksRef.current.length) return;
    setTranscribing(true);
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () =>
          resolve((reader.result as string).split(",")[1] || "");
        reader.readAsDataURL(blob);
      });

      const res = await fetch("/api/media/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBytes: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error || "Transcription failed");
      const text = data.text?.trim();
      if (text) {
        setInput(text);
        void send(text);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "agent", content: "I didn't catch that. Try again?" },
        ]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Voice error: ${msg}` },
      ]);
    } finally {
      setTranscribing(false);
    }
  };

  const speak = async (text: string, idx: number) => {
    if (speaking === idx) {
      audioRef.current?.pause();
      audioRef.current = null;
      setSpeaking(null);
      return;
    }

    audioRef.current?.pause();
    audioRef.current = null;
    setSpeaking(idx);

    try {
      const res = await fetch("/api/media/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, voice }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "TTS failed");

      const audio = new Audio(data.audioBase64 as string);
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(null);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setSpeaking(null);
        audioRef.current = null;
      };
      await audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "TTS failed";
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: `Voice error: ${msg}` },
      ]);
      setSpeaking(null);
    }
  };

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-20 right-4 z-[9999] flex w-[calc(100vw-2rem)] max-w-sm flex-col rounded-2xl border border-neutral-700/50 shadow-2xl"
          style={{
            height: "min(70vh, 520px)",
            backgroundColor: "#0f0f15",
            backdropFilter: "blur(12px)",
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <div className="flex items-center gap-2">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-black"
                style={{
                  background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                  color: "#1a1a1a",
                }}
              >
                L
              </div>
              <div>
                <div className="text-xs font-black text-neutral-100">
                  LiTT Director
                </div>
                <div className="flex items-center gap-1 text-[9px] text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                  Online
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {/* Voice selector */}
              <div className="relative" ref={voiceMenuRef}>
                <button
                  onClick={() => setVoiceMenuOpen((v) => !v)}
                  aria-label="Select voice"
                  title={`Voice: ${voice}`}
                  className="flex h-7 items-center gap-1 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-2 text-[10px] font-bold text-neutral-300 transition hover:border-amber-500/30 hover:text-amber-300"
                >
                  <Volume2 size={10} />
                  {voice}
                </button>
                {voiceMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-36 rounded-lg border border-neutral-700/50 bg-[#16161d] py-1 shadow-xl">
                    {VOICES.map((v) => (
                      <button
                        key={v.value}
                        onClick={() => {
                          setVoice(v.value);
                          setVoiceMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] transition hover:bg-white/5 ${
                          voice === v.value
                            ? "text-amber-400"
                            : "text-neutral-300"
                        }`}
                      >
                        <span className="font-bold">{v.label}</span>
                        <span className="text-neutral-500">{v.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
                aria-label="Close chat"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`group relative max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "rounded-br-sm bg-amber-500/20 text-amber-100"
                      : "rounded-bl-sm bg-neutral-800/80 text-neutral-200"
                  }`}
                >
                  {m.content}
                  {m.role === "agent" && (
                    <button
                      onClick={() => void speak(m.content, i)}
                      disabled={loading || transcribing}
                      className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 transition group-hover:opacity-100 disabled:opacity-30"
                      style={{ color: speaking === i ? "#fbbf24" : "#737373" }}
                      title={speaking === i ? "Stop speaking" : "Read aloud"}
                      aria-label={
                        speaking === i ? "Stop speaking" : "Read aloud"
                      }
                    >
                      {speaking === i ? (
                        <VolumeX size={12} />
                      ) : (
                        <Volume2 size={12} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-800/80 px-3 py-2 text-sm text-neutral-400">
                  <Loader2 size={12} className="animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && !loading && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-full border border-neutral-700/50 bg-neutral-800/40 px-2.5 py-1 text-[10px] font-bold text-neutral-400 transition hover:border-amber-500/30 hover:text-amber-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 border-t border-neutral-800 px-3 py-3">
            <button
              onClick={() => void toggleRecording()}
              disabled={loading || transcribing}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition disabled:opacity-40 ${
                recording
                  ? "animate-pulse bg-red-500/20 text-red-400"
                  : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
              }`}
              style={
                recording
                  ? {}
                  : {
                      border: "1px solid #52525240",
                      backgroundColor: "#17171780",
                    }
              }
              title={recording ? "Stop recording" : "Voice input"}
              aria-label={recording ? "Stop recording" : "Voice input"}
            >
              {recording ? (
                <StopCircle size={14} />
              ) : transcribing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Mic size={14} />
              )}
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={recording ? "Listening…" : "Ask LiTT Director…"}
              disabled={loading || recording || transcribing}
              className="flex-1 rounded-xl border border-neutral-700/50 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-amber-500/40"
            />
            <button
              onClick={() => void send(input)}
              disabled={loading || !input.trim() || recording || transcribing}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-neutral-900 transition disabled:opacity-40"
              style={{
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
              }}
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-4 right-4 z-[9999] flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-110 active:scale-95"
        style={{
          background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          boxShadow: "0 4px 20px rgba(251, 191, 36, 0.3)",
        }}
        aria-label={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          <X size={22} className="text-neutral-900" />
        ) : (
          <MessageCircle size={22} className="text-neutral-900" />
        )}
        {!open && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
        )}
      </button>
    </>
  );
}
