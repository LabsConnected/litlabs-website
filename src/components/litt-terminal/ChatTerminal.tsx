"use client";

import { useState, useRef, useEffect, type ElementType } from "react";
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
  Hammer,
  Code2,
  Bot,
  Rocket,
  Search,
} from "lucide-react";
import { TerminalPanel, TerminalPanelHandle } from "./TerminalPanel";
import type { WorkspaceArtifact } from "./OutputPanel";
import { HoloDirector, type HoloState } from "./HoloDirector";

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  agent?: string;
};

function normalizeAgentResponse(value: string) {
  const sections = value
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  return sections
    .filter((part, index) => sections.indexOf(part) === index)
    .join("\n\n");
}

function generateRunId(counter: number) {
  return `run_${Date.now()}_${counter}`;
}

function generateArtifactId() {
  return `image_${Date.now()}`;
}

const SUGGESTED = [
  "Build me a landing page",
  "Generate hero image for my startup",
  "Audit my API routes",
  "Deploy current project",
];

type WorkMode = "ask" | "image" | "build" | "code" | "agent" | "deploy";

const WORK_MODES = [
  { id: "ask" as const, label: "Ask", icon: MessageSquare },
  { id: "image" as const, label: "Image", icon: ImageIcon },
  { id: "build" as const, label: "Build", icon: Hammer },
  { id: "code" as const, label: "Code", icon: Code2 },
  { id: "agent" as const, label: "Agent", icon: Bot },
  { id: "deploy" as const, label: "Deploy", icon: Rocket },
];

const STARTER_ACTIONS: { label: string; icon: ElementType; mode: WorkMode }[] =
  [
    { label: "Generate Image", icon: ImageIcon, mode: "image" },
    { label: "Build Page", icon: Hammer, mode: "build" },
    { label: "Fix Code", icon: Code2, mode: "code" },
    { label: "Research", icon: Search, mode: "ask" },
    { label: "Create Agent", icon: Bot, mode: "agent" },
    { label: "Deploy Preview", icon: Rocket, mode: "deploy" },
  ];

export function ChatTerminal({
  onLogAction,
  onCommandAction,
  onConnectionChangeAction,
  onTerminalOutputAction,
  onArtifactAction,
  agentId = "director",
}: {
  onLogAction: (entry: string) => void;
  onCommandAction: (cmd: string) => void;
  onConnectionChangeAction: (connected: boolean) => void;
  onTerminalOutputAction: (output: string) => void;
  onArtifactAction?: (artifact: WorkspaceArtifact) => void;
  agentId?: string;
}) {
  const [mode, setMode] = useState<"chat" | "terminal">("chat");
  const [workMode, setWorkMode] = useState<WorkMode>("ask");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [imageStyle, setImageStyle] = useState("Auto");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [holoState, setHoloState] = useState<HoloState>("idle");
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
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [listening, setListening] = useState(false);
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

  const speak = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const clean = text.replace(/\[.*?\]|\*|`|#/g, "").slice(0, 280);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.05;
    utter.pitch = 1;
    const voices = voicesRef.current.length ? voicesRef.current : loadVoices();
    const preferred =
      voices.find((v) =>
        /Google US English|Microsoft David|Daniel|Alex|Fred/i.test(v.name),
      ) ||
      voices.find(
        (v) => v.lang.startsWith("en") && v.name.toLowerCase().includes("male"),
      ) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      null;
    if (preferred) utter.voice = preferred;
    utter.onstart = () => setHoloState("speaking");
    utter.onend = () => setHoloState("complete");
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
    if (!speakEnabled || loading) return;
    messages.forEach((m) => {
      if (m.role === "agent" && !spokenRef.current.has(m.id)) {
        spokenRef.current.add(m.id);
        speak(m.content);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, speakEnabled, loading]);

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
    setHoloState("idle");
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
      rec.onresult = (event) => {
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
        onLogAction(`[VOICE] Recognition error: ${event.error ?? "unknown"}`);
        stopListening();
      };
      rec.onend = () => {
        const text = finalTranscript.trim();
        if (text) {
          setInput(text);
          if (mode === "chat") {
            sendChat(text);
          }
        }
        setListening(false);
      };
      recognitionRef.current = rec;
      setInput("");
      rec.start();
      setListening(true);
      setHoloState("listening");
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

  const sendChat = async (text: string) => {
    if (!text.trim() || loading) return;
    idCounter.current += 1;
    const runId = generateRunId(idCounter.current);
    const userMsg: ChatMessage = {
      id: `u_${runId}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setHoloState(workMode === "image" ? "working" : "planning");
    onLogAction(`[CHAT] User: ${text}`);

    try {
      if (workMode === "image") {
        onLogAction("[IMAGE] Visionary started generation");
        const imagePrompt =
          imageStyle === "Auto" ? text : `${text}. Style: ${imageStyle}`;
        const imageRes = await fetch("/api/studio/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: imagePrompt,
            aspectRatio,
            batchSize: 1,
          }),
        });
        const imageData = await imageRes.json();
        if (!imageRes.ok || !imageData.images?.[0]?.url) {
          throw new Error(imageData.error || "Image generation failed");
        }
        const image = imageData.images[0];
        const artifact: WorkspaceArtifact = {
          id: generateArtifactId(),
          type: "image",
          name: text.trim().slice(0, 42) || "Generated image",
          url: image.url,
          prompt: image.prompt || imagePrompt,
          provider: image.provider || imageData.provider || "Visionary",
        };
        onArtifactAction?.(artifact);
        setMessages((prev) => [
          ...prev,
          {
            id: `a_${runId}`,
            role: "agent",
            content:
              "Your image is ready. I opened it in the Artifact panel so you can review, download, or add it to the project.",
            agent: "Visionary",
          },
        ]);
        onLogAction("[IMAGE] Image generated successfully");
        onLogAction(`[ARTIFACT] ${artifact.id} saved`);
        setHoloState("complete");
        return;
      }

      const assistantId = `a_${runId}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "agent", content: "", agent: "Director" },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      setHoloState("working");
      const history = messages
        .filter((message) => message.id !== "welcome")
        .slice(-10)
        .map((message) => ({
          role: message.role === "agent" ? "assistant" : "user",
          content: message.content,
        }));
      const res = await fetch("/api/chat/unified", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          mode: "llm",
          agentSlug: agentId,
          message: `[${workMode.toUpperCase()}] ${text}`,
          history,
          stream: true,
        }),
      });
      if (!res.ok || !res.body)
        throw new Error(`Conversation failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";
        for (const event of events) {
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (!raw || raw === "[DONE]") continue;
            const payload = JSON.parse(raw) as {
              text?: string;
              error?: string;
            };
            if (payload.error) throw new Error(payload.error);
            if (payload.text) {
              answer += payload.text;
              const visible = normalizeAgentResponse(answer);
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? { ...message, content: visible }
                    : message,
                ),
              );
            }
          }
        }
      }
      setHoloState(speakEnabled ? "speaking" : "complete");
      onLogAction(
        `[CHAT] Director completed response (${answer.length} chars)`,
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setHoloState("idle");
        onLogAction("[CHAT] Run stopped by user");
        return;
      }
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      const agentMsg: ChatMessage = {
        id: `error_${runId}`,
        role: "agent",
        content: `Error: ${errorMsg}`,
        agent: "Director",
      };
      setMessages((prev) => [...prev, agentMsg]);
      onLogAction(`[CHAT] Error: ${errorMsg}`);
      setHoloState("error");
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  const stopRun = () => abortRef.current?.abort();

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
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm sm:rounded-2xl">
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
            }`}
            aria-label={speakEnabled ? "Mute LiTT" : "Enable LiTT voice"}
            title={
              speakEnabled ? "LiTT will speak replies" : "LiTT voice muted"
            }
          >
            {speakEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {speakEnabled ? "Voice on" : "Voice off"}
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
            {messages.length === 1 && (
              <div className="mx-auto grid min-h-full max-w-3xl content-start gap-4 py-3 sm:content-center sm:py-6">
                <div className="grid gap-4 md:grid-cols-[minmax(240px,.8fr)_1.2fr] md:items-center">
                  <div className="md:hidden">
                    <HoloDirector state={holoState} compact />
                  </div>
                  <div className="hidden md:block">
                    <HoloDirector state={holoState} />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-400">
                      Active project
                    </div>
                    <h2 className="mt-2 text-2xl font-black text-white">
                      What should LiTT make next?
                    </h2>
                    <p className="mt-1 text-sm text-neutral-500">
                      Start a mission and the canvas will show the plan,
                      progress, and result.
                    </p>
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {STARTER_ACTIONS.map(
                        ({ label, icon: Icon, mode: target }) => (
                          <button
                            key={label}
                            onClick={() => setWorkMode(target)}
                            className="rounded-xl border border-neutral-800/60 bg-neutral-900/35 p-4 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/5"
                          >
                            <Icon size={18} className="mb-3 text-cyan-400" />
                            <div className="text-xs font-bold text-neutral-200">
                              {label}
                            </div>
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {messages.length > 1 && <HoloDirector state={holoState} compact />}
            {messages.length > 1 &&
              messages
                .filter((message) => message.content)
                .map((m, index) => (
                  <div
                    key={m.id}
                    className={`relative flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    {index > 0 && (
                      <span className="absolute -top-3 left-1/2 h-3 w-px bg-neutral-800" />
                    )}
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
            {loading &&
              !messages.some(
                (message) => message.id.startsWith("a_run_") && message.content,
              ) && (
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
      <div className="shrink-0 border-t border-neutral-800/60 bg-black/90 px-2.5 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] sm:p-3">
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

        {mode === "chat" && (
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {WORK_MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setWorkMode(item.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold ${workMode === item.id ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300" : "border-neutral-800/60 text-neutral-500 hover:text-neutral-300"}`}
                >
                  <Icon size={11} /> {item.label}
                </button>
              );
            })}
          </div>
        )}

        {mode === "chat" && workMode === "image" && (
          <div className="mb-2 flex gap-2 overflow-x-auto text-[10px]">
            <select
              value={imageStyle}
              onChange={(event) => setImageStyle(event.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"
            >
              <option>Auto</option>
              <option>Logo</option>
              <option>Photoreal</option>
              <option>Illustration</option>
              <option>3D Render</option>
            </select>
            <select
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value)}
              className="rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-neutral-300"
            >
              <option>1:1</option>
              <option>16:9</option>
              <option>9:16</option>
              <option>4:3</option>
            </select>
          </div>
        )}

        <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-neutral-800/60 bg-neutral-900/60 px-2 py-2 transition-all focus-within:border-cyan-500/40 focus-within:shadow-[0_0_12px_rgba(34,211,238,0.12)] sm:gap-2 sm:px-3">
          <button
            className="text-neutral-500 hover:text-neutral-300"
            aria-label="Attach"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            rows={1}
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
                ? workMode === "image"
                  ? "Describe your image…"
                  : workMode === "code"
                    ? "What code should LiTT inspect or change?"
                    : workMode === "build"
                      ? "Describe what you want to build…"
                      : `Tell LiTT what to ${workMode}…`
                : "Type command and press Enter..."
            }
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-base text-neutral-100 outline-none placeholder:text-neutral-500 sm:text-sm"
          />
          <button
            onClick={() =>
              loading
                ? stopRun()
                : mode === "chat"
                  ? sendChat(input)
                  : runAsCommand()
            }
            className={`rounded-lg p-2 transition ${loading ? "bg-red-500/15 text-red-300" : "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"}`}
            aria-label={loading ? "Stop" : "Send"}
          >
            {loading ? (
              <span className="block h-3.5 w-3.5 rounded-sm bg-current" />
            ) : (
              <Send size={16} />
            )}
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
