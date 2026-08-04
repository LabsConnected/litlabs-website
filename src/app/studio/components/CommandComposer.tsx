"use client";

import { FormEvent, useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  Mic,
  MicOff,
  Send,
  Square,
  Loader2,
  Plus,
  X,
  Volume2,
  VolumeX,
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
import { useStudioAttachments } from "../hooks/useStudioAttachments";
import AttachmentMenu from "./AttachmentMenu";
import AttachmentPreviewStrip from "./AttachmentPreviewStrip";
import MediaRecorderPanel from "./MediaRecorderPanel";
import CameraPreview from "./CameraPreview";
import ShareMenu from "./ShareMenu";

/** Composer execution modes. */
const STATUS_LABELS: Record<VoiceState, string> = {
  idle: "",
  requesting_permission: "Requesting microphone…",
  connecting: "Connecting…",
  listening: "Listening",
  user_speaking: "You're speaking…",
  processing: "Processing…",
  transcript_ready: "Review your transcript",
  sending: "Sending…",
  assistant_speaking: "Agent speaking",
  muted: "Muted",
  permission_denied: "Microphone permission denied",
  unsupported: "Voice not supported in this browser",
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
  onCancel?: () => void;
  busy?: boolean;
  disabled?: boolean;
  onAgentChange?: (agentId: import("../stores/useStudioAgentStore").AgentId) => void;
  onToggleCamera?: () => void;
  onToggleLive?: () => void;
  liveActive?: boolean;
  contextLine?: ComposerContextLine;
}

export default function CommandComposer({
  value,
  onChange,
  onSend,
  onCancel,
  busy = false,
  disabled = false,
  onAgentChange,
  onToggleCamera,
  onToggleLive,
  liveActive = false,
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
  const [recorderMode, setRecorderMode] = useState<"audio" | "video" | "screen" | null>(null);
  const [attachAnchorRect, setAttachAnchorRect] = useState<DOMRect | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cameraPreviewOpen, setCameraPreviewOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [ttsPopoverOpen, setTtsPopoverOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentTriggerRef = useRef<HTMLButtonElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const attachTriggerRef = useRef<HTMLButtonElement>(null);
  const [agentRect, setAgentRect] = useState<DOMRect | null>(null);
  const [modelRect, setModelRect] = useState<DOMRect | null>(null);

  // Universal attachment system
  const {
    attachments,
    canAdd,
    addFiles,
    addLink,
    addRecording,
    addCameraPhoto,
    removeAttachment,
    retryAttachment,
    reorderAttachment,
    clearAll,
    getReadyUrls,
    isProcessing,
  } = useStudioAttachments();
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
    ttsEnabled,
    toggleTts,
    autoSendEnabled,
    toggleAutoSend,
    cancelRecording,
    micLevel,
    transcript: interimTranscript,
    setOnTranscriptComplete,
    recordingSeconds,
    errorMessage,
    stopSpeaking,
    voiceOutputState,
  } = useVoiceSession();

  // Canonical voice pipeline: final transcript -> onSend -> speakText.
  useEffect(() => {
    setOnTurn((text) => {
      void onSend(text).then((result) => {
        if (result?.reply) speakText(result.reply);
      }).catch(() => {});
    });
  }, [onSend, setOnTurn, speakText]);

  // Unified dictation: finalized transcripts write directly into the composer.
  // No separate transcript review panel — the composer IS the review surface.
  useEffect(() => {
    setOnTranscriptComplete((text) => {
      onChange(text);
    });
    return () => setOnTranscriptComplete(null);
  }, [onChange, setOnTranscriptComplete]);

  // Auto-resize textarea.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [value]);

  // Clipboard paste — images and files directly into the composer.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
      // Also check for pasted text that is a URL
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && files.length === 0) {
        try {
          const url = new URL(text);
          if (url.protocol === "http:" || url.protocol === "https:") {
            // Don't auto-add links on paste — let user use the menu
            // to avoid intercepting normal text paste
          }
        } catch {
          // not a URL — ignore
        }
      }
    };
    const ta = textareaRef.current;
    ta?.addEventListener("paste", onPaste);
    return () => ta?.removeEventListener("paste", onPaste);
  }, [addFiles]);

  // Drag-and-drop handlers for the composer area
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only clear if leaving the composer (not entering a child)
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      addFiles(files);
    }
  }, [addFiles]);

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
    const readyUrls = getReadyUrls();
    if (!value.trim() && readyUrls.length === 0 && snapshots.length === 0) return;
    submittingRef.current = true;
    // Merge legacy snapshots (camera data URLs) with new attachment URLs
    const attachments = [...snapshots, ...readyUrls];
    const textToSend = value;
    // Clear input immediately for responsiveness — the controller owns
    // the message now. If the controller rejects, we restore.
    onChange("");
    setSnapshots([]);
    clearAll();
    try {
      const result = await onSend(textToSend, attachments.length ? attachments : undefined);
      if (!result?.accepted) {
        // Controller rejected — restore text and snapshots
        onChange(textToSend);
        setSnapshots(attachments.filter((a) => a.startsWith("data:")));
        // Note: new attachment system files are not restored — user re-adds
      }
      if (result?.reply) speakText(result.reply);
    } finally {
      submittingRef.current = false;
    }
  };

  // Note: legacy handleFile removed — universal attachment system handles all file types.
  // Camera snapshots from CameraTool still use the `snapshots` state directly.

  // Mic button state.
  const micState = (() => {
    switch (voiceState) {
      case "idle": return { icon: Mic, color: "var(--text-muted)", disabled: false, onClick: startVoice };
      case "requesting_permission":
      case "connecting": return { icon: Loader2, color: "var(--text-muted)", disabled: true, onClick: undefined };
      case "listening":
      case "user_speaking": return { icon: Mic, color: "#22d3ee", disabled: false, onClick: stopVoice };
      case "processing": return { icon: Loader2, color: "#22d3ee", disabled: true, onClick: undefined };
      case "transcript_ready": return { icon: Mic, color: "#72f238", disabled: false, onClick: startVoice };
      case "sending": return { icon: Loader2, color: "#22d3ee", disabled: true, onClick: undefined };
      case "assistant_speaking": return { icon: Square, color: "#e3b341", disabled: false, onClick: interrupt };
      case "muted": return { icon: MicOff, color: "#e3b341", disabled: false, onClick: toggleMute };
      case "permission_denied": return { icon: MicOff, color: "#ef4444", disabled: false, onClick: startVoice };
      case "unsupported": return { icon: MicOff, color: "#ef4444", disabled: true, onClick: undefined };
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
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-border)",
        backdropFilter: "blur(12px)",
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

      {/* Attachment previews — universal system */}
      <AttachmentPreviewStrip
        attachments={attachments}
        onRemove={removeAttachment}
        onRetry={retryAttachment}
        onReorder={reorderAttachment}
        onClearAll={clearAll}
      />

      {/* Legacy camera snapshots (from CameraTool) */}
      {snapshots.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {snapshots.map((src, i) => (
            <div key={i} className="relative">
              <img
                src={src}
                alt={`Camera snapshot ${i + 1}`}
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
                aria-label={`Remove snapshot ${i + 1}`}
              >
                <X size={9} className="pointer-events-none" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row — capped at composer max width, centered */}
      <div
        className={`relative flex items-end gap-1.5 rounded-2xl border px-2 py-2 transition-all focus-within:border-purple-400/40 ${dragOver ? "border-purple-400/60 bg-purple-500/5" : ""}`}
        style={{
          borderColor: dragOver ? "rgba(168,85,247,0.4)" : "var(--studio-border-strong)",
          backgroundColor: dragOver ? "rgba(168,85,247,0.04)" : "var(--studio-card)",
          boxShadow: "var(--studio-glow-purple-soft)",
          maxWidth: "var(--studio-composer-max-w)",
          width: "100%",
          margin: "0 auto",
          backdropFilter: "blur(8px)",
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl" style={{ backgroundColor: "rgba(168,85,247,0.08)" }}>
            <span className="text-[11px] font-bold" style={{ color: "#c084fc" }}>
              Drop files to attach
            </span>
          </div>
        )}

        {/* Attachment menu — universal 10-option popover */}
        <button
          ref={attachTriggerRef}
          type="button"
          onClick={() => {
            if (attachTriggerRef.current) setAttachAnchorRect(attachTriggerRef.current.getBoundingClientRect());
            setShowAttach((v) => !v);
          }}
          className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition"
          style={{
            color: showAttach ? "#c084fc" : "var(--text-muted)",
            borderColor: showAttach ? "var(--studio-border-strong)" : "transparent",
            backgroundColor: showAttach ? "rgba(168,85,247,0.08)" : "transparent",
          }}
          aria-label="Attach files, media, or links"
          title="Attach"
          aria-expanded={Boolean(showAttach)}
        >
          <Plus
            size={18}
            className={`pointer-events-none shrink-0 transition-transform ${showAttach ? "rotate-45" : ""}`}
          />
          {attachments.length > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[8px] font-black"
              style={{ backgroundColor: "#a855f7", color: "#fff" }}
            >
              {attachments.length}
            </span>
          )}
        </button>
        {showAttach && attachAnchorRect && (
          <AttachmentMenu
            open={showAttach}
            onClose={() => setShowAttach(false)}
            onFiles={addFiles}
            onCamera={() => onToggleCamera?.()}
            onRecordVideo={() => setRecorderMode("video")}
            onRecordAudio={() => setRecorderMode("audio")}
            onScreenCapture={() => setRecorderMode("screen")}
            onLink={(url) => addLink(url)}
            onProjectFile={() => {
              // TODO: open project file picker (needs workspace files API)
              // For now, trigger the files input as a fallback
              fileInputRef.current?.click();
            }}
            attachmentCount={attachments.length}
            anchorRect={attachAnchorRect}
          />
        )}
        {/* Hidden file input for fallback / project file */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          title="Upload files"
          aria-label="Upload files attachment"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Agent selector */}
        <button
          ref={agentTriggerRef}
          type="button"
          onClick={() => setAgentOpen((v) => !v)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-2.5 transition hover:bg-white/5"
          style={{
            borderColor: "var(--studio-border-strong)",
            color: agentAccent,
          }}
          aria-label="Select agent"
          title={agentMeta.displayName}
          aria-expanded={Boolean(agentOpen)}
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
          className="flex h-11 shrink-0 items-center gap-1 rounded-xl border px-2.5 text-[11px] font-bold transition hover:bg-white/5"
          style={{
            borderColor: "var(--studio-border-strong)",
            color: "var(--text-secondary)",
          }}
          aria-label="Select AI model"
          aria-expanded={Boolean(modelOpen)}
          title={`${selectedModel.label} · ${selectedModel.provider} · ${selectedModel.cost}`}
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

        {/* Text input — min 14px font.
            While recording, the interim transcript appears as live placeholder
            text so the user sees their words appearing in the composer itself. */}
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
          placeholder={
            (voiceState === "listening" || voiceState === "user_speaking") && interimTranscript
              ? interimTranscript
              : agentMeta.placeholder
          }
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

        {/* TTS settings — separate from mic input. Opens a popover with
            on/off, stop speaking, and interrupt-while-talking toggle. */}
        <button
          type="button"
          onClick={() => setTtsPopoverOpen((v) => !v)}
          className="pointer-events-auto flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{
            color: ttsEnabled ? "#65f4ff" : "var(--text-muted)",
            boxShadow: voiceOutputState === "speaking" ? "0 0 0 2px rgba(101,244,255,0.3)" : undefined,
          }}
          aria-label={ttsEnabled ? "Reply speech settings" : "Reply speech is off"}
          title="Reply speech settings"
        >
          {ttsEnabled ? (
            <Volume2 size={17} className="pointer-events-none shrink-0" />
          ) : (
            <VolumeX size={17} className="pointer-events-none shrink-0" />
          )}
        </button>
        {ttsPopoverOpen && (
          <TtsPopover
            ttsEnabled={ttsEnabled}
            toggleTts={toggleTts}
            stopSpeaking={stopSpeaking}
            isSpeaking={voiceOutputState === "speaking"}
            autoSendEnabled={autoSendEnabled}
            toggleAutoSend={toggleAutoSend}
            onClose={() => setTtsPopoverOpen(false)}
          />
        )}

        {/* Camera — opens compact preview popover, capture → attach */}
        <button
          type="button"
          onClick={() => setCameraPreviewOpen((v) => !v)}
          className="pointer-events-auto flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{
            color: cameraPreviewOpen ? "#22d3ee" : "var(--text-muted)",
            boxShadow: cameraPreviewOpen ? "0 0 0 2px rgba(34,211,238,0.3)" : undefined,
          }}
          aria-label={cameraPreviewOpen ? "Close camera preview" : "Open camera preview"}
          title="Camera — capture photo"
        >
          <Camera size={18} className="pointer-events-none shrink-0" />
        </button>

        {/* Share / Live — opens Share menu (screen, window, tab, Live Voice) */}
        <button
          type="button"
          onClick={() => setShareMenuOpen((v) => !v)}
          className="pointer-events-auto flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all hover:bg-white/10"
          style={{
            color: shareMenuOpen || liveActive ? "#a855f7" : "var(--text-muted)",
            boxShadow: shareMenuOpen ? "0 0 0 2px rgba(168,85,247,0.3)" : undefined,
          }}
          aria-label={shareMenuOpen ? "Close share menu" : "Open share menu"}
          title="Share — screen, window, tab, or Live Voice"
        >
          {liveActive ? (
            <span className="relative flex h-4 w-4 items-center justify-center">
              <span className="absolute h-4 w-4 animate-ping rounded-full bg-purple-500/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-purple-400" />
            </span>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none shrink-0">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
          )}
        </button>

        {/* Microphone — directly beside camera */}
        <button
          type="button"
          onClick={micState.onClick}
          disabled={micState.disabled}
          className={`pointer-events-auto flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full transition-all ${
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
          onClick={busy ? onCancel : submit}
          disabled={disabled || (!busy && !value.trim() && snapshots.length === 0 && attachments.length === 0)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={busy ? "Cancel response" : "Send message"}
          title={busy ? "Cancel response" : "Send message"}
          style={{
            background: busy
              ? "rgba(227,179,65,0.18)"
              : value.trim() || snapshots.length || attachments.length
                ? "linear-gradient(135deg, var(--litt-primary), #2eff4a)"
                : "transparent",
            color: busy ? "#e3b341" : value.trim() || snapshots.length || attachments.length ? "#000" : "var(--text-muted)",
            boxShadow: value.trim() || snapshots.length || attachments.length ? "var(--studio-glow-green)" : "none",
          }}
        >
          {busy ? (
            <Square size={16} className="pointer-events-none shrink-0" />
          ) : (
            <Send size={18} className="pointer-events-none shrink-0" />
          )}
        </button>
      </div>

      {/* Inline recording indicator — replaces the old transcript review panel.
          Shows waveform, timer, and Cancel/Stop while recording.
          No separate textarea, no duplicate Send button. */}
      {(voiceState === "listening" ||
        voiceState === "user_speaking" ||
        voiceState === "requesting_permission" ||
        voiceState === "connecting" ||
        voiceState === "processing") && (
        <div
          className="flex items-center gap-2.5 px-1 text-[11px] font-bold"
          style={{ color: "var(--text-muted)" }}
          data-testid="recording-indicator"
        >
          {/* Waveform / level meter — 5 bars that scale with micLevel */}
          {(voiceState === "listening" || voiceState === "user_speaking") && (
            <span className="flex items-end gap-0.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => {
                const baseHeight = 3;
                const levelHeight = Math.max(baseHeight, Math.round(micLevel * 14));
                const height = i === 2 ? levelHeight : Math.max(baseHeight, Math.round(levelHeight * (0.5 + Math.abs(Math.sin(Date.now() / 200 + i)) * 0.5)));
                return (
                  <span
                    key={i}
                    className="inline-block w-1 rounded-full bg-cyan-400 transition-all"
                    style={{ height: `${height}px` }}
                  />
                );
              })}
            </span>
          )}

          {/* Timer — mm:ss format */}
          {(voiceState === "listening" || voiceState === "user_speaking") && (
            <span className="tabular-nums" style={{ color: "#22d3ee" }}>
              {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
              {String(recordingSeconds % 60).padStart(2, "0")}
            </span>
          )}

          {/* Status text */}
          <span>
            {STATUS_LABELS[voiceState]}
            {isMuted ? " · muted" : ""}
          </span>

          {/* Cancel button — discards recording */}
          {(voiceState === "listening" || voiceState === "user_speaking" || voiceState === "processing") && (
            <button
              type="button"
              onClick={cancelRecording}
              className="ml-auto rounded px-2 py-0.5 text-[10px] font-bold hover:bg-white/10"
              style={{ color: "var(--text-muted)" }}
              aria-label="Cancel recording"
            >
              Cancel
            </button>
          )}

          {/* Stop button — finalizes transcript into composer */}
          {(voiceState === "listening" || voiceState === "user_speaking") && (
            <button
              type="button"
              onClick={stopVoice}
              className="rounded px-2.5 py-0.5 text-[10px] font-bold text-black"
              style={{ backgroundColor: "#22d3ee" }}
              aria-label="Stop recording"
            >
              Stop
            </button>
          )}
        </div>
      )}

      {/* Error / permission denied status */}
      {(voiceState === "permission_denied" || voiceState === "unsupported" || voiceState === "error") && (
        <div className="px-1 text-[10px] font-bold" style={{ color: "#ef4444" }} role="alert">
          {STATUS_LABELS[voiceState]}
          {errorMessage && <span className="ml-1">— {errorMessage}</span>}
        </div>
      )}

      {/* Media recorder panel — audio/video/screen capture */}
      {recorderMode && (
        <MediaRecorderPanel
          mode={recorderMode}
          onClose={() => setRecorderMode(null)}
          onComplete={(file, source) => {
            if (source === "record-audio") addRecording(file, "record-audio");
            else if (source === "record-video") addRecording(file, "record-video");
            else addRecording(file, "screen");
            setRecorderMode(null);
          }}
        />
      )}

      {/* Camera preview popover — compact live preview with capture → attach */}
      {cameraPreviewOpen && (
        <CameraPreview
          onClose={() => setCameraPreviewOpen(false)}
          onCapture={(file) => {
            addCameraPhoto(file);
            setCameraPreviewOpen(false);
          }}
        />
      )}

      {/* Share menu popover — screen/window/tab sharing + Live Voice */}
      {shareMenuOpen && (
        <ShareMenu
          onClose={() => setShareMenuOpen(false)}
          onToggleLive={() => onToggleLive?.()}
        />
      )}
    </div>
  );
}

/* ── TTS settings popover — separate from mic controls ─────────── */
function TtsPopover({
  ttsEnabled,
  toggleTts,
  stopSpeaking,
  isSpeaking,
  autoSendEnabled,
  toggleAutoSend,
  onClose,
}: {
  ttsEnabled: boolean;
  toggleTts: () => void;
  stopSpeaking: () => void;
  isSpeaking: boolean;
  autoSendEnabled: boolean;
  toggleAutoSend: () => void;
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

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Reply speech settings"
      className="fixed bottom-20 z-[10016] w-56 rounded-xl border shadow-2xl backdrop-blur-md studio-anim-dropdown"
      style={{
        right: "5rem",
        backgroundColor: "var(--studio-elevated)",
        borderColor: "var(--studio-border-strong)",
      }}
      data-testid="tts-popover"
    >
      <div className="sticky top-0 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] border-b" style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--studio-border)" }}>
        Reply Speech
      </div>
      <div className="p-2 space-y-1">
        {/* TTS on/off */}
        <button
          type="button"
          onClick={toggleTts}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] font-bold transition hover:bg-white/5"
          style={{ color: "var(--text-primary)" }}
        >
          <span>Read replies aloud</span>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: ttsEnabled ? "#72f238" : "rgba(255,255,255,0.2)" }}
          />
        </button>

        {/* Stop speaking (only while speaking) */}
        {isSpeaking && (
          <button
            type="button"
            onClick={stopSpeaking}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-bold transition hover:bg-white/5"
            style={{ color: "#e3b341" }}
          >
            <Square size={12} className="pointer-events-none" />
            Stop speaking
          </button>
        )}

        <div className="my-1 h-px" style={{ backgroundColor: "var(--studio-border)" }} />

        {/* Auto-send toggle */}
        <button
          type="button"
          onClick={toggleAutoSend}
          className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[11px] font-bold transition hover:bg-white/5"
          style={{ color: "var(--text-primary)" }}
        >
          <span>Auto-send voice</span>
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: autoSendEnabled ? "#72f238" : "rgba(255,255,255,0.2)" }}
          />
        </button>
      </div>
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

  const left = Math.min(rect.left, window.innerWidth - 270);
  const top = rect.top - 280 > 0 ? rect.top - 280 : rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select agent"
      className="fixed z-[200] w-64 max-h-[260px] overflow-y-auto rounded-xl border shadow-2xl backdrop-blur-md studio-anim-dropdown"
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

  const left = Math.min(rect.left, window.innerWidth - 300);
  const top = rect.top - 360 > 0 ? rect.top - 360 : rect.bottom + 6;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Select model"
      className="fixed z-[200] max-h-[350px] w-72 overflow-y-auto rounded-xl border shadow-2xl backdrop-blur-md studio-anim-dropdown"
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
