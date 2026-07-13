"use client";

import { FormEvent, useRef, useState } from "react";
import {
  Camera,
  Mic,
  MonitorUp,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import CameraSession from "./CameraSession";
import VoiceSession from "./VoiceSession";

export type ComposerMode = "text" | "voice" | "camera";

interface MultimodalComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string, attachments?: string[]) => Promise<string>;
  busy?: boolean;
  modelName?: string;
}

export default function MultimodalComposer({
  value,
  onChange,
  onSend,
  busy,
  modelName = "Gemini 2.5 Flash",
}: MultimodalComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("text");
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const detectIntent = (text: string) => {
    const t = text.toLowerCase();
    if (
      /\b(look at me|what do you see|can you see me|show me|camera on|use camera)\b/.test(
        t,
      )
    )
      return "camera";
    if (/\b(talk to me|voice mode|call me|speak to me|listen to me)\b/.test(t))
      return "voice";
    if (
      /\b(generate an image|create an image|make an image|draw|image of)\b/.test(
        t,
      )
    )
      return "image";
    if (
      /\b(build a page|create a mission|new mission|start a project)\b/.test(t)
    )
      return "mission";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() && snapshots.length === 0) return;
    const intent = detectIntent(value);
    if (intent === "camera") {
      setMode("camera");
      onChange("");
      return;
    }
    if (intent === "voice") {
      setMode("voice");
      onChange("");
      return;
    }
    if (intent === "image") {
      window.location.href = "/studio/image";
      return;
    }
    if (intent === "mission") {
      window.location.href = "/studio?tool=agents";
      return;
    }
    await onSend(value, snapshots.length ? snapshots : undefined);
    onChange("");
    setSnapshots([]);
  };

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setSnapshots((prev) => [...prev, dataUrl]);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="relative flex flex-col gap-2 border-t border-white/10 bg-[#060a16]/95 p-2.5">
      {/* Mode panels */}
      {mode === "camera" && (
        <div className="mb-2">
          <CameraSession
            onSnapshot={(url) => {
              setSnapshots((prev) => [...prev, url]);
              void onSend("Describe what you see.", [url]);
              setMode("text");
            }}
            onClose={() => setMode("text")}
            modelName={modelName}
          />
        </div>
      )}
      {mode === "voice" && (
        <div className="mb-2">
          <VoiceSession
            onSend={async (text) => {
              const reply = await onSend(text);
              return reply;
            }}
            onClose={() => setMode("text")}
          />
        </div>
      )}

      {/* Snapshots */}
      {snapshots.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {snapshots.map((src, i) => (
            <div
              key={i}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-white/10"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="snapshot"
                className="h-full w-full object-cover"
              />
              <button
                onClick={() =>
                  setSnapshots((prev) => prev.filter((_, idx) => idx !== i))
                }
                className="absolute right-0 top-0 rounded-bl-lg bg-black/70 p-0.5 text-white"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-1 flex gap-1 overflow-x-auto pb-1">
        <button
          onClick={() => setShowAdd((v) => !v)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${showAdd ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-slate-400 hover:text-cyan-300"}`}
        >
          <Plus size={12} /> Add
        </button>
        <button
          onClick={() => setMode(mode === "voice" ? "text" : "voice")}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${mode === "voice" ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-slate-400 hover:text-cyan-300"}`}
        >
          <Mic size={12} /> Voice
        </button>
        <button
          onClick={() => setMode(mode === "camera" ? "text" : "camera")}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-bold ${mode === "camera" ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-slate-400 hover:text-cyan-300"}`}
        >
          <Camera size={12} /> Camera
        </button>
        <button
          onClick={() => {
            setShowAdd(false);
            alert("Screen share coming soon");
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-slate-400 hover:text-cyan-300"
        >
          <MonitorUp size={12} /> Screen
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1.5 text-[10px] font-bold text-slate-400 hover:text-cyan-300"
        >
          <Paperclip size={12} /> Files
        </button>
      </div>

      {/* Add sheet */}
      {showAdd && (
        <div className="mb-2 grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-white/3 p-2">
          <button
            onClick={() => {
              setMode("camera");
              setShowAdd(false);
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Camera size={16} className="text-cyan-300" /> Camera
          </button>
          <button
            onClick={() => {
              setMode("voice");
              setShowAdd(false);
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Mic size={16} className="text-cyan-300" /> Voice
          </button>
          <button
            onClick={() => {
              setShowAdd(false);
              alert("Screen share coming soon");
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <MonitorUp size={16} className="text-cyan-300" /> Screen
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Paperclip size={16} className="text-cyan-300" /> Files
          </button>
          <button
            onClick={() => {
              setShowAdd(false);
              alert("Tools coming soon");
            }}
            className="flex flex-col items-center gap-1 rounded-xl p-2 text-[9px] text-slate-300 hover:bg-white/5"
          >
            <Wand2 size={16} className="text-cyan-300" /> Tools
          </button>
        </div>
      )}

      <input
        id="composer-file-input"
        name="composer-file-input"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          setShowAdd(false);
        }}
      />

      {/* Composer form */}
      <form
        onSubmit={submit}
        className="flex items-center gap-2 rounded-2xl border border-cyan-400/40 bg-[#0c1225] p-1.5 shadow-[0_0_18px_rgba(34,211,238,.08)]"
      >
        <input
          id="composer-message-input"
          name="composer-message-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ask LiTT to build, fix, design…"
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs outline-none placeholder:text-slate-500"
        />
        <button
          disabled={(!value.trim() && snapshots.length === 0) || busy}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cyan-300 text-slate-950 disabled:opacity-40"
          title="Send"
        >
          <Send size={17} />
        </button>
      </form>

      <div className="flex items-center justify-between px-1 font-mono text-[9px] text-slate-500">
        <span className="flex items-center gap-1">
          <Sparkles size={10} className="text-cyan-300" />
          {modelName}
        </span>
        <span className="hidden sm:inline">• LiTT Director</span>
      </div>
    </div>
  );
}
