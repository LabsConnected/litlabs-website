"use client";

import { useState, useRef, useCallback } from "react";
import { useDirectorRuntime } from "@/components/litt-director/DirectorRuntime";

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}
interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
  resultIndex: number;
}
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

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
  Wrench,
  Bot,
  Search,
  Brain,
  Rocket,
  HelpCircle,
  Code,
  X,
} from "lucide-react";
import { TerminalPanel, TerminalPanelHandle } from "./TerminalPanel";

type ComposerMode =
  | "ask"
  | "image"
  | "build"
  | "code"
  | "agent"
  | "search"
  | "memory"
  | "deploy";

const MODES: {
  id: ComposerMode;
  label: string;
  icon: typeof MessageSquare;
  placeholder: string;
}[] = [
  {
    id: "ask",
    label: "Ask",
    icon: HelpCircle,
    placeholder: "Ask LiTT anything...",
  },
  {
    id: "image",
    label: "Image",
    icon: ImageIcon,
    placeholder: "Describe the image...",
  },
  {
    id: "build",
    label: "Build",
    icon: Wrench,
    placeholder: "What should LiTT build?",
  },
  {
    id: "code",
    label: "Code",
    icon: Code,
    placeholder: "Inspect, fix, or explain code...",
  },
  {
    id: "agent",
    label: "Agent",
    icon: Bot,
    placeholder: "Create or control an agent...",
  },
  {
    id: "search",
    label: "Search",
    icon: Search,
    placeholder: "Search the web or project...",
  },
  {
    id: "memory",
    label: "Memory",
    icon: Brain,
    placeholder: "Remember or recall something...",
  },
  {
    id: "deploy",
    label: "Deploy",
    icon: Rocket,
    placeholder: "Deploy or preview...",
  },
];

const SUGGESTED = [
  "Build me a landing page",
  "Generate hero image for my startup",
  "Audit my API routes",
  "Deploy current project",
];

const IMAGE_STYLES = [
  "vivid",
  "natural",
  "anime",
  "photographic",
  "3d",
  "line-art",
  "cinematic",
];
const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:2", "2:3"];

export function ChatTerminal({
  onLogAction,
  onCommandAction,
  onConnectionChangeAction,
  agentId = "director",
  onDeployAction,
}: {
  onLogAction: (entry: string) => void;
  onCommandAction: (cmd: string) => void;
  onConnectionChangeAction: (connected: boolean) => void;
  agentId?: string;
  onDeployAction?: () => void;
}) {
  const runtime = useDirectorRuntime();
  const [mode, setMode] = useState<ComposerMode>("ask");
  const [chatMode, setChatMode] = useState<"chat" | "terminal">("chat");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageStyle, setImageStyle] = useState("vivid");
  const [imageRatio, setImageRatio] = useState("1:1");
  const [showModePicker, setShowModePicker] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  const [listening, setListening] = useState(false);
  const terminalRef = useRef<TerminalPanelHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idCounter = useRef(0);
  const ttsQueue = useRef<string[]>([]);
  const isSpeaking = useRef(false);

  const activeMode = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveIcon = activeMode.icon;

  const setIdle = useCallback(() => runtime.setState("idle"), [runtime]);

  const speak = useCallback(
    (text: string) => {
      if (
        !speakEnabled ||
        typeof window === "undefined" ||
        !window.speechSynthesis
      )
        return;
      ttsQueue.current.push(text);
      if (isSpeaking.current) return;
      const processQueue = () => {
        if (ttsQueue.current.length === 0) {
          isSpeaking.current = false;
          return;
        }
        isSpeaking.current = true;
        const utterance = new SpeechSynthesisUtterance(
          ttsQueue.current.shift()!,
        );
        utterance.rate = 1.1;
        utterance.pitch = 0.9;
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) =>
            /Google US English|Microsoft David|Samantha/i.test(v.name),
          ) ||
          voices.find((v) => v.lang.startsWith("en")) ||
          voices[0];
        if (preferred) utterance.voice = preferred;
        utterance.onend = processQueue;
        utterance.onerror = processQueue;
        window.speechSynthesis.speak(utterance);
      };
      processQueue();
    },
    [speakEnabled],
  );

  const fetchWithTimeout = useCallback(
    async (
      url: string,
      options: RequestInit & { signal?: AbortSignal },
      timeoutMs = 30000,
    ) => {
      const controller = new AbortController();
      const external = options.signal;
      const onExternalAbort = () => controller.abort();
      external?.addEventListener("abort", onExternalAbort);

      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        return res;
      } finally {
        clearTimeout(id);
        external?.removeEventListener("abort", onExternalAbort);
      }
    },
    [],
  );

  const normalizeResponse = (data: unknown): string => {
    if (!data || typeof data !== "object") return String(data);
    const d = data as {
      response?: string;
      answer?: string;
      message?: string;
      text?: string;
      error?: string;
    };
    return (
      d.response ||
      d.answer ||
      d.message ||
      d.text ||
      d.error ||
      "LiTT is thinking..."
    );
  };

  const generateImage = async (prompt: string) => {
    if (!prompt.trim()) return;
    const runId = runtime.addUserStep(prompt);
    runtime.setState("working");
    runtime.addPlanStep(runId, `Planning image generation: ${prompt}`);
    setLoading(true);
    try {
      const res = await fetch("/api/studio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          format: "image",
          style: imageStyle,
          aspectRatio: imageRatio,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error)
        throw new Error(data.error || "Image generation failed");
      const url = data.downloadUrl || data.thumbUrl || data.url;
      if (!url) throw new Error("No image URL returned");
      idCounter.current += 1;
      const artifact = {
        id: `img_${idCounter.current}`,
        type: "image" as const,
        url,
        title: data.title || `Image: ${prompt}`,
        downloadUrl: url,
        width: data.width || 1024,
        height: data.height || 1024,
      };
      runtime.addArtifact(artifact);
      runtime.addToolStep(runId, "Visionary generated the image");
      runtime.setAgentResponse(
        runId,
        `Your image is ready. ${data.title || "Generated image"}.`,
      );
      runtime.setState("complete");
      onLogAction(`[IMAGE] Generated: ${url.slice(0, 60)}...`);
      setTimeout(setIdle, 2500);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "Image generation failed";
      runtime.setAgentResponse(runId, `Could not generate image: ${errorMsg}`);
      runtime.setState("error");
      onLogAction(`[IMAGE] Error: ${errorMsg}`);
      setTimeout(setIdle, 2500);
    } finally {
      setLoading(false);
    }
  };

  const isImageIntent = (text: string) =>
    /\b(make|create|generate|design|draw|render)\b.*\b(logo|image|picture|banner|icon|artwork|art|graphic|wallpaper|poster|thumbnail)\b/i.test(
      text,
    );

  const sendChat = async (text: string) => {
    if (!text.trim()) return;

    if (mode === "image" || (mode === "ask" && isImageIntent(text))) {
      await generateImage(text);
      setInput("");
      return;
    }
    if (mode === "deploy") {
      onDeployAction?.();
      setInput("");
      return;
    }
    if (mode === "memory") {
      runtime.setState("thinking");
      const runId = runtime.addUserStep(text);
      runtime.setAgentResponse(
        runId,
        "Memory controls are being wired to your personal agent. Try again after the memory UI integration is complete.",
      );
      runtime.setState("idle");
      setInput("");
      return;
    }

    const runId = runtime.addUserStep(text);
    runtime.setState("thinking");
    setLoading(true);
    abortRef.current = new AbortController();

    try {
      const res = await fetchWithTimeout(
        "/api/agents/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId, message: text }),
          signal: abortRef.current.signal,
        },
        30000,
      );
      const data = await res.json();
      const answer = normalizeResponse(data);
      runtime.setAgentResponse(runId, answer);
      runtime.setState("complete");
      onLogAction(`[CHAT] Director: ${answer.slice(0, 120)}`);
      speak(answer);
      setTimeout(setIdle, 2000);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        if (abortRef.current?.signal.aborted) {
          runtime.setAgentResponse(runId, "Stopped.");
        } else {
          runtime.setAgentResponse(
            runId,
            "LiTT took too long to respond. Try a shorter prompt or check your connection.",
          );
        }
      } else {
        const errorMsg = err instanceof Error ? err.message : "Request failed";
        runtime.setAgentResponse(runId, `Error: ${errorMsg}`);
      }
      runtime.setState("error");
      setTimeout(setIdle, 2500);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const runAsCommand = () => {
    if (!input.trim()) return;
    terminalRef.current?.runCommand(input);
    onCommandAction(input);
    onLogAction(`[CMD] ${input}`);
    setInput("");
  };

  const toggleListening = () => {
    if (listening) {
      setListening(false);
      return;
    }
    if (
      typeof window === "undefined" ||
      !("webkitSpeechRecognition" in window)
    ) {
      onLogAction("[VOICE] Speech recognition not supported");
      return;
    }
    setListening(true);
    runtime.setState("listening");
    onLogAction("[VOICE] Listening...");
    const Rec = (
      window as unknown as {
        webkitSpeechRecognition: new () => SpeechRecognition;
      }
    ).webkitSpeechRecognition;
    const recognition = new Rec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    let finalTranscript = "";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const t = result[0]?.transcript || "";
        if (result.isFinal) finalTranscript += t;
      }
      if (finalTranscript) setInput(finalTranscript);
    };
    recognition.onerror = (event: Event) => {
      const err = (event as ErrorEvent).error || "unknown";
      onLogAction(`[VOICE] Error: ${err}`);
      setListening(false);
      runtime.setState("idle");
    };
    recognition.onend = () => {
      setListening(false);
      runtime.setState("idle");
      if (finalTranscript.trim()) {
        setInput(finalTranscript);
        sendChat(finalTranscript.trim());
      }
    };
    recognition.start();
  };

  return (
    <div className="flex min-h-[180px] flex-col overflow-hidden rounded-xl border border-neutral-800/60 bg-black/40 backdrop-blur-sm sm:rounded-2xl">
      <div className="flex items-center justify-between border-b border-neutral-800/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-neutral-800/60 bg-neutral-900/60 p-0.5">
            <button
              onClick={() => setChatMode("chat")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all ${
                chatMode === "chat"
                  ? "bg-cyan-500/15 text-cyan-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <MessageSquare size={13} /> Chat
            </button>
            <button
              onClick={() => setChatMode("terminal")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold transition-all ${
                chatMode === "terminal"
                  ? "bg-orange-500/15 text-orange-300"
                  : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              <TerminalIcon size={13} /> Terminal
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded-lg px-2 py-1 text-[10px] font-bold text-red-400 hover:bg-red-500/10"
            >
              Stop
            </button>
          )}
          <button
            onClick={() => setSpeakEnabled((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase transition ${
              speakEnabled
                ? "text-cyan-300"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {speakEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {speakEnabled ? "Voice" : "Mute"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-2">
        {chatMode === "terminal" ? (
          <div className="h-full">
            <TerminalPanel
              ref={terminalRef}
              onLog={onLogAction}
              onCommand={onCommandAction}
              onConnectionChange={onConnectionChangeAction}
              onTerminalOutput={() => {}}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col justify-end">
            {runtime.steps.length === 0 && (
              <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendChat(s)}
                    className="shrink-0 rounded-full border border-neutral-800/60 bg-neutral-900/40 px-2.5 py-1 text-[10px] font-semibold text-neutral-300 transition hover:border-cyan-500/30 hover:text-cyan-300"
                  >
                    <Sparkles
                      size={10}
                      className="inline mr-1 text-cyan-500/70"
                    />
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                onClick={() => setShowModePicker((s) => !s)}
                className="flex items-center gap-1.5 rounded-lg border border-neutral-700/50 bg-neutral-900/60 px-2 py-1.5 text-[10px] font-bold text-cyan-300 transition hover:bg-neutral-800/60"
              >
                <ActiveIcon size={12} /> {activeMode.label}
              </button>
              {showModePicker && (
                <>
                  {MODES.filter((m) => m.id !== mode).map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setMode(m.id);
                          setShowModePicker(false);
                        }}
                        className="flex items-center gap-1.5 rounded-lg border border-neutral-800/60 bg-neutral-900/40 px-2 py-1.5 text-[10px] font-bold text-neutral-400 transition hover:bg-neutral-800/60 hover:text-neutral-200"
                      >
                        <Icon size={12} /> {m.label}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setShowModePicker(false)}
                    className="rounded-lg p-1.5 text-neutral-500 hover:text-neutral-300"
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </div>

            {mode === "image" && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={imageStyle}
                  onChange={(e) => setImageStyle(e.target.value)}
                  className="rounded-lg border border-neutral-800/60 bg-neutral-900/60 px-2 py-1 text-[10px] font-bold text-neutral-300 outline-none"
                >
                  {IMAGE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={imageRatio}
                  onChange={(e) => setImageRatio(e.target.value)}
                  className="rounded-lg border border-neutral-800/60 bg-neutral-900/60 px-2 py-1 text-[10px] font-bold text-neutral-300 outline-none"
                >
                  {IMAGE_RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-1.5 rounded-xl border border-neutral-800/60 bg-neutral-900/60 px-2 py-2 transition-all focus-within:border-cyan-500/40 focus-within:shadow-[0_0_12px_rgba(34,211,238,0.12)]">
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
                    if (chatMode === "chat") {
                      sendChat(input);
                    } else {
                      runAsCommand();
                    }
                  }
                }}
                placeholder={activeMode.placeholder}
                className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
              />
              <button
                onClick={() =>
                  chatMode === "chat" ? sendChat(input) : runAsCommand()
                }
                disabled={loading}
                className="rounded-lg bg-cyan-500/15 p-2 text-cyan-300 transition disabled:opacity-40"
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
              >
                <Mic size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
