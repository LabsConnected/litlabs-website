"use client";

import { useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Terminal as TerminalIcon,
  Send,
  Mic,
  Paperclip,
  Sparkles,
  Volume2,
  VolumeX,
  Image as ImageIcon,
  Film,
} from "lucide-react";
import { TerminalPanel, TerminalPanelHandle } from "./TerminalPanel";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  agent?: string;
};

const SUGGESTED = [
  "Build me a landing page",
  "Generate hero image for my startup",
  "Audit my API routes",
  "Deploy current project",
];

export function ChatTerminal({
  onLogAction,
  onCommandAction,
  onConnectionChangeAction,
  onTerminalOutputAction,
  agentId = "director",
  mode: controlledMode,
  onModeChangeAction,
  onMediaGeneratedAction,
}: {
  onLogAction: (entry: string) => void;
  onCommandAction: (cmd: string) => void;
  onConnectionChangeAction: (connected: boolean) => void;
  onTerminalOutputAction: (output: string) => void;
  agentId?: string;
  mode?: "chat" | "terminal";
  onModeChangeAction?: (mode: "chat" | "terminal") => void;
  onMediaGeneratedAction?: (media: {
    type: "image" | "video";
    url: string;
    title: string;
  }) => void;
}) {
  const [internalMode, setInternalMode] = useState<"chat" | "terminal">("chat");
  const mode = controlledMode ?? internalMode;
  const setMode = (m: "chat" | "terminal") => {
    if (controlledMode === undefined) setInternalMode(m);
    onModeChangeAction?.(m);
  };
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "agent",
      content:
        "Welcome to LiTT Code. I'm Director. What do you want to build today?",
      agent: "Director",
    },
  ]);
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const nextId = () => {
    idCounter.current += 1;
    return `${idCounter.current}`;
  };
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const spokenRef = useRef<Set<string>>(new Set());
  type SpeechRecognitionResult = { transcript: string }[];
  type SpeechRecognitionEvent = {
    resultIndex: number;
    results: (SpeechRecognitionResult & { isFinal: boolean })[];
  };
  type SpeechRecognitionErrorEvent = { error?: string };
  type SpeechRec = {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
  };
  const recognitionRef = useRef<SpeechRec | null>(null);

  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const loadVoices = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return [];
    voicesRef.current = window.speechSynthesis.getVoices();
    return voicesRef.current;
  };

  const speak = (text: string, id: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\[.*?\]|\*|`|#/g, "").slice(0, 280);
    if (!clean.trim()) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.05;
    utter.pitch = 1;
    const voices = voicesRef.current.length ? voicesRef.current : loadVoices();
    const preferred =
      voices.find((v) =>
        /Google US English|Microsoft David|Daniel|Alex|Fred|Karen|Samantha/i.test(
          v.name,
        ),
      ) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      null;
    if (preferred) utter.voice = preferred;
    utter.onstart = () => setSpeakingId(id);
    utter.onend = () =>
      setSpeakingId((current) => (current === id ? null : current));
    utter.onerror = () =>
      setSpeakingId((current) => (current === id ? null : current));
    window.speechSynthesis.speak(utter);
  };

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    loadVoices();
    const handleVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.onvoiceschanged = handleVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!speakEnabled) return;
    const lastAgent = [...messages].reverse().find((m) => m.role === "agent");
    if (lastAgent && !spokenRef.current.has(lastAgent.id)) {
      spokenRef.current.add(lastAgent.id);
      speak(lastAgent.content, lastAgent.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, speakEnabled]);

  const getSpeechRecognitionAPI = () => {
    if (typeof window === "undefined") return null;
    return (
      (window as unknown as { SpeechRecognition?: new () => SpeechRec })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition ||
      null
    );
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  };

  const startListening = () => {
    const SpeechRecognitionAPI = getSpeechRecognitionAPI();
    if (!SpeechRecognitionAPI) {
      onLogAction("[VOICE] Speech recognition not available in this browser.");
      return;
    }
    try {
      const rec = new SpeechRecognitionAPI();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.maxAlternatives = 1;
      let finalTranscript = "";
      let hasResult = false;
      rec.onresult = (event) => {
        hasResult = true;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interim += transcript;
          }
        }
        const display = finalTranscript + (interim ? " " + interim : "");
        setInput(display.trim());
      };
      rec.onerror = (event) => {
        if (event.error !== "aborted" && event.error !== "no-speech") {
          onLogAction(`[VOICE] Recognition error: ${event.error ?? "unknown"}`);
        }
        stopListening();
      };
      rec.onend = () => {
        const text = finalTranscript.trim();
        if (text) {
          setInput(text);
          if (mode === "chat") {
            setSpeakEnabled(true);
            sendChat(text);
          }
        } else if (!hasResult) {
          setInput("");
          onLogAction("[VOICE] No speech detected. Try again.");
        }
        setListening(false);
      };
      recognitionRef.current = rec;
      setInput("");
      rec.start();
      setListening(true);
      onLogAction("[VOICE] Listening...");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      onLogAction(`[VOICE] Could not start microphone: ${errorMsg}`);
      setListening(false);
    }
  };

  const toggleListening = () => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  };

  useEffect(() => {
    if (scrollRef.current && mode === "chat") {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mode]);

  const generateMedia = async (prompt: string, format: "image" | "video") => {
    if (!prompt.trim()) return;
    const actionLabel = format === "image" ? "Image" : "Video";
    onLogAction(`[${actionLabel.toUpperCase()}] Generating: ${prompt}`);
    setLoading(true);
    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, format }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Generation failed");
      }
      const url = data.downloadUrl || data.thumbUrl;
      if (!url) throw new Error("No media URL returned");
      const media = {
        type: format,
        url,
        title: data.title || `${actionLabel}: ${prompt}`,
      };
      onMediaGeneratedAction?.(media);
      onLogAction(`[${actionLabel.toUpperCase()}] Done: ${url}`);
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: `Generated your ${format} — ${prompt}`,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Generation failed";
      onLogAction(`[${actionLabel.toUpperCase()}] Error: ${errorMsg}`);
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: `Could not generate ${format}: ${errorMsg}`,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
    } finally {
      setLoading(false);
    }
  };

  const sendChat = async (text: string) => {
    if (!text.trim()) return;
    const lower = text.toLowerCase();
    if (
      /\b(make|generate|create)\b.*\b(image|picture|photo|pic)\b/i.test(lower)
    ) {
      await generateMedia(text, "image");
      return;
    }
    if (
      /\b(make|generate|create)\b.*\b(video|clip|film|movie)\b/i.test(lower)
    ) {
      await generateMedia(text, "video");
      return;
    }
    const userMsg: ChatMessage = {
      id: `u_${nextId()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    onLogAction(`[CHAT] User: ${text}`);

    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, message: text }),
      });
      const data = await res.json();
      const answer =
        data.response || data.answer || data.error || "LiTT is thinking...";
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: answer,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
      onLogAction(`[CHAT] Director: ${answer.slice(0, 120)}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      const agentMsg: ChatMessage = {
        id: `a_${nextId()}`,
        role: "agent",
        content: `Error: ${errorMsg}`,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
      onLogAction(`[CHAT] Error: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  const runAsCommand = () => {
    if (!input.trim()) return;
    if (mode === "terminal") {
      terminalRef.current?.runCommand(input);
    } else {
      // Prefix with / to treat chat as terminal command
      terminalRef.current?.runCommand(input);
      onCommandAction(input);
      onLogAction(`[CMD] ${input}`);
    }
    setInput("");
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm sm:rounded-2xl">
      {/* Header tabs */}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-neutral-800/60 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex rounded-lg border border-neutral-800/60 bg-neutral-900/60 p-0.5">
            <button
              onClick={() => setMode("chat")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all sm:px-3 ${
                mode === "chat"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => setMode("terminal")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all sm:px-3 ${
                mode === "terminal"
                  ? "bg-orange-500/15 text-orange-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <TerminalIcon size={13} /> Terminal
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <button
            onClick={() => setSpeakEnabled((v) => !v)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider transition sm:px-2.5 sm:text-[10px] ${
              speakEnabled
                ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30"
                : "text-neutral-500 hover:text-neutral-300 border border-transparent"
            } ${speakingId ? "animate-pulse" : ""}`}
            aria-label={speakEnabled ? "Mute LiTT" : "Enable LiTT voice"}
            title={
              speakEnabled ? "LiTT will speak replies" : "LiTT voice muted"
            }
          >
            {speakingId ? (
              <Volume2 size={13} className="text-cyan-300" />
            ) : speakEnabled ? (
              <Volume2 size={13} />
            ) : (
              <VolumeX size={13} />
            )}
            {speakingId ? "Speaking" : speakEnabled ? "Voice on" : "Voice off"}
          </button>
          <div className="hidden truncate text-[10px] font-bold uppercase tracking-widest text-neutral-500 min-[390px]:block">
            {mode === "chat" ? "Natural language" : "Shell execution"}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative">
        {mode === "chat" ? (
          <div
            ref={scrollRef}
            className="absolute inset-0 space-y-3 overflow-y-auto p-3 sm:p-4"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(85%,calc(100vw-48px))] overflow-hidden rounded-2xl px-3.5 py-2.5 text-sm break-words ${
                    m.role === "user"
                      ? "bg-cyan-500/15 border border-cyan-500/25 text-cyan-100"
                      : "bg-neutral-900/60 border border-neutral-800/60 text-neutral-200"
                  }`}
                >
                  {m.role === "agent" && m.agent ? (
                    <div
                      className="mb-1 text-[10px] font-black uppercase tracking-wider"
                      style={{ color: "#22d3ee" }}
                    >
                      {m.agent}
                    </div>
                  ) : null}
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl bg-neutral-900/60 border border-neutral-800/60 px-3.5 py-2.5 text-sm text-neutral-300">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs">LiTT is thinking...</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="absolute inset-0 p-2">
            <TerminalPanel
              ref={terminalRef}
              onLog={onLogAction}
              onCommand={onCommandAction}
              onConnectionChange={onConnectionChangeAction}
              onTerminalOutput={onTerminalOutputAction}
            />
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-neutral-800/60 p-2.5 sm:p-3">
        {mode === "chat" && messages.length < 3 ? (
          <div className="mb-2 flex max-w-full gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => sendChat(s)}
                className="shrink-0 rounded-full border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1 text-[10px] font-semibold text-neutral-300 transition hover:border-cyan-500/30 hover:text-cyan-300"
              >
                <Sparkles size={10} className="inline mr-1 text-cyan-500/70" />
                {s}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-neutral-800/60 bg-neutral-900/60 px-2 py-2 transition-all focus-within:border-cyan-500/40 focus-within:shadow-[0_0_12px_rgba(34,211,238,0.12)] sm:gap-2 sm:px-3">
          <button
            className="text-neutral-500 hover:text-neutral-300"
            aria-label="Attach"
          >
            <Paperclip size={16} />
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mode === "chat") {
                  sendChat(input);
                } else {
                  runAsCommand();
                }
              }
            }}
            placeholder={
              mode === "chat"
                ? "What do you want to build?"
                : "Type command and press Enter..."
            }
            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
          />
          {mode === "chat" && input.trim() && (
            <>
              <button
                onClick={() => generateMedia(input, "image")}
                className="rounded-lg bg-fuchsia-500/10 p-2 text-fuchsia-300 hover:bg-fuchsia-500/20 transition"
                aria-label="Generate image"
                title="Generate image"
              >
                <ImageIcon size={16} />
              </button>
              <button
                onClick={() => generateMedia(input, "video")}
                className="rounded-lg bg-orange-500/10 p-2 text-orange-300 hover:bg-orange-500/20 transition"
                aria-label="Generate video"
                title="Generate video"
              >
                <Film size={16} />
              </button>
            </>
          )}
          <button
            onClick={() => (mode === "chat" ? sendChat(input) : runAsCommand())}
            className="rounded-lg bg-cyan-500/15 p-2 text-cyan-300 hover:bg-cyan-500/25 transition"
            aria-label="Send"
          >
            <Send size={16} />
          </button>
          <button
            onClick={toggleListening}
            className={`rounded-lg p-2 transition ${
              listening
                ? "bg-red-500/15 text-red-300 animate-pulse"
                : "bg-neutral-800/60 text-neutral-400 hover:text-neutral-200"
            }`}
            aria-label={listening ? "Stop listening" : "Speak to LiTT"}
            title={listening ? "Listening..." : "Speak to LiTT"}
          >
            <Mic size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
