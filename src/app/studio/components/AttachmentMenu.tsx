"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Video,
  Music,
  Camera,
  Mic,
  Link as LinkIcon,
  FolderOpen,
} from "lucide-react";
import { ACCEPT_STRINGS, MAX_ATTACHMENTS, isLinkUrl } from "../lib/attachment-types";

// ---------------------------------------------------------------------------
// Inline SVG icons for lucide-react gaps (pinned to ^1.24.0)
// ---------------------------------------------------------------------------

function ScreenCaptureIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none shrink-0">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function RecordVideoIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none shrink-0">
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M22 8l-6 4 6 4V8z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Menu items
// ---------------------------------------------------------------------------

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  desc?: string;
}

const MENU_ITEMS: MenuItem[] = [
  { id: "files", label: "Upload files", icon: <FileText size={14} className="pointer-events-none shrink-0" />, desc: "PDF, DOCX, TXT, MD, CSV, JSON, ZIP" },
  { id: "images", label: "Upload images", icon: <ImageIcon size={14} className="pointer-events-none shrink-0" />, desc: "PNG, JPG, WEBP, GIF, SVG" },
  { id: "video", label: "Upload video", icon: <Video size={14} className="pointer-events-none shrink-0" />, desc: "MP4, MOV, WEBM" },
  { id: "audio", label: "Upload audio", icon: <Music size={14} className="pointer-events-none shrink-0" />, desc: "MP3, WAV, M4A, OGG, FLAC" },
  { id: "camera", label: "Take photo", icon: <Camera size={14} className="pointer-events-none shrink-0" /> },
  { id: "record-video", label: "Record video", icon: <RecordVideoIcon size={14} /> },
  { id: "record-audio", label: "Record audio", icon: <Mic size={14} className="pointer-events-none shrink-0" /> },
  { id: "screen", label: "Capture screen", icon: <ScreenCaptureIcon size={14} /> },
  { id: "link", label: "Paste link", icon: <LinkIcon size={14} className="pointer-events-none shrink-0" />, desc: "YouTube, website, GitHub" },
  { id: "project-file", label: "Choose project file", icon: <FolderOpen size={14} className="pointer-events-none shrink-0" /> },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AttachmentMenuProps {
  open: boolean;
  onClose: () => void;
  onFiles: (files: FileList) => void;
  onCamera: () => void;
  onRecordVideo: () => void;
  onRecordAudio: () => void;
  onScreenCapture: () => void;
  onLink: (url: string) => void;
  onProjectFile: () => void;
  attachmentCount: number;
  anchorRect: DOMRect | null;
}

export default function AttachmentMenu({
  open,
  onClose,
  onFiles,
  onCamera,
  onRecordVideo,
  onRecordAudio,
  onScreenCapture,
  onLink,
  onProjectFile,
  attachmentCount,
  anchorRect,
}: AttachmentMenuProps) {
  const [linkInput, setLinkInput] = useState("");
  const [showLinkInput, setShowLinkInput] = useState(false);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const imagesInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setShowLinkInput(false);
    setLinkInput("");
    onClose();
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    // Delay to avoid the opening click immediately closing
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [open, handleClose]);

  // Focus link input when shown
  useEffect(() => {
    if (showLinkInput && linkInputRef.current) {
      linkInputRef.current.focus();
    }
  }, [showLinkInput]);

  if (!open) return null;

  const canAdd = attachmentCount < MAX_ATTACHMENTS;

  function handleAction(id: string) {
    if (!canAdd) return;
    switch (id) {
      case "files":
        filesInputRef.current?.click();
        break;
      case "images":
        imagesInputRef.current?.click();
        break;
      case "video":
        videoInputRef.current?.click();
        break;
      case "audio":
        audioInputRef.current?.click();
        break;
      case "camera":
        onCamera();
        handleClose();
        break;
      case "record-video":
        onRecordVideo();
        handleClose();
        break;
      case "record-audio":
        onRecordAudio();
        handleClose();
        break;
      case "screen":
        onScreenCapture();
        handleClose();
        break;
      case "link":
        setShowLinkInput(true);
        break;
      case "project-file":
        onProjectFile();
        handleClose();
        break;
    }
    if (id !== "link") {
      handleClose();
    }
  }

  function handleLinkSubmit() {
    const url = linkInput.trim();
    if (isLinkUrl(url)) {
      onLink(url);
      handleClose();
    }
  }

  // Position the menu above the anchor
  const style: React.CSSProperties = anchorRect
    ? {
        position: "fixed",
        bottom: window.innerHeight - anchorRect.top + 4,
        left: anchorRect.left,
        zIndex: 150,
      }
    : { position: "absolute", bottom: "100%", left: 0, zIndex: 150 };

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={ACCEPT_STRINGS.files}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = "";
          handleClose();
        }}
      />
      <input
        ref={imagesInputRef}
        type="file"
        multiple
        accept={ACCEPT_STRINGS.images}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = "";
          handleClose();
        }}
      />
      <input
        ref={videoInputRef}
        type="file"
        multiple
        accept={ACCEPT_STRINGS.video}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = "";
          handleClose();
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        multiple
        accept={ACCEPT_STRINGS.audio}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) onFiles(e.target.files);
          e.target.value = "";
          handleClose();
        }}
      />

      <div
        ref={menuRef}
        style={{
          ...style,
          width: showLinkInput ? 280 : 240,
        }}
        className="rounded-xl border p-1.5 shadow-2xl"
        data-testid="attachment-menu"
      >
        {showLinkInput ? (
          <div className="p-1.5">
            <div className="mb-2 flex items-center gap-2">
              <LinkIcon size={13} className="pointer-events-none shrink-0" style={{ color: "var(--text-muted)" }} />
              <span className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>
                Paste a link
              </span>
            </div>
            <input
              ref={linkInputRef}
              type="url"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleLinkSubmit();
                }
                if (e.key === "Escape") handleClose();
              }}
              placeholder="https://youtube.com/watch?v=..."
              className="w-full rounded-lg border px-2.5 py-2 text-[12px] outline-none focus:border-purple-400/40"
              style={{
                backgroundColor: "var(--studio-card)",
                borderColor: "var(--studio-border-strong)",
                color: "var(--text-primary)",
              }}
            />
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={handleLinkSubmit}
                disabled={!isLinkUrl(linkInput.trim())}
                className="flex-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition disabled:opacity-40"
                style={{
                  backgroundColor: "rgba(168,85,247,0.15)",
                  color: "#c084fc",
                }}
              >
                Add link
              </button>
              <button
                type="button"
                onClick={() => { setShowLinkInput(false); setLinkInput(""); }}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition hover:bg-white/5"
                style={{ color: "var(--text-muted)" }}
              >
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {!canAdd && (
              <div className="px-2.5 py-1.5 text-[10px] font-bold" style={{ color: "#fca5a5" }}>
                Attachment limit reached ({MAX_ATTACHMENTS})
              </div>
            )}
            {MENU_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleAction(item.id)}
                disabled={!canAdd}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: "var(--text-secondary)" }}
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg" style={{ backgroundColor: "rgba(168,85,247,0.1)", color: "#c084fc" }}>
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold">{item.label}</span>
                  {item.desc && (
                    <span className="block truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {item.desc}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
