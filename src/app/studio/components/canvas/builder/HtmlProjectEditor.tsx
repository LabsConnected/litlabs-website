"use client";

/**
 * HtmlProjectEditor — the workspace for HTML/CSS/JS projects.
 *
 * Shows:
 *   - File tabs (index.html / style.css / script.js)
 *   - Code editor (textarea with monospace font)
 *   - Live preview iframe (rebuilds on every edit)
 *   - Toggle between Code / Preview / Split views
 *
 * The preview combines all files into a single HTML blob and renders
 * it in a sandboxed iframe — no server round-trip needed.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Code2,
  Eye,
  Columns2,
  RefreshCw,
  FileCode,
  FileType2,
  FileJson,
  type LucideIcon,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import { buildHtmlPreview, type HtmlFileLanguage } from "./projectTypes";

const FILE_ICONS: Record<string, LucideIcon> = {
  "index.html": FileCode,
  "style.css": FileType2,
  "script.js": FileJson,
};

const FILE_LANG_LABEL: Record<HtmlFileLanguage, string> = {
  html: "HTML",
  css: "CSS",
  javascript: "JS",
};

type ViewMode = "code" | "preview" | "split";

export function HtmlProjectEditor() {
  const htmlProject = useCanvasBuilderStore((s) => s.htmlProject);
  const updateHtmlFile = useCanvasBuilderStore((s) => s.updateHtmlFile);
  const setActiveHtmlFile = useCanvasBuilderStore((s) => s.setActiveHtmlFile);

  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeFile = htmlProject.files.find((f) => f.name === htmlProject.activeFile) ?? htmlProject.files[0];

  // Build the preview HTML blob — memoized so it only rebuilds when files change
  const previewHtml = useMemo(() => buildHtmlPreview(htmlProject.files), [htmlProject.files]);

  const previewSrc = useMemo(() => {
    const blob = new Blob([previewHtml], { type: "text/html" });
    return URL.createObjectURL(blob);
  }, [previewHtml, previewKey]);

  // Revoke old blob URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(previewSrc);
    };
  }, [previewSrc]);

  const handleRefresh = useCallback(() => {
    setPreviewKey((k) => k + 1);
  }, []);

  const handleCodeChange = useCallback(
    (content: string) => {
      updateHtmlFile(activeFile.name, content);
    },
    [activeFile.name, updateHtmlFile],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
      {/* Top bar: view mode toggle + refresh */}
      <div
        className="flex items-center gap-2 px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--glass-border)" }}
      >
        <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "rgba(255,255,255,0.04)" }}>
          <ViewModeButton mode="code" current={viewMode} onClick={setViewMode} icon={Code2} label="Code" />
          <ViewModeButton mode="split" current={viewMode} onClick={setViewMode} icon={Columns2} label="Split" />
          <ViewModeButton mode="preview" current={viewMode} onClick={setViewMode} icon={Eye} label="Preview" />
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-semibold transition-colors hover:bg-white/5"
          style={{ color: "var(--glass-text-3)" }}
          title="Refresh preview"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Code side */}
        {viewMode !== "preview" && (
          <div className="flex flex-col overflow-hidden" style={{ width: viewMode === "split" ? "50%" : "100%" }}>
            {/* File tabs */}
            <div
              className="flex items-center gap-0 shrink-0 overflow-x-auto"
              style={{ borderBottom: "1px solid var(--glass-border)" }}
            >
              {htmlProject.files.map((file) => {
                const Icon = FILE_ICONS[file.name] ?? FileCode;
                const isActive = file.name === htmlProject.activeFile;
                return (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => setActiveHtmlFile(file.name)}
                    className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors whitespace-nowrap"
                    style={{
                      color: isActive ? "var(--text-primary)" : "var(--glass-text-3)",
                      borderBottom: isActive ? "2px solid var(--glass-purple)" : "2px solid transparent",
                      background: isActive ? "rgba(155,77,255,0.05)" : "transparent",
                    }}
                  >
                    <Icon size={12} style={{ opacity: isActive ? 1 : 0.5 }} />
                    {file.name}
                  </button>
                );
              })}
            </div>

            {/* Code editor */}
            <div className="flex-1 overflow-auto" style={{ background: "#0d0e14" }}>
              <textarea
                value={activeFile.content}
                onChange={(e) => handleCodeChange(e.target.value)}
                spellCheck={false}
                className="w-full h-full resize-none border-0 outline-none p-4 font-mono text-[13px] leading-relaxed"
                style={{
                  background: "transparent",
                  color: "#e4e4e7",
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
                  tabSize: 2,
                }}
                placeholder={`Write ${FILE_LANG_LABEL[activeFile.language]} here...`}
              />
            </div>

            {/* File info bar */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 shrink-0 text-[10px]"
              style={{
                color: "var(--glass-text-3)",
                borderTop: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <span>{activeFile.name}</span>
              <span>·</span>
              <span>{FILE_LANG_LABEL[activeFile.language]}</span>
              <span>·</span>
              <span>{activeFile.content.split("\n").length} lines</span>
              <span>·</span>
              <span>{activeFile.content.length} chars</span>
            </div>
          </div>
        )}

        {/* Divider */}
        {viewMode === "split" && (
          <div style={{ width: 1, background: "var(--glass-border)" }} />
        )}

        {/* Preview side */}
        {viewMode !== "code" && (
          <div className="flex flex-col overflow-hidden flex-1">
            <div
              className="flex items-center gap-2 px-3 py-1.5 shrink-0 text-[10px] font-semibold"
              style={{
                color: "var(--glass-text-3)",
                borderBottom: "1px solid var(--glass-border)",
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <Eye size={12} />
              LIVE PREVIEW
            </div>
            <div className="flex-1 overflow-hidden" style={{ background: "white" }}>
              <iframe
                ref={iframeRef}
                key={previewKey}
                src={previewSrc}
                title="HTML Preview"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── View mode toggle button ─────────────────────────────────────────

function ViewModeButton({
  mode,
  current,
  onClick,
  icon: Icon,
  label,
}: {
  mode: ViewMode;
  current: ViewMode;
  onClick: (mode: ViewMode) => void;
  icon: LucideIcon;
  label: string;
}) {
  const isActive = mode === current;
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all"
      style={{
        background: isActive ? "rgba(155,77,255,0.15)" : "transparent",
        color: isActive ? "var(--glass-purple)" : "var(--glass-text-3)",
      }}
    >
      <Icon size={12} />
      {label}
    </button>
  );
}
