"use client";

import {
  X,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Loader2,
  FileText,
  Music,
  Video,
  Link as LinkIcon,
  FolderOpen,
  Archive,
  Code,
  RotateCcw,
} from "lucide-react";
import { type Attachment, formatFileSize } from "../lib/attachment-types";

// ---------------------------------------------------------------------------
// Category icon
// ---------------------------------------------------------------------------

function CategoryIcon({ category, size = 16 }: { category: Attachment["category"]; size?: number }) {
  switch (category) {
    case "image":
      return null; // images show a thumbnail
    case "video":
      return <Video size={size} className="pointer-events-none" />;
    case "audio":
      return <Music size={size} className="pointer-events-none" />;
    case "link":
      return <LinkIcon size={size} className="pointer-events-none" />;
    case "project-file":
      return <FolderOpen size={size} className="pointer-events-none" />;
    case "archive":
      return <Archive size={size} className="pointer-events-none" />;
    case "code":
      return <Code size={size} className="pointer-events-none" />;
    default:
      return <FileText size={size} className="pointer-events-none" />;
  }
}

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

function StatusBadge({ status, progress, error: _error }: { status: Attachment["status"]; progress: number | null; error: string | null }) {
  switch (status) {
    case "uploading":
      return (
        <div className="flex items-center gap-1 text-[8px] font-bold" style={{ color: "#22d3ee" }}>
          <Loader2 size={8} className="pointer-events-none animate-spin" />
          {progress !== null ? `${progress}%` : "Uploading"}
        </div>
      );
    case "transcribing":
      return <div className="text-[8px] font-bold" style={{ color: "#22d3ee" }}>Transcribing</div>;
    case "analyzing":
      return <div className="text-[8px] font-bold" style={{ color: "#22d3ee" }}>Analyzing</div>;
    case "failed":
      return (
        <div className="flex items-center gap-0.5 text-[8px] font-bold" style={{ color: "#fca5a5" }}>
          <AlertCircle size={8} className="pointer-events-none" />
          Failed
        </div>
      );
    case "ready":
      return <div className="text-[8px] font-bold" style={{ color: "#72f238" }}>Ready</div>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Single attachment card
// ---------------------------------------------------------------------------

function AttachmentCard({
  attachment,
  index,
  total,
  onRemove,
  onRetry,
  onReorder,
}: {
  attachment: Attachment;
  index: number;
  total: number;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onReorder: (id: string, direction: "left" | "right") => void;
}) {
  const { id, category, name, status, progress, previewUrl, error, size, source } = attachment;
  const isImage = category === "image" && previewUrl;
  const isVideo = category === "video" && previewUrl;

  return (
    <div
      className="group relative flex shrink-0 flex-col overflow-hidden rounded-xl border"
      style={{
        width: 88,
        height: 88,
        borderColor: status === "failed" ? "rgba(239,68,68,0.3)" : "var(--studio-border-strong)",
        backgroundColor: "var(--studio-card)",
      }}
      data-testid={`attachment-card-${id}`}
    >
      {/* Preview area */}
      <div className="relative flex h-14 w-full items-center justify-center overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element -- blob/object URLs from user uploads */
          <img src={previewUrl ?? ""} alt={name} className="h-full w-full object-cover" />
        ) : isVideo ? (
          <video src={previewUrl ?? ""} className="h-full w-full object-cover" muted />
        ) : (
          <div style={{ color: status === "failed" ? "#fca5a5" : "var(--text-muted)" }}>
            <CategoryIcon category={category} size={22} />
          </div>
        )}

        {/* Upload progress overlay */}
        {status === "uploading" && progress !== null && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
            <div className="h-1 w-12 overflow-hidden rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.15)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, backgroundColor: "#22d3ee" }}
              />
            </div>
          </div>
        )}

        {/* Failed overlay */}
        {status === "failed" && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(239,68,68,0.15)" }}>
            <AlertCircle size={20} className="pointer-events-none" style={{ color: "#fca5a5" }} />
          </div>
        )}

        {/* Source badge */}
        {source !== "upload" && (
          <div
            className="absolute left-1 top-1 rounded px-1 py-0.5 text-[7px] font-bold uppercase"
            style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "var(--text-muted)" }}
          >
            {source === "camera" ? "CAM" : source === "record-audio" ? "MIC" : source === "record-video" ? "REC" : source === "screen" ? "SCR" : source === "paste" ? "URL" : source === "project-file" ? "PROJ" : "FILE"}
          </div>
        )}
      </div>

      {/* Info area */}
      <div className="flex min-h-0 flex-1 flex-col justify-center px-1.5 py-1">
        <div className="truncate text-[8px] font-bold" style={{ color: "var(--text-secondary)" }} title={name}>
          {name}
        </div>
        <div className="flex items-center justify-between">
          <StatusBadge status={status} progress={progress} error={error} />
          {size > 0 && status === "ready" && (
            <span className="text-[7px]" style={{ color: "var(--text-muted)" }}>
              {formatFileSize(size)}
            </span>
          )}
        </div>
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={() => onRemove(id)}
        className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full border opacity-0 transition group-hover:opacity-100"
        style={{
          backgroundColor: "var(--studio-elevated)",
          borderColor: "var(--studio-border-strong)",
          color: "var(--text-secondary)",
        }}
        aria-label={`Remove ${name}`}
      >
        <X size={9} className="pointer-events-none" />
      </button>

      {/* Reorder buttons */}
      {total > 1 && (
        <>
          {index > 0 && (
            <button
              type="button"
              onClick={() => onReorder(id, "left")}
              className="absolute left-0 top-1/2 -translate-y-1/2 grid h-4 w-4 place-items-center rounded-full opacity-0 transition group-hover:opacity-100"
              style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "var(--text-muted)" }}
              aria-label={`Move ${name} left`}
            >
              <ChevronLeft size={10} className="pointer-events-none" />
            </button>
          )}
          {index < total - 1 && (
            <button
              type="button"
              onClick={() => onReorder(id, "right")}
              className="absolute right-0 top-1/2 -translate-y-1/2 grid h-4 w-4 place-items-center rounded-full opacity-0 transition group-hover:opacity-100"
              style={{ backgroundColor: "rgba(0,0,0,0.6)", color: "var(--text-muted)" }}
              aria-label={`Move ${name} right`}
            >
              <ChevronRight size={10} className="pointer-events-none" />
            </button>
          )}
        </>
      )}

      {/* Retry button for failed */}
      {status === "failed" && (
        <button
          type="button"
          onClick={() => onRetry(id)}
          className="absolute bottom-1 right-1 grid h-5 w-5 place-items-center rounded-full transition hover:bg-white/10"
          style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#fca5a5" }}
          aria-label={`Retry ${name}`}
          title="Retry upload"
        >
          <RotateCcw size={10} className="pointer-events-none" />
        </button>
      )}

      {/* Error tooltip on hover */}
      {status === "failed" && error && (
        <div
          className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border px-2 py-1 text-[8px] opacity-0 transition group-hover:opacity-100"
          style={{
            backgroundColor: "var(--studio-elevated)",
            borderColor: "rgba(239,68,68,0.3)",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main preview strip
// ---------------------------------------------------------------------------

export interface AttachmentPreviewStripProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onReorder: (id: string, direction: "left" | "right") => void;
  onClearAll: () => void;
}

export default function AttachmentPreviewStrip({
  attachments,
  onRemove,
  onRetry,
  onReorder,
  onClearAll,
}: AttachmentPreviewStripProps) {
  if (attachments.length === 0) return null;

  const processingCount = attachments.filter(
    (a) => a.status === "uploading" || a.status === "transcribing" || a.status === "analyzing",
  ).length;
  const failedCount = attachments.filter((a) => a.status === "failed").length;

  return (
    <div className="flex flex-col gap-1.5 px-1" data-testid="attachment-preview-strip">
      {/* Header row */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          {attachments.length} attachment{attachments.length !== 1 ? "s" : ""}
          {processingCount > 0 && <span style={{ color: "#22d3ee" }}> · {processingCount} processing</span>}
          {failedCount > 0 && <span style={{ color: "#fca5a5" }}> · {failedCount} failed</span>}
        </span>
        <button
          type="button"
          onClick={onClearAll}
          className="text-[9px] font-bold transition hover:text-red-400"
          style={{ color: "var(--text-muted)" }}
        >
          Clear all
        </button>
      </div>

      {/* Cards */}
      <div className="flex flex-wrap gap-1.5">
        {attachments.map((att, i) => (
          <AttachmentCard
            key={att.id}
            attachment={att}
            index={i}
            total={attachments.length}
            onRemove={onRemove}
            onRetry={onRetry}
            onReorder={onReorder}
          />
        ))}
      </div>
    </div>
  );
}
