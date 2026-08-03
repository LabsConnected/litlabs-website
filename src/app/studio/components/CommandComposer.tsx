"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Mic,
  MicOff,
  Send,
  Square,
  Loader2,
  Plus,
  Paperclip,
  X,
} from "lucide-react";
import {
  useVoiceSession,
  type VoiceState,
} from "@/app/studio/context/VoiceSessionContext";
import {
  useStudioAgentStore,
  AGENT_META,
  STUDIO_AGENTS,
  type AgentId,
} from "../stores/useStudioAgentStore";
import { useStudioModelStore, MODELS, type SelectedModel, type ProviderHealth } from "../stores/useStudioModelStore";
import { useUserPlan } from "../hooks/useUserPlan";
import { ChevronDown, Check, Lock } from "lucide-react";
import Link from "next/link";

/** Composer execution modes. */
const STATUS_LABELS: Record<VoiceState, string> = {
  idle: "",
  requesting_permission: "Requesting microphone…",
  connecting: "Connecting…",
  listening: "Listening",
  user_speaking: "You're speaking…",
  processing: "Processing…",
  assistant_speaking: "Agent speaking",
  muted: "Muted",
  error: "",
};

export interface ComposerContextLine {
  repo?: string;
  branch?: string;
  permissionMode?: string;
}

interface CommandComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (value: string, attachments?: string[]) => Promise<import("../hooks/useCanonicalConversation").SendResult | undefined>;
  busy?: boolean;
  disabled?: boolean;
  onAgentChange?: (agentId: import("../stores/useStudioAgentStore").AgentId) => void;
  onToggleCamera?: () => void;
  cameraActive?: boolean;
  contextLine?: ComposerContextLine;
}

export default function CommandComposer({
  value,
  onChange,
  onSend,
  busy = false,
  disabled = false,
  onAgentChange,
  onToggleCamera,
  cameraActive = false,
  contextLine,
}: CommandComposerProps) {
  const activeAgentId = useStudioAgentStore((s) => s.activeAgentId);
  const setActiveAgent = useStudioAgentStore((s) => s.setActiveAgent);
  const agentMeta = AGENT_META[activeAgentId];
  const selectedModel = useStudioModelStore((s) => s.selectedModel);

  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [showAttach, setShowAttach] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [agentRect, setAgentRect] = useState<DOMRect | null>(null);
  const [modelRect, setModelRect] = useState<DOMRect | null>(null);
  const selectModel = useStudioModelStore((s) => s.selectModel);
  const providerHealth = useStudioModelStore((s) => s.providerHealth);

  const {
    voiceState,
    isMuted,
    startVoice,
    stopVoice,
    toggleMute,
    interrupt,
    setOnTurn,
    speakText,
  } = useVoiceSession();

  // Canonical voice pipeline: final transcript -> onSend -> speakText.
  useEffect(() => {
    setOnTurn((text) => {
      void onSend(text).then((result) => {
        if (result?.reply) speakText(result.reply);
      }).catch(() => {});
    });
  }, [onSend, setOnTurn, speakText]);

  // Auto-resize textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  // Position agent popover on open.
  useEffect(() => {
    if (!agentOpen) return;
    if (agentTriggerRef.current) setAgentRect(agentTriggerRef.current.getBoundingClientRect());
    const update = () => agentTriggerRef.current && setAgentRect(agentTriggerRef.current.getBoundingClientRect());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [agentOpen]);

  // Position model popover on open.
  useEffect(() => {
    if (!modelOpen) return;
    if (modelTriggerRef.current) setModelRect(modelTriggerRef.current.getBoundingClientRect());
    const update = () => modelTriggerRef.current && setModelRect(modelTriggerRef.current.getBoundingClientRect());
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [modelOpen]);

  // Synchronous submission lock — prevents a fast double-click from
  // entering submit before React applies the busy=true prop.
  const submittingRef = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || submittingRef.current) return; // prevent duplicate submits
    if (!value.trim() && snapshots.length === 0) return;
    submittingRef.current = true;
    const attachments = [...snapshots];
    const textToSend = value;
    // Clear input immediately for responsiveness — the controller owns
    // the message now. If the controller rejects, we restore.
    onChange("");
    setSnapshots([]);
    try {
      const result = await onSend(textToSend, attachments.length ? attachments : undefined);
      if (!result?.accepted) {
        // Controller rejected — restore text and attachments
        onChange(textToSend);
        setSnapshots(attachments);
      }
      if (result?.reply) speakText(result.reply);
    } finally {
      submittingRef.current = false;
    }
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

  // Mic button state.
  const micState = (() => {
    switch (voiceState) {
      case "idle": return { icon: Mic, color: "var(--text-muted)", disabled: false, onClick: startVoice };
      case "requesting_permission":
      case "connecting": return { icon: Loader2, color: "var(--text-muted)", disabled: true, onClick: undefined };
      case "listening":
      case "user_speaking": return { icon: Mic, color: "#22d3ee", disabled: false, onClick: stopVoice };
      case "processing": return { icon: Loader2, color: "#22d3ee", disabled: true, onClick: undefined };
      case "assistant_speaking": return { icon: Square, color: "#e3b341", disabled: false, onClick: interrupt };
      case "muted": return { icon: MicOff, color: "#e3b341", disabled: false, onClick: toggleMute };
      case "error": return { icon: MicOff, color: "#ef4444", disabled: false, onClick: startVoice };
      default: return { icon: Mic, color: "var(--text-muted)", disabled: false, onClick: startVoice };
    }
  })();
  const MicIcon = micState.icon;

  const agentAccent = agentMeta.color;

  return (
    <div
      data-testid="studio-command-composer"
      className="relative flex w-full min-w-0 flex-col gap-1.5 border-t px-2.5 py-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] sm:pb-2"
      style={{
        backgroundColor: "var(--studio-bg)",
        borderColor: "var(--studio-border)",
      }}
    >
      {/* Context line: repository · branch · permission mode */}
      {contextLine && (contextLine.repo || contextLine.branch || contextLine.permissionMode) && (
        <div
          className="flex min-w-0 items-center gap-1.5 px-1 text-[10px] font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          {contextLine.repo && <span className="truncate">{contextLine.repo}</span>}
          {contextLine.repo && contextLine.branch && (
            <span style={{ color: "var(--studio-border-strong)" }}>·</span>
          )}
          {contextLine.branch && <span className="shrink-0">{contextLine.branch}</span>}
          {contextLine.branch && contextLine.permissionMode && (
            <span style={{ color: "var(--studio-border-strong)" }}>·</span>
          )}
          {contextLine.permissionMode && (
            <span className="shrink-0">{contextLine.permissionMode}</span>
          )}
        </div>
      )}

      {/* Snapshot previews */}
      {snapshots.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {snapshots.map((src, i) => (
            <div key={i} className="relative">
              <img
                src={src}
                alt={`Attachment ${i + 1}`}
                className="h-12 w-12 rounded-lg border object-cover"
                style={{ borderColor: "var(--studio-border-strong)" }}
              />
              <button
                type="button"
                onClick={() => setSnapshots((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border"
                style={{
                  backgroundColor: "var(--studio-elevated)",
                  borderColor: "var(--studio-border-strong)",
                  color: "var(--text-secondary)",
                }}
                aria-label={`Remove attachment ${i + 1}`}
              >
                <X size={9} className="pointer-events-none" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row — capped at composer max width, centered */}
      <div
        className="relative flex items-end gap-1.5 rounded-2xl border px-2 py-2"
        style={{
          borderColor: "var(--studio-border-strong)",
          backgroundColor: "var(--studio-card)",
          maxWidth: "var(--studio-composer-max-w)",
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* Attachment menu */}
        <button
          type="button"
          onClick={() => setShowAttach((v) => !v)}
          className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition"
          style={{
            color: "var(--text-muted)",
            borderColor: showAttach ? "var(--studio-border-strong)" : "transparent",
            backgroundColor: showAttach ? "rgba(255,255,255,0.06)" : "transparent",
          }}
          aria-label="Attachments"
          title="Attachments"
        >
          <Plus
            size={18}
            className={`pointer-events-none shrink-0 transition-transform ${showAttach ? "rotate-45" : ""}`}
          />
        </button>
        {showAttach && (
          <div
            className="absolute bottom-full left-2.5 mb-1 z-[150] w-44 rounded-xl border p-1 shadow-2xl"
            style={{
              backgroundColor: "var(--studio-elevated)",
              borderColor: "var(--studio-border-strong)",
            }}
          >
            <button
              type="button"
              onClick={() => { fileInputRef.current?.click(); setShowAttach(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <Paperclip size={13} className="pointer-events-none" /> Upload image
            </button>
            <button
              type="button"
              onClick={() => { onToggleCamera?.(); setShowAttach(false); }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold transition hover:bg-white/5"
              style={{ color: "var(--text-secondary)" }}
            >
              <Camera size={13} className="pointer-events-none" /> Camera snapshot
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        {/* Agent selector */}
        <button
          ref={agentTriggerRef}
          type="button"
          onClick={() => setAgentOpen((v) => !v)}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 transition hover:bg-white/5"
          style={{
            borderColor: "var(--studio-border-strong)",
            color: agentAccent,
          }}
          aria-label="Select agent"
          title={agentMeta.displayName}
          aria-expanded={agentOpen}
          data-testid="agent-trigger"
        >
          <span
            className="grid h-5 w-5 place-items-center rounded-md text-[10px] font-black"
            style={{ backgroundColor: `${agentAccent}20`, color: agentAccent }}
          >
            {agentMeta.displayName[0]}
          </span>
          <span className="hidden sm:inline text-[11px] font-bold">{agentMeta.displayName}</span>
        </button>
        {agentOpen && agentRect &&
          createPortal(
            <AgentPopover
              rect={agentRect}
              activeId={activeAgentId}
              onSelect={(id) => { if (onAgentChange) { onAgentChange(id); } else { setActiveAgent(id); } setAgentOpen(false); }}
              onClose={() => setAgentOpen(false)}
            />,
            document.body,
          )}

        {/* Model picker — interactive button + popover */}
        <button
          ref={modelTriggerRef}
          type="button"
          onClick={() => setModelOpen((v) => !v)}
          className="flex h-10 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-bold transition hover:bg-white/5"
          style={{
            borderColor: "var(--studio-border-strong)",
            color: "var(--text-secondary)",
          }}
          title={`${selectedModel.label} · ${selectedModel.provider} · ${selectedModel.cost}`}
          aria-label="Select model"
          aria-expanded={modelOpen}
          data-testid="model-trigger"
        >
          <span>{selectedModel.icon}</span>
          <span className="hidden sm:inline">{selectedModel.label}</span>
          <span className="sm:hidden">{selectedModel.label.split(" ")[0]}</span>
          <ChevronDown size={10} className="pointer-events-none opacity-50" />
        </button>
        {modelOpen && modelRect &&
          createPortal(
            <ModelPopover
              rect={modelRect}
              selectedId={selectedModel.id}
              providerHealth={providerHealth}
              onSelect={(m) => { selectModel(m); setModelOpen(false); }}
              onClose={() => setModelOpen(false)}
            />,
            document.body,
          )}

        {/* Text input — min 14px font */}
        <textarea
          id="command-composer-message"
          name="command-composer-message"
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(e);
            }
          }}
          placeholder={agentMeta.placeholder}
          className="min-w-0 flex-1 resize-none bg-transparent py-2.5 outline-none"
          style={{
            color: "var(--text-primary)",
            fontSize: "14px",
            lineHeight: "1.5",
            minHeight: "44px",
            maxHeight: "160px",
          }}
          rows={1}
          aria-label="Message input"
          data-testid="studio-command-input"
        />

        {/* Camera — directly beside microphone */}
        <button
          type="button"
          onClick={() => onToggleCamera?.()}
          className="pointer-events-auto flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{ color: cameraActive ? "#22d3ee" : "var(--text-muted)" }}
          aria-label={cameraActive ? "Close camera" : "Open camera"}
          title="Camera"
        >
          <Camera size={18} className="pointer-events-none shrink-0" />
        </button>

        {/* Microphone — directly beside camera */}
        <button
          type="button"
          onClick={micState.onClick}
          disabled={micState.disabled}
          className={`pointer-events-auto flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all ${
            !micState.disabled && "hover:bg-white/10"
          } ${micState.disabled && "cursor-not-allowed"}`}
          style={{
            color: micState.color,
            boxShadow:
              voiceState === "listening" || voiceState === "user_speaking"
                ? `0 0 0 2px rgba(34,211,238,0.3)`
                : undefined,
          }}
          aria-label={voiceState === "idle" ? "Start voice" : "Stop voice"}
        >
          <MicIcon
            size={18}
            className={`pointer-events-none shrink-0 ${
              voiceState === "requesting_permission" ||
              voiceState === "connecting" ||
              voiceState === "processing"
                ? "animate-spin"
                : ""
            }`}
          />
        </button>

        {/* Send */}
        <button
          type="button"
          onClick={submit}
          disabled={busy || (!value.trim() && snapshots.length === 0)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundColor: value.trim() || snapshots.length ? "var(--litt-primary)" : "transparent",
            color: value.trim() || snapshots.length ? "#000" : "var(--text-muted)",
          }}
          aria-label="Send message"
          title="Send message"
        >
          {busy ? (
            <Loader2 size={18} className="pointer-events-none shrink-0 animate-spin" />
          ) : (
            <Send size={18} className="pointer-events-none shrink-0" />
          )}
        </button>
      </div>

      {/* Voice status */}
      {STATUS_LABELS[voiceState] && (
        <div className="px-1 text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
          {STATUS_LABELS[voiceState]}
          {isMuted && voiceState !== "muted" ? " · muted" : ""}
        </div>
      )}
    </div>
  );
}

/* ── Agent selector popover ────────────────────────────────────── */
function AgentPopover({
  rect,
  activeId,
  onSelect,
  onClose,
}: {
  rect: DOMRect;
  activeId: AgentId;
  onSelect: (id: AgentId) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { hasAccess, loading } = useUserPlan();
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const left = Math.min(rect.left, window.innerWidth - 260);
  const top = rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select agent"
      className="fixed z-[200] w-64 max-h-[70vh] overflow-y-auto rounded-xl border shadow-2xl"
      style={{
        left,
        top,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <div
        className="sticky top-0 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--studio-border)", backgroundColor: "var(--studio-elevated)" }}
      >
        AI Team
      </div>
      {STUDIO_AGENTS.map((meta) => {
        const accent = meta.color;
        const isActive = activeId === meta.id;
        const unlocked = loading || hasAccess(meta.minimumPlan);
        return (
          <div key={meta.id}>
            <button
              type="button"
              disabled={!unlocked}
              onClick={() => unlocked && onSelect(meta.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: isActive ? `${accent}10` : "transparent" }}
            >
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-black"
                style={{ backgroundColor: `${accent}20`, color: accent }}
              >
                {unlocked ? meta.displayName[0] : <Lock size={11} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                  {meta.displayName}
                </div>
                <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                  {unlocked ? meta.role : `Requires ${planLabel(meta.minimumPlan)}`}
                </div>
              </div>
              {isActive && unlocked && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
              )}
            </button>
            {!unlocked && (
              <Link
                href={`/pricing?upgrade=${meta.minimumPlan}`}
                onClick={onClose}
                className="flex items-center gap-1 px-3 pb-2 pl-[3.25rem] text-[10px] font-bold transition hover:opacity-80"
                style={{ color: accent }}
              >
                Upgrade to {planLabel(meta.minimumPlan)} →
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

function planLabel(plan: string): string {
  switch (plan) {
    case "creator_beta": return "Creator Beta";
    case "pro_builder_beta": return "Pro Builder Beta";
    case "founder": return "Founding Member";
    default: return plan;
  }
}

/* ── Model selector popover ────────────────────────────────────── */
const MODEL_CATEGORIES: { id: NonNullable<SelectedModel["category"]>; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "free", label: "Free" },
  { id: "fast", label: "Fast" },
  { id: "code", label: "Code" },
  { id: "creative", label: "Creative" },
  { id: "vision", label: "Vision" },
  { id: "byok", label: "BYOK" },
];

function ModelPopover({
  rect,
  selectedId,
  providerHealth,
  onSelect,
  onClose,
}: {
  rect: DOMRect;
  selectedId: string;
  providerHealth: Record<string, ProviderHealth>;
  onSelect: (model: SelectedModel) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const left = Math.min(rect.left, window.innerWidth - 280);
  const top = rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select model"
      className="fixed z-[200] max-h-[400px] w-72 overflow-y-auto rounded-xl border shadow-2xl"
      style={{
        left,
        top,
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
    >
      <div
        className="sticky top-0 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{
          color: "var(--text-secondary)",
          borderBottom: "1px solid var(--studio-border)",
          backgroundColor: "var(--studio-elevated)",
        }}
      >
        Model
      </div>
      {MODEL_CATEGORIES.map((cat) => {
        const models = MODELS.filter((m) => m.category === cat.id);
        if (models.length === 0) return null;
        return (
          <div key={cat.id}>
            <div
              className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
            >
              {cat.label}
            </div>
            {models.map((m) => {
              const isActive = selectedId === m.id;
              const health = providerHealth[m.provider] ?? "available";
              const healthColor = health === "available" ? "#72f238" : health === "degraded" ? "#e3b341" : health === "locked" ? "#a78bfa" : "#ef4444";
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onSelect(m)}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/5"
                  style={{ backgroundColor: isActive ? "rgba(114,242,56,0.08)" : "transparent" }}
                >
                  <span className="text-base shrink-0">{m.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{m.label}</div>
                    <div className="flex items-center gap-1.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
                      <span>{m.provider}</span>
                      <span>·</span>
                      <span style={{ color: m.cost === "free" ? "#72f238" : m.cost === "paid" ? "#e3b341" : "var(--text-muted)" }}>
                        {m.cost === "free" ? "FREE" : m.cost === "paid" ? "PAID" : "AUTO"}
                      </span>
                      <span>·</span>
                      <span>{m.speed}</span>
                    </div>
                  </div>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: healthColor }} aria-hidden />
                  {isActive && <Check size={12} className="shrink-0" style={{ color: "var(--litt-primary)" }} />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
