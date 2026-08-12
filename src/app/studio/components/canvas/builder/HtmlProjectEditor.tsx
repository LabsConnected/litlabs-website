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
  AlertCircle,
  Terminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useCanvasBuilderStore } from "./store";
import { buildHtmlPreview, type HtmlFileLanguage } from "./projectTypes";

interface ConsoleMessage {
  id: string;
  type: "error" | "warn" | "runtime_error" | "ready";
  text: string;
  timestamp: number;
}

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
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for console/error messages from the preview iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || e.data.source !== "litt-html-preview") return;
      const { type, payload } = e.data;

      if (type === "preview_ready") {
        setConsoleMessages([]);
        return;
      }

      let text = "";
      let msgType: ConsoleMessage["type"] = "error";

      if (type === "console_error") {
        text = payload;
        msgType = "error";
      } else if (type === "console_warn") {
        text = payload;
        msgType = "warn";
      } else if (type === "runtime_error") {
        text = payload.message + (payload.lineno ? ` (line ${payload.lineno})` : "") + (payload.stack ? `\n${payload.stack}` : "");
        msgType = "runtime_error";
      } else {
        return;
      }

      const msg: ConsoleMessage = {
        id: `console-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: msgType,
        text,
        timestamp: Date.now(),
      };
      setConsoleMessages((prev) => [...prev, msg]);
      // Auto-show console when errors arrive
      if (msgType === "error" || msgType === "runtime_error") {
        setShowConsole(true);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

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
    setConsoleMessages([]);
    setPreviewKey((k) => k + 1);
  }, []);

  const handleClearConsole = useCallback(() => {
    setConsoleMessages([]);
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
              <div className="flex-1" />
              {/* Console toggle */}
              <button
                type="button"
                onClick={() => setShowConsole(!showConsole)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold transition-colors"
                style={{
                  background: consoleMessages.some((m) => m.type === "error" || m.type === "runtime_error")
                    ? "rgba(239,68,68,0.15)"
                    : showConsole ? "rgba(255,255,255,0.08)" : "transparent",
                  color: consoleMessages.some((m) => m.type === "error" || m.type === "runtime_error")
                    ? "#fca5a5"
                    : "var(--glass-text-3)",
                }}
              >
                <Terminal size={10} />
                CONSOLE
                {consoleMessages.length > 0 && (
                  <span style={{ opacity: 0.7 }}>({consoleMessages.length})</span>
                )}
              </button>
            </div>
            <div className="flex-1 overflow-hidden" style={{ background: "white" }}>
              <iframe
                ref={iframeRef}
                key={previewKey}
                src={previewSrc}
                title="HTML Preview"
                className="w-full h-full border-0"
                sandbox="allow-scripts allow-modals allow-forms allow-popups"
              />
            </div>
            {/* Console panel */}
            {showConsole && (
              <div
                className="flex flex-col shrink-0 overflow-hidden"
                style={{
                  height: 180,
                  borderTop: "1px solid var(--glass-border)",
                  background: "#0d0e14",
                }}
              >
                <div
                  className="flex items-center gap-2 px-3 py-1.5 shrink-0"
                  style={{ borderBottom: "1px solid var(--glass-border)" }}
                >
                  <Terminal size={11} style={{ color: "var(--glass-text-3)" }} />
                  <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--glass-text-3)" }}>
                    Console
                  </span>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleClearConsole}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] transition-colors hover:bg-white/5"
                    style={{ color: "var(--glass-text-3)" }}
                  >
                    <Trash2 size={10} />
                    Clear
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
                  {consoleMessages.length === 0 ? (
                    <div className="text-[10px] italic" style={{ color: "var(--glass-text-3)" }}>
                      No errors. Console output from the preview will appear here.
                    </div>
                  ) : (
                    consoleMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="flex items-start gap-2 px-2 py-1 rounded mb-1"
                        style={{
                          background:
                            msg.type === "error" || msg.type === "runtime_error"
                              ? "rgba(239,68,68,0.08)"
                              : msg.type === "warn"
                                ? "rgba(245,158,11,0.08)"
                                : "transparent",
                        }}
                      >
                        <AlertCircle
                          size={11}
                          style={{
                            color:
                              msg.type === "error" || msg.type === "runtime_error"
                                ? "#fca5a5"
                                : msg.type === "warn"
                                  ? "#fcd34d"
                                  : "var(--glass-text-3)",
                            marginTop: 1,
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            color:
                              msg.type === "error" || msg.type === "runtime_error"
                                ? "#fca5a5"
                                : msg.type === "warn"
                                  ? "#fcd34d"
                                  : "#a1a1aa",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {msg.text}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
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
