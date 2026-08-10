"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Loader2, FileText, Image as ImageIcon, Music, Video, FileCode, AlertCircle, Download, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────

export interface FileSelectionState {
  path: string | null;
  content: string | null;
  size: number | null;
  loading: boolean;
  error: string | null;
  dirty: boolean;
}

interface StudioFilePreviewProps {
  projectId: string | null;
  selection: FileSelectionState;
}

// ─── Extension classification ─────────────────────────────────────

type FileCategory =
  | "image" | "svg" | "markdown" | "html" | "json" | "yaml"
  | "code" | "text" | "audio" | "video" | "pdf" | "env"
  | "font" | "binary" | "empty";

const EXT_CATEGORY: Record<string, FileCategory> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", avif: "image", bmp: "image", ico: "image",
  svg: "svg",
  md: "markdown", mdx: "markdown",
  html: "html", htm: "html",
  json: "json",
  yaml: "yaml", yml: "yaml",
  ts: "code", tsx: "code", js: "code", jsx: "code", mjs: "code",
  css: "code", scss: "code", sh: "code", sql: "code", toml: "code",
  txt: "text",
  mp3: "audio", wav: "audio", ogg: "audio", m4a: "audio",
  mp4: "video", webm: "video", mov: "video",
  pdf: "pdf",
  env: "env",
  ttf: "font", otf: "font", woff: "font", woff2: "font",
};

function getCategory(path: string): FileCategory {
  const name = path.split("/").pop() ?? path;
  if (name.startsWith(".env") || name === ".env") return "env";
  if (["Dockerfile", "LICENSE", "Makefile", "README"].includes(name)) return "text";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_CATEGORY[ext] ?? "binary";
}

function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── ENV masking ──────────────────────────────────────────────────

function maskEnvContent(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      // Don't mask comments or empty lines
      if (line.trim().startsWith("#") || !line.trim()) return line;
      // Mask values for keys that look like secrets
      if (/(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|PRIVATE|API_)/i.test(line)) {
        const eqIdx = line.indexOf("=");
        if (eqIdx > 0) {
          const key = line.slice(0, eqIdx);
          const value = line.slice(eqIdx + 1);
          // Show if value is empty or a placeholder
          if (!value.trim() || value.includes("your-") || value.includes("xxx") || value.includes("placeholder")) {
            return line;
          }
          return `${key}=********`;
        }
      }
      return line;
    })
    .join("\n");
}

// ─── SVG sanitization ─────────────────────────────────────────────

function sanitizeSvg(svgContent: string): string {
  // Remove script tags and event handlers
  return svgContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "");
}

// ─── Markdown rendering (minimal, sanitized) ──────────────────────

function renderMarkdown(md: string): string {
  // Minimal markdown to HTML — headings, bold, italic, code, links, lists
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Bold and italic
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  // Links — sanitize: only allow http/https
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//i.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    }
    return text;
  });
  // Lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");

  return html;
}

// ─── JSON formatting ──────────────────────────────────────────────

function formatJson(content: string): { formatted: string; error: string | null } {
  try {
    const parsed = JSON.parse(content);
    return { formatted: JSON.stringify(parsed, null, 2), error: null };
  } catch (err) {
    return { formatted: content, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

// ─── Component ────────────────────────────────────────────────────

export function StudioFilePreview({ projectId, selection }: StudioFilePreviewProps) {
  const { path, content, size, loading, error, dirty } = selection;
  const [zoom, setZoom] = useState(1);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const category = useMemo(() => (path ? getCategory(path) : "empty"), [path]);
  const ext = useMemo(() => (path ? getExtension(path) : ""), [path]);
  const fileName = useMemo(() => path?.split("/").pop() ?? path ?? "", [path]);

  // Build the raw file URL for binary/media files
  const rawUrl = useMemo(() => {
    if (!projectId || !path) return null;
    if (["image", "svg", "pdf", "audio", "video", "font", "binary"].includes(category)) {
      return `/api/studio-projects/${encodeURIComponent(projectId)}/files/raw?path=${encodeURIComponent(path)}`;
    }
    return null;
  }, [projectId, path, category]);

  // Fetch binary/media as blob URL (skip binary category — only needs download link)
  useEffect(() => {
    if (!rawUrl || category === "binary") {
      setMediaUrl(null);
      setMediaError(null);
      return;
    }

    let revoked = false;
    let fetchAbort: AbortController | null = null;

    async function fetchMedia() {
      setMediaError(null);
      fetchAbort = new AbortController();
      try {
        const resp = await fetch(rawUrl!, { signal: fetchAbort.signal, credentials: "include" });
        if (!resp.ok) {
          const data = await resp.json().catch(() => null) as { error?: string } | null;
          throw new Error(data?.error ?? `Failed to load (${resp.status})`);
        }
        const blob = await resp.blob();
        if (revoked) return;
        const url = URL.createObjectURL(blob);
        setMediaUrl(url);
      } catch (err) {
        if (revoked || (err instanceof DOMException && err.name === "AbortError")) return;
        setMediaError(err instanceof Error ? err.message : "Failed to load media");
      }
    }

    void fetchMedia();

    return () => {
      revoked = true;
      fetchAbort?.abort();
      setMediaUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [rawUrl, category]);

  // Reset zoom when file changes
  useEffect(() => { setZoom(1); }, [path]);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z + 0.25, 4)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z - 0.25, 0.25)), []);
  const handleResetZoom = useCallback(() => setZoom(1), []);

  // ─── Loading state ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" data-testid="file-preview-loading">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Loading {fileName}…</span>
      </div>
    );
  }

  // ─── Error state ────────────────────────────────────────────────

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center" data-testid="file-preview-error">
        <AlertCircle size={28} style={{ color: "#ef4444" }} />
        <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>Failed to load file</div>
        <div className="max-w-[300px] text-[10px]" style={{ color: "var(--text-muted)" }}>{error}</div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path } }))}
          className="rounded-lg px-3 py-1.5 text-[10px] font-bold"
          style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── Empty state ────────────────────────────────────────────────

  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" data-testid="file-preview-empty">
        <FileText size={32} opacity={0.2} style={{ color: "var(--text-muted)" }} />
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>Select a file to inspect or preview it.</p>
      </div>
    );
  }

  // ─── File header ────────────────────────────────────────────────

  const headerIcon = () => {
    switch (category) {
      case "image": case "svg": return <ImageIcon size={12} />;
      case "audio": return <Music size={12} />;
      case "video": return <Video size={12} />;
      case "code": case "json": case "yaml": case "html": case "markdown": return <FileCode size={12} />;
      default: return <FileText size={12} />;
    }
  };

  const header = (
    <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}>
      <span style={{ color: "var(--text-muted)" }}>{headerIcon()}</span>
      <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{fileName}</span>
      {dirty && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#e3b341" }} title="Unsaved changes" />}
      <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{ext.toUpperCase() || "FILE"}</span>
      {size != null && <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{formatBytes(size)}</span>}
      <div className="flex-1" />
      {/* Zoom controls for images */}
      {(category === "image" || category === "svg") && (
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={handleZoomOut} className="rounded p-0.5 hover:bg-white/8" style={{ color: "var(--text-muted)" }} title="Zoom out"><ZoomOut size={11} /></button>
          <span className="text-[9px] tabular-nums" style={{ color: "var(--text-muted)" }}>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={handleZoomIn} className="rounded p-0.5 hover:bg-white/8" style={{ color: "var(--text-muted)" }} title="Zoom in"><ZoomIn size={11} /></button>
          <button type="button" onClick={handleResetZoom} className="rounded p-0.5 hover:bg-white/8" style={{ color: "var(--text-muted)" }} title="Fit"><Maximize2 size={11} /></button>
        </div>
      )}
      {rawUrl && (
        <a
          href={rawUrl}
          download={fileName}
          className="rounded p-0.5 hover:bg-white/8"
          style={{ color: "var(--text-muted)" }}
          title="Download"
        >
          <Download size={11} />
        </a>
      )}
    </div>
  );

  // ─── Render by category ─────────────────────────────────────────

  function renderContent() {
    // Handle media loading states for binary/media types that fetch via blob
    if (["image", "svg", "pdf", "audio", "video", "font"].includes(category)) {
      if (mediaError) {
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <AlertCircle size={20} style={{ color: "#ef4444" }} />
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{mediaError}</span>
          </div>
        );
      }
      // For SVG, content is inline (no blob fetch needed)
      if (category === "svg" && content) {
        // Fall through to switch below
      } else if (!mediaUrl) {
        return (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        );
      }
    }

    switch (category) {
      // ─── Images ──────────────────────────────────────────────────
      case "image": {
        if (mediaError) {
          return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <AlertCircle size={20} style={{ color: "#ef4444" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{mediaError}</span>
            </div>
          );
        }
        if (!mediaUrl) {
          return (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          );
        }
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaUrl}
              alt={fileName}
              className="max-h-full transition-transform"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              data-testid="file-preview-image"
            />
          </div>
        );
      }

      // ─── SVG (sanitized) ─────────────────────────────────────────
      case "svg": {
        const sanitized = content ? sanitizeSvg(content) : "";
        return (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            <div
              className="transition-transform"
              style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              dangerouslySetInnerHTML={{ __html: sanitized }}
              data-testid="file-preview-svg"
            />
          </div>
        );
      }

      // ─── Markdown ────────────────────────────────────────────────
      case "markdown": {
        const html = content ? renderMarkdown(content) : "";
        return (
          <div className="min-h-0 flex-1 overflow-auto p-6">
            <div
              className="prose prose-invert max-w-none text-[12px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: html }}
              data-testid="file-preview-markdown"
            />
          </div>
        );
      }

      // ─── HTML (sandboxed iframe) ────────────────────────────────
      case "html": {
        const blob = content ? URL.createObjectURL(new Blob([content], { type: "text/html" })) : null;
        return (
          <div className="min-h-0 flex-1">
            {blob && (
              <iframe
                src={blob}
                title="HTML preview"
                className="h-full w-full border-0 bg-white"
                sandbox="allow-scripts"
                data-testid="file-preview-html"
              />
            )}
          </div>
        );
      }

      // ─── JSON ────────────────────────────────────────────────────
      case "json": {
        const { formatted, error: jsonError } = content ? formatJson(content) : { formatted: "", error: null };
        return (
          <div className="min-h-0 flex-1 overflow-auto" data-testid="file-preview-json">
            {jsonError ? (
              <div className="flex items-center gap-2 px-4 py-2 text-[11px]" style={{ color: "#ef4444" }}>
                <AlertCircle size={14} />
                <span>JSON syntax error: {jsonError}</span>
              </div>
            ) : null}
            <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {formatted}
            </pre>
          </div>
        );
      }

      // ─── YAML ────────────────────────────────────────────────────
      case "yaml": {
        return (
          <div className="min-h-0 flex-1 overflow-auto" data-testid="file-preview-yaml">
            <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {content}
            </pre>
          </div>
        );
      }

      // ─── ENV (masked) ────────────────────────────────────────────
      case "env": {
        const masked = content ? maskEnvContent(content) : "";
        return (
          <div className="min-h-0 flex-1 overflow-auto" data-testid="file-preview-env">
            <div className="border-b px-3 py-1.5 text-[9px]" style={{ borderColor: "var(--studio-border)", color: "#e3b341" }}>
              Secrets are masked for safety
            </div>
            <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {masked}
            </pre>
          </div>
        );
      }

      // ─── Code / Text ─────────────────────────────────────────────
      case "code": case "text": {
        return (
          <div className="min-h-0 flex-1 overflow-auto" data-testid="file-preview-code">
            <pre className="px-4 py-3 text-[11px] font-mono leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {content}
            </pre>
          </div>
        );
      }

      // ─── PDF ─────────────────────────────────────────────────────
      case "pdf": {
        if (mediaError) {
          return (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <AlertCircle size={20} style={{ color: "#ef4444" }} />
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{mediaError}</span>
            </div>
          );
        }
        if (!mediaUrl) {
          return (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          );
        }
        return (
          <div className="min-h-0 flex-1">
            <iframe
              src={mediaUrl}
              title="PDF preview"
              className="h-full w-full border-0"
              data-testid="file-preview-pdf"
            />
          </div>
        );
      }

      // ─── Audio ───────────────────────────────────────────────────
      case "audio": {
        if (mediaError) return <MediaError message={mediaError} />;
        if (!mediaUrl) return <LoadingSpinner />;
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6" data-testid="file-preview-audio">
            <Music size={48} style={{ color: "var(--text-muted)" }} />
            <audio controls src={mediaUrl} className="w-full max-w-md" />
          </div>
        );
      }

      // ─── Video ───────────────────────────────────────────────────
      case "video": {
        if (mediaError) return <MediaError message={mediaError} />;
        if (!mediaUrl) return <LoadingSpinner />;
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6" data-testid="file-preview-video">
            <video controls src={mediaUrl} className="max-h-full max-w-full" />
          </div>
        );
      }

      // ─── Font ────────────────────────────────────────────────────
      case "font": {
        if (mediaError) return <MediaError message={mediaError} />;
        if (!mediaUrl) return <LoadingSpinner />;
        const fontName = `preview-font-${ext}`;
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8" data-testid="file-preview-font">
            <style>{`@font-face { font-family: "${fontName}"; src: url("${mediaUrl}"); }`}</style>
            <div style={{ fontFamily: fontName, fontSize: "48px", color: "var(--text-primary)" }}>Aa Bb Cc 123</div>
            <div style={{ fontFamily: fontName, fontSize: "16px", color: "var(--text-muted)" }}>
              The quick brown fox jumps over the lazy dog
            </div>
          </div>
        );
      }

      // ─── Binary / unsupported ────────────────────────────────────
      default: {
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="file-preview-binary">
            <FileText size={32} opacity={0.2} style={{ color: "var(--text-muted)" }} />
            <div className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{fileName}</div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              {ext.toUpperCase() || "Unknown"} · {size != null ? formatBytes(size) : "Unknown size"}
            </div>
            <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>Preview isn&apos;t available for this file type.</div>
            {rawUrl && (
              <a
                href={rawUrl}
                download={fileName}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-bold"
                style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}
              >
                <Download size={12} /> Download
              </a>
            )}
          </div>
        );
      }
    }
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-testid="studio-file-preview">
      {header}
      <div className="flex min-h-0 flex-1 flex-col">
        {renderContent()}
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────

function LoadingSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

function MediaError({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <AlertCircle size={20} style={{ color: "#ef4444" }} />
      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{message}</span>
    </div>
  );
}
