"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Camera,
  Hammer,
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
} from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };

type SpeechRecognitionResult = { transcript: string }[];
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: (SpeechRecognitionResult & { isFinal: boolean })[];
};
type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

const starters = [
  "Audit this mobile view",
  "Make LiTT smarter",
  "Design inline",
  "Create a motion",
  "Map the idea",
  "Improve the app",
];
const actions = [
  "Find root cause",
  "Patch plan",
  "Run mobile regression",
  "Check deploy health",
  "Summarize changes",
];

export default function ChatTool() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognitionAPI =
      (window as unknown as { SpeechRecognition?: new () => SpeechRec })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec })
        .webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) return;
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
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      setInput((finalTranscript + (interim ? " " + interim : "")).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      const text = finalTranscript.trim();
      if (text) setInput(text);
      setListening(false);
    };
    recognitionRef.current = rec;
    return () => rec.stop();
  }, []);

  const toggleListening = () => {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      setListening(false);
    } else {
      setInput("");
      rec.start();
      setListening(true);
    }
  };

  const send = async (value = input) => {
    const text = value.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: "littree",
          provider: "gemini",
          history: next,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error("LiTT is reconnecting");
      const data = await response.json();
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            data.text ||
            data.message ||
            data.content ||
            "I’m ready. Tell me what we’re building.",
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error ? error.message : "LiTT is reconnecting",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  return (
    <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-cyan-400/10 bg-[#050914] text-slate-100 shadow-2xl">
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "linear-gradient(rgba(34,211,238,.025) 1px, transparent 1px),linear-gradient(90deg,rgba(34,211,238,.025) 1px,transparent 1px),radial-gradient(circle at 50% 38%,rgba(16,185,129,.12),transparent 28%)",
          backgroundSize: "22px 22px,22px 22px,100% 100%",
        }}
      />
      <header className="relative flex items-center justify-between border-b border-white/10 px-3 py-2.5">
        <div className="flex items-center gap-2 text-[10px] font-black tracking-wider">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee]" />
          <Bot size={13} className="text-cyan-300" /> LiTT Code Agent{" "}
          <span className="text-emerald-400">LIVE</span>
        </div>
        <div className="flex gap-2">
          <button className="rounded-full border border-white/10 px-3 py-1.5 text-[10px]">
            ＋ New
          </button>
          <button className="rounded-full border border-white/10 px-3 py-1.5 text-[10px]">
            ◉ Backdrop
          </button>
        </div>
      </header>

      <main className="relative flex flex-1 flex-col overflow-y-auto p-3 sm:p-5">
        {messages.length === 0 ? (
          <div className="m-auto w-full max-w-3xl py-8 text-center">
            <div className="mx-auto mb-3 grid h-20 w-20 place-items-center rounded-3xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_30px_rgba(16,185,129,.24)]">
              <Bot size={42} />
            </div>
            <h1 className="font-mono text-xl font-black sm:text-2xl">
              LiTT at LiTTree-LabStudios
            </h1>
            <p className="mt-1 font-mono text-[10px] text-slate-400 sm:text-xs">
              Your visible AI companion for building, memory, agents, and
              deploys.
            </p>
            <p className="mt-2 font-mono text-[9px] font-black tracking-[.25em] text-cyan-300">
              • COMPANIONS READY
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-left sm:grid-cols-4">
              {[
                [Bot, "LiT", "guide"],
                [Hammer, "Forge", "build"],
                [Sparkles, "Visionary", "design"],
                [Brain, "Memory", "recall"],
              ].map(([Icon, name, role]) => {
                const I = Icon as typeof Bot;
                return (
                  <button
                    key={String(name)}
                    className="rounded-xl border border-white/10 bg-white/3 p-2.5"
                  >
                    <span className="flex items-center gap-2">
                      <I size={15} className="text-cyan-300" />
                      <b className="font-mono text-[11px]">{String(name)}</b>
                    </span>
                    <span className="ml-6 font-mono text-[9px] text-slate-500">
                      {String(role)}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {starters.map((item) => (
                <button
                  key={item}
                  onClick={() => void send(item)}
                  className="shrink-0 rounded-full border border-white/10 px-3 py-2 font-mono text-[9px] text-slate-300"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 py-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`max-w-[88%] rounded-2xl border px-3 py-2.5 text-xs leading-relaxed ${message.role === "user" ? "ml-auto border-cyan-400/25 bg-cyan-400/10" : "border-white/10 bg-white/[.035]"}`}
              >
                {message.content}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[10px] text-cyan-300">
                <Loader2 size={13} className="animate-spin" /> LiTT is thinking…
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="relative border-t border-white/10 bg-[#060a16]/95 p-2.5">
        <div className="mb-2 flex gap-2 overflow-x-auto">
          {actions.map((action) => (
            <button
              key={action}
              onClick={() => setInput(action)}
              className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 font-mono text-[9px] text-slate-400"
            >
              {action}
            </button>
          ))}
        </div>
        <form
          onSubmit={submit}
          className="flex items-center gap-2 rounded-2xl border border-cyan-400/40 bg-[#0c1225] p-1.5 shadow-[0_0_18px_rgba(34,211,238,.08)]"
        >
          <button
            type="button"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400"
            title="Attach image"
          >
            <Camera size={16} />
          </button>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask LiTT to build, fix, design…"
            className="min-w-0 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-slate-500"
          />
          <button
            type="button"
            onClick={toggleListening}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border ${listening ? "border-red-400/60 text-red-300 animate-pulse" : "border-cyan-400/60 text-cyan-300"}`}
            title={listening ? "Listening..." : "Voice"}
          >
            {listening ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            disabled={!input.trim() || busy}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cyan-300 text-slate-950 disabled:opacity-40"
            title="Send"
          >
            <Send size={17} />
          </button>
        </form>
        <div className="mt-2 flex items-center gap-2 font-mono text-[9px] text-slate-500">
          <span className="text-cyan-300">• LiTT Code⌃</span>
          <span>♙ Gemini 2.5 Flash⌃</span>
        </div>
      </footer>
    </div>
  );
}
