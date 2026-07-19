"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { LiTTMessageAvatar, UserMessageAvatar } from "@/components/chat/MessageAvatar";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Mic,
  Volume2,
  VolumeX,
  StopCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Camera,
} from "lucide-react";

type ChatMessage = {
  role: "user" | "agent";
  content: string;
};

type Toast = {
  id: string;
  message: string;
  retry?:
    | { type: "send"; text: string }
    | { type: "record" }
    | { type: "speak"; text: string; idx: number };
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
  const { profile } = useProfile();
  const { tokens } = useTheme();
  const userName = profile?.displayName || "Member";
  const [chatOpen, setChatOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  const [desktopExpanded, setDesktopExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      content: `Hey ${userName}, I'm LiTT Director — your AI crew chief. Ask me to build, generate, research, or recall memories. What's the mission?`,
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [voice, setVoice] = useState("Puck");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState<number | null>(null);
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [voicePreviewLoading, setVoicePreviewLoading] = useState(false);
  const [voicePreviewError, setVoicePreviewError] = useState<string | null>(
    null,
  );
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const sendRef = useRef<(text: string) => void>(() => {});
  const retryRecordRef = useRef<() => void>(() => {});
  const retrySpeakRef = useRef<(text: string, idx: number) => void>(() => {});
  const speakRef = useRef<(text: string, idx: number) => void>(() => {});

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Update greeting when profile name changes
  useEffect(() => {
    const id = setTimeout(() => {
      setMessages((prev) => {
        if (prev.length === 1 && prev[0].role === "agent") {
          return [
            {
              role: "agent" as const,
              content: `Hey ${userName}, I'm LiTT Director — your AI crew chief. Ask me to build, generate, research, or recall memories. What's the mission?`,
            },
          ];
        }
        return prev;
      });
    }, 0);
    return () => clearTimeout(id);
  }, [userName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, chatOpen]);

  useEffect(() => {
    if (chatOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [chatOpen]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    };
  }, []);

  const closeCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
    setCameraMode(false);
  }, []);

  const openLauncher = useCallback(() => {
    if (window.matchMedia("(max-width: 767px)").matches) {
      setQuickActionsOpen(true);
      return;
    }
    setChatOpen(true);
  }, []);

  const showToast = useCallback(
    (
      message: string,
      retry?:
        | { type: "send"; text: string }
        | { type: "record" }
        | { type: "speak"; text: string; idx: number },
    ) => {
      const id = Math.random().toString(36).slice(2);
      setToasts((prev) => [...prev, { id, message, retry }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 6000);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const openCamera = useCallback(async () => {
    setQuickActionsOpen(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Camera access needs a secure HTTPS connection.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraMode(true);
      requestAnimationFrame(() => {
        if (cameraVideoRef.current) cameraVideoRef.current.srcObject = stream;
      });
    } catch (err) {
      const error = err as DOMException;
      showToast(
        error.name === "NotAllowedError"
          ? "Camera permission was denied. Allow it in your browser and try again."
          : "LiTT couldn't start the camera. Check that another app isn't using it.",
      );
    }
  }, [showToast]);

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
        const reply = data.response || "I'm on it.";
        const newIdx = messages.length + 1;
        setMessages((prev) => [...prev, { role: "agent", content: reply }]);
        if (autoSpeak) {
          // slight delay so the UI renders first
          setTimeout(() => void speakRef.current(reply, newIdx), 300);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong.";
        showToast(msg, { type: "send", text: trimmed });
      } finally {
        setLoading(false);
      }
    },
    [loading, showToast, autoSpeak, messages.length],
  );

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  // Listen for external chat triggers (e.g. MissionCanvas starter buttons)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | null;
      if (!detail?.text) return;
      setChatOpen(true);
      setTimeout(() => send(detail.text!), 50);
    };
    window.addEventListener("litt-chat-trigger", handler);
    return () => window.removeEventListener("litt-chat-trigger", handler);
  }, [send]);

  // Listen for external open requests (e.g. "Talk to LiTT" buttons)
  useEffect(() => {
    const handler = () => setChatOpen(true);
    window.addEventListener("litt-chat-open", handler);
    return () => window.removeEventListener("litt-chat-open", handler);
  }, []);

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

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      showToast(
        "Voice input needs a secure connection (HTTPS). Try the live site at litlabs.net.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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
        window.dispatchEvent(
          new CustomEvent("litt-voice", { detail: { active: false } }),
        );
        void processRecording(mimeType || "audio/webm");
      };

      recorder.onerror = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        window.dispatchEvent(
          new CustomEvent("litt-voice", { detail: { active: false } }),
        );
        showToast("Recording failed. Try again.", { type: "record" });
      };

      recorder.start();
      setRecording(true);
      window.dispatchEvent(
        new CustomEvent("litt-voice", { detail: { active: true } }),
      );
    } catch (err) {
      const e = err as DOMException;
      let hint = "Microphone access is needed for voice input.";
      if (
        e?.name === "NotAllowedError" ||
        e?.name === "PermissionDeniedError"
      ) {
        hint =
          "Microphone permission was denied. Allow access in your browser bar and try again.";
      } else if (
        e?.name === "NotFoundError" ||
        e?.name === "DevicesNotFoundError"
      ) {
        hint = "No microphone found. Connect a mic or headset and try again.";
      } else if (
        e?.name === "NotReadableError" ||
        e?.name === "TrackStartError"
      ) {
        hint =
          "Your microphone is busy or blocked by another app. Close other apps using the mic and try again.";
      } else if (e?.name === "OverconstrainedError") {
        hint =
          "Your mic doesn't support the required audio constraints. Try a different device.";
      } else if (e?.name === "SecurityError") {
        hint =
          "Voice input requires HTTPS. The live site at litlabs.net supports this.";
      } else if (e?.message) {
        hint = `Mic error: ${e.message}`;
      }
      showToast(hint, { type: "record" });
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
        setVoiceMode(false);
        setChatOpen(true);
        void send(text);
      } else {
        showToast("Didn't catch that. Try again?", { type: "record" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transcription failed";
      showToast(`Voice error: ${msg}`, { type: "record" });
    } finally {
      setTranscribing(false);
    }
  };

  const speak = async (text: string, idx: number) => {
    if (speaking === idx) {
      audioRef.current?.pause();
      window.speechSynthesis.cancel();
      audioRef.current = null;
      setSpeaking(null);
      return;
    }

    audioRef.current?.pause();
    window.speechSynthesis.cancel();
    audioRef.current = null;
    setSpeaking(idx);

    const fallbackToBrowserTTS = () => {
      if (!window.speechSynthesis) return false;
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.05;
      utter.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const enVoice = voices.find((v) => v.lang.startsWith("en"));
      if (enVoice) utter.voice = enVoice;
      utter.onend = () => setSpeaking(null);
      utter.onerror = () => setSpeaking(null);
      window.speechSynthesis.speak(utter);
      return true;
    };

    // Split into sentence chunks for faster first-audio
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
    const chunks = sentences.length > 0 ? sentences : [text];
    const queue: HTMLAudioElement[] = [];
    const cancelled = false;
    let firstPlayed = false;

    const playNext = () => {
      if (cancelled) return;
      const audio = queue.shift();
      if (!audio) {
        setSpeaking(null);
        audioRef.current = null;
        return;
      }
      audioRef.current = audio;
      audio.onended = () => {
        if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
        playNext();
      };
      audio.onerror = () => {
        if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
        playNext();
      };
      audio.play().catch(() => {
        if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
        playNext();
      });
    };

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (cancelled) return;
        const chunk = chunks[i].trim();
        if (!chunk) continue;

        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, voice }),
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const src = URL.createObjectURL(blob);
        const audio = new Audio(src);
        queue.push(audio);

        if (!firstPlayed) {
          firstPlayed = true;
          playNext();
        }
      }
    } catch (err) {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : "TTS failed";
      if (!firstPlayed && !fallbackToBrowserTTS()) {
        showToast(`Voice error: ${msg}`, { type: "speak", text, idx });
      }
      if (!firstPlayed) setSpeaking(null);
    }
  };

  useEffect(() => {
    retryRecordRef.current = () => void toggleRecording();
    retrySpeakRef.current = (text: string, idx: number) =>
      void speak(text, idx);
    speakRef.current = (text: string, idx: number) => void speak(text, idx);
  });

  const chatPanel = chatOpen && (
    <div
      className={`fixed inset-0 z-9999 flex flex-col bg-[#080910] md:inset-auto md:right-6 md:bottom-24 md:rounded-2xl md:border md:border-neutral-800 md:shadow-2xl ${
        desktopExpanded
          ? "md:h-[650px] md:w-[420px]"
          : "md:h-[520px] md:w-[380px]"
      }`}
      style={{ backdropFilter: "blur(12px)" }}
      role="dialog"
      aria-modal="true"
      aria-label="LiTT Director chat"
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <LiTTMessageAvatar size={28} />
          <div>
            <div className="text-xs font-black text-neutral-100">
              LiTT Director · {userName}
            </div>
            <div
              className="flex items-center gap-1 text-[9px]"
              style={{ color: tokens.success }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              Available
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Voice selector */}
          <button
            onClick={() => setVoiceMenuOpen(true)}
            aria-label="Select voice"
            title={`Voice: ${voice}`}
            className="flex h-7 items-center gap-1 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-2 text-[10px] font-bold text-neutral-300 transition hover:border-white/20 hover:text-white"
          >
            <Volume2 size={10} />
            {voice}
          </button>

          {/* Desktop expand/collapse toggle */}
          <button
            onClick={() => setDesktopExpanded((v) => !v)}
            className="hidden rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 md:block"
            aria-label={desktopExpanded ? "Collapse chat" : "Expand chat"}
            title={desktopExpanded ? "Collapse chat" : "Expand chat"}
          >
            {desktopExpanded ? (
              <ChevronDown size={16} />
            ) : (
              <ChevronUp size={16} />
            )}
          </button>

          <button
            onClick={() => setChatOpen(false)}
            className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Voice picker modal */}
      {voiceMenuOpen && (
        <div
          className="absolute inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm md:items-center"
          onClick={(e) => {
            if (e.target === e.currentTarget) setVoiceMenuOpen(false);
          }}
        >
          <div className="w-full max-w-xs rounded-2xl border border-neutral-700/50 bg-[#16161d] p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-black text-white">
                Choose a voice
              </span>
              <button
                onClick={() => setVoiceMenuOpen(false)}
                className="rounded-lg p-1 text-neutral-400 hover:bg-neutral-800"
              >
                <X size={14} />
              </button>
            </div>
            <div className="space-y-1">
              {VOICES.map((v) => (
                <button
                  key={v.value}
                  onClick={() => {
                    setVoice(v.value);
                    setVoiceMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-[10px] transition hover:bg-white/5 ${
                    voice === v.value ? "text-white" : "text-neutral-300"
                  }`}
                  style={{
                    backgroundColor:
                      voice === v.value ? `${tokens.primary}20` : undefined,
                  }}
                >
                  <span className="font-bold">{v.label}</span>
                  <span className="text-neutral-500">{v.desc}</span>
                </button>
              ))}
            </div>
            {voicePreviewError && (
              <div className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-[10px] text-red-300">
                {voicePreviewError}
              </div>
            )}
            <button
              onClick={async () => {
                setVoicePreviewError(null);
                setVoicePreviewLoading(true);
                try {
                  await speak(`Hi, I'm ${voice}. Ready when you are.`, -1);
                } catch {
                  setVoicePreviewError(
                    "Preview failed. Browser voice will be used.",
                  );
                } finally {
                  setVoicePreviewLoading(false);
                }
              }}
              disabled={voicePreviewLoading}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-xs font-bold disabled:opacity-50"
              style={{ background: tokens.primary, color: "#0a0a0f" }}
            >
              {voicePreviewLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Volume2 size={14} />
              )}
              Preview voice
            </button>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-neutral-700/50 bg-neutral-900/60 px-3 py-2">
              <span className="text-[10px] text-neutral-300">
                Read replies aloud
              </span>
              <button
                onClick={() => setAutoSpeak((v) => !v)}
                className={`relative h-5 w-9 rounded-full transition ${autoSpeak ? "bg-cyan-500" : "bg-neutral-600"}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${autoSpeak ? "left-[18px]" : "left-0.5"}`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            {m.role === "user" ? (
              <UserMessageAvatar size={28} />
            ) : (
              <LiTTMessageAvatar size={28} />
            )}
            <div
              className={`group relative max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-sm"
                  : "rounded-bl-sm bg-neutral-800/80 text-neutral-200"
              }`}
              style={
                m.role === "user"
                  ? {
                      backgroundColor: `${tokens.primary}20`,
                      color: tokens.text,
                    }
                  : undefined
              }
            >
              {m.content}
              {m.role === "agent" && (
                <button
                  onClick={() => void speak(m.content, i)}
                  disabled={loading || transcribing}
                  className="absolute -right-7 top-1/2 -translate-y-1/2 rounded-full bg-neutral-900/80 p-1.5 opacity-100 transition hover:bg-neutral-800 disabled:opacity-30 md:opacity-0 md:group-hover:opacity-100"
                  style={{ color: speaking === i ? tokens.primary : "#737373" }}
                  title={speaking === i ? "Stop speaking" : "Read aloud"}
                  aria-label={speaking === i ? "Stop speaking" : "Read aloud"}
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
          <div className="flex items-end gap-2 justify-start">
            <LiTTMessageAvatar size={28} />
            <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-neutral-800/80 px-3 py-2 text-sm text-neutral-400">
              <Loader2 size={12} className="animate-spin" />
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="shrink-0 space-y-2 px-4 pt-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
            >
              <span className="min-w-0 flex-1">{t.message}</span>
              {t.retry && (
                <button
                  onClick={() => {
                    if (t.retry?.type === "send") {
                      sendRef.current(t.retry.text);
                    } else if (t.retry?.type === "record") {
                      retryRecordRef.current();
                    } else if (t.retry?.type === "speak") {
                      retrySpeakRef.current(t.retry.text, t.retry.idx);
                    }
                    dismissToast(t.id);
                  }}
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold text-red-300 transition hover:bg-red-500/20 hover:text-red-100"
                >
                  <RefreshCw size={10} />
                  Retry
                </button>
              )}
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 text-red-300 hover:text-red-100"
                aria-label="Dismiss"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {messages.length <= 1 && !loading && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2 pt-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => void send(s)}
              className="rounded-full border border-neutral-700/50 bg-neutral-800/40 px-2.5 py-1 text-[10px] font-bold text-neutral-400 transition hover:border-white/20 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex shrink-0 items-center gap-2 border-t border-neutral-800 px-3 py-3 pb-[env(safe-area-inset-bottom)]">
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
          id="floating-chat-input"
          name="floating-chat-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={recording ? "Listening…" : "Ask LiTT Director…"}
          disabled={loading || recording || transcribing}
          className="flex-1 rounded-xl border border-neutral-700/50 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-white/30"
        />
        <button
          onClick={() => void send(input)}
          disabled={loading || !input.trim() || recording || transcribing}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-neutral-900 transition disabled:opacity-40"
          style={{ background: tokens.primary }}
          aria-label="Send message"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {mounted && chatPanel && createPortal(chatPanel, document.body)}
      {mounted && quickActionsOpen &&
        createPortal(
          <div className="fixed inset-0 z-9998 flex items-end bg-black/45 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden" onClick={() => setQuickActionsOpen(false)}>
            <div className="mx-auto w-full max-w-sm rounded-3xl border border-white/10 bg-[#111119]/95 p-4 shadow-2xl" role="dialog" aria-modal="true" aria-label="LiTT assistant quick actions" onClick={(event) => event.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black text-white">LiTT Assistant</p>
                  <p className="text-xs text-neutral-400">How can I help right now?</p>
                </div>
                <button className="flex h-10 w-10 items-center justify-center rounded-full text-neutral-400 hover:bg-white/5" onClick={() => setQuickActionsOpen(false)} aria-label="Close assistant actions"><X size={18} /></button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 text-cyan-300" onClick={() => { setQuickActionsOpen(false); setChatOpen(true); }}><MessageCircle size={22} /><span className="text-xs font-bold">Ask</span></button>
                <button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-violet-400/20 bg-violet-400/5 text-violet-300" onClick={() => { setQuickActionsOpen(false); setVoiceMode(true); void toggleRecording(); }}><Mic size={22} /><span className="text-xs font-bold">Speak</span></button>
                <button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/5 text-fuchsia-300" onClick={() => void openCamera()}><Camera size={22} /><span className="text-xs font-bold">Show Camera</span></button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {mounted && voiceMode &&
        createPortal(
          <div className="fixed inset-0 z-9999 flex items-end bg-black/55 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden" onClick={() => { if (recording) recorderRef.current?.stop(); setVoiceMode(false); }}>
            <div className="mx-auto w-full max-w-sm rounded-3xl border border-violet-400/20 bg-[#111119]/95 p-5 text-center shadow-2xl" role="dialog" aria-modal="true" aria-label="Speak to LiTT" onClick={(event) => event.stopPropagation()}>
              <div className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full ${recording ? "animate-pulse bg-red-500/20 text-red-300" : "bg-violet-500/15 text-violet-300"}`}><Mic size={32} /></div>
              <p className="font-black text-white">{transcribing ? "LiTT is processing…" : recording ? "LiTT is listening" : "Voice ready"}</p>
              <p className="mt-1 text-xs text-neutral-400">Speak naturally. Your message opens in the assistant when ready.</p>
              <button className="mt-5 min-h-12 w-full rounded-2xl bg-white/8 text-sm font-bold text-white" onClick={() => { if (recording) recorderRef.current?.stop(); setVoiceMode(false); }}>{recording ? "Stop & send" : "Close"}</button>
            </div>
          </div>,
          document.body,
        )}
      {mounted && cameraMode &&
        createPortal(
          <div className="fixed inset-0 z-9999 flex items-end bg-black/70 p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden">
            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-3xl border border-fuchsia-400/20 bg-[#111119] shadow-2xl" role="dialog" aria-modal="true" aria-label="Show LiTT camera">
              <div className="flex items-center justify-between p-4"><div><p className="text-sm font-black text-white">Show LiTT</p><p className="text-xs text-neutral-400">Camera is live only while this view is open</p></div><button className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white" onClick={closeCamera} aria-label="Close camera"><X size={18} /></button></div>
              <video ref={cameraVideoRef} autoPlay playsInline muted className="aspect-[4/5] w-full bg-black object-cover" />
              <div className="flex items-center gap-2 p-4 text-xs text-emerald-300"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />LiTT can see this live preview</div>
            </div>
          </div>,
          document.body,
        )}
      <button
        onClick={openLauncher}
        className="chat-launcher flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-2 shadow-lg transition-all hover:scale-110 active:scale-95"
        style={{
          background: "#050805",
          color: "#0a0a0f",
          borderColor: tokens.primary,
          boxShadow: `0 4px 24px ${tokens.primary}55`,
        }}
        aria-label="Open LiTT Assistant"
      >
        <Image src="/brand/litt-mascot-avatar.png" alt="Open LiTT Assistant" fill className="object-cover" style={{ objectPosition: "50% 40%" }} />
        {!chatOpen && (
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
          </span>
        )}
      </button>
    </>
  );
}
