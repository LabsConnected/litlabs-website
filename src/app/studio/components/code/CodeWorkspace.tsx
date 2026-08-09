"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Loader2,
  RefreshCw,
  Save,
  X,
  Code2,
  Eye,
  Columns2,
  Terminal,
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import StudioPreviewPanel from "../StudioPreviewPanel";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.default), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  type: "file" | "folder";
  path: string;
  size?: number;
  gitStatus?: "M" | "A" | "D" | "U" | "C";
}

type ViewMode = "code" | "split" | "preview";

const TEXT_EXTENSIONS = new Set([
  "astro", "css", "csv", "env", "html", "jsx", "json", "md", "mdx",
  "mjs", "scss", "sh", "sql", "svg", "toml", "ts", "tsx", "txt", "yaml", "yml",
]);

function isTextFile(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (["Dockerfile", "LICENSE", "Makefile", "README"].includes(name) || name.startsWith(".env")) return true;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(ext);
}

function getLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", css: "css", scss: "scss", html: "html", md: "markdown",
    yaml: "yaml", yml: "yaml", sh: "shell", sql: "sql", svg: "xml",
    astro: "typescript", toml: "ini", env: "ini", txt: "plaintext",
  };
  return map[ext] ?? "plaintext";
}

// ─── Component ────────────────────────────────────────────────────

export function CodeWorkspace({
  projectId,
  repositoryName,
  branch,
  workspaceStatus,
  writeAccess,
}: {
  projectId: string | null;
  repositoryName: string | null;
  branch: string | null;
  workspaceStatus: string | null;
  writeAccess: boolean;
}) {
  const { getToken } = useClerkAuth();
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["."]));
  const [openTabs, setOpenTabs] = useState<{ path: string; content: string; original: string }[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const editorRef = useRef<unknown>(null);

  const authHeaders = useCallback(async (json = false): Promise<HeadersInit> => {
    const token = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const requestJson = useCallback(async (url: string, init?: RequestInit) => {
    const response = await fetch(url, {
      credentials: "include",
      ...init,
      headers: { ...(await authHeaders(Boolean(init?.body))), ...(init?.headers ?? {}) },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${response.status})`);
    return payload;
  }, [authHeaders]);

  // Load directory
  const loadDirectory = useCallback(async (dir: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(dir)}`);
      if (!payload || !Array.isArray(payload.entries)) throw new Error("Malformed response");
      const items: FileEntry[] = payload.entries
        .filter((e: unknown) => e && typeof e === "object" && typeof (e as FileEntry).name === "string")
        .map((e: unknown) => {
          const raw = e as FileEntry;
          return {
            name: raw.name,
            type: raw.type,
            size: raw.size,
            path: dir === "." ? raw.name : `${dir}/${raw.name}`,
          };
        })
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
      setEntries((prev) => ({ ...prev, [dir]: items }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [projectId, requestJson]);

  // Load root on mount
  useEffect(() => {
    setEntries({});
    setExpanded(new Set(["."]));
    setOpenTabs([]);
    setActiveTab(null);
    if (projectId) void loadDirectory(".");
  }, [projectId, loadDirectory]);

  // Open file
  const openFile = useCallback(async (path: string) => {
    if (!projectId) return;
    if (!isTextFile(path)) {
      setError(`Cannot open binary file: ${path}`);
      return;
    }
    // Check if already open
    const existing = openTabs.find((t) => t.path === path);
    if (existing) {
      setActiveTab(path);
      return;
    }
    setFileLoading(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
        method: "POST",
        body: JSON.stringify({ action: "read", path }),
      });
      const content = typeof payload?.content === "string" ? payload.content : "";
      setOpenTabs((prev) => [...prev, { path, content, original: content }]);
      setActiveTab(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setFileLoading(false);
    }
  }, [projectId, requestJson, openTabs]);

  // Save file
  const saveFile = useCallback(async (path: string) => {
    if (!projectId || !writeAccess) return;
    const tab = openTabs.find((t) => t.path === path);
    if (!tab) return;
    setSaving(true);
    try {
      await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
        method: "POST",
        body: JSON.stringify({ action: "write", path, content: tab.content }),
      });
      // Mark as saved
      setOpenTabs((prev) => prev.map((t) => t.path === path ? { ...t, original: t.content } : t));
      // Refresh preview
      setPreviewRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [projectId, requestJson, writeAccess, openTabs]);

  // Close tab
  const closeTab = useCallback((path: string) => {
    setOpenTabs((prev) => prev.filter((t) => t.path !== path));
    setActiveTab((prev) => prev === path ? null : prev);
  }, []);

  // Update tab content
  const updateTabContent = useCallback((path: string, content: string) => {
    setOpenTabs((prev) => prev.map((t) => t.path === path ? { ...t, content } : t));
  }, []);

  // Toggle folder
  const toggleFolder = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!entries[path]) void loadDirectory(path);
  }, [entries, loadDirectory]);

  // Keyboard: Ctrl+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && activeTab) {
        e.preventDefault();
        void saveFile(activeTab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, saveFile]);

  const activeTabData = openTabs.find((t) => t.path === activeTab);
  const isDirty = activeTabData && activeTabData.content !== activeTabData.original;

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ backgroundColor: "#0a0b10" }}>
      {/* Top bar: view toggle + repo info */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5 glass-toolbar"
        style={{ borderColor: "var(--glass-border)", borderRadius: 0 }}
      >
        {repositoryName && (
          <span className="text-[10px] font-bold" style={{ color: "var(--text-secondary)" }} title={repositoryName}>
            {repositoryName}
          </span>
        )}
        {branch && (
          <>
            <span style={{ color: "var(--studio-border-strong)" }}>·</span>
            <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>{branch}</span>
          </>
        )}
        <div className="flex-1" />
        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 rounded-md p-0.5" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
          {([
            { id: "code" as ViewMode, icon: Code2, label: "Code" },
            { id: "split" as ViewMode, icon: Columns2, label: "Split" },
            { id: "preview" as ViewMode, icon: Eye, label: "Preview" },
          ]).map((mode) => {
            const Icon = mode.icon;
            const isActive = viewMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setViewMode(mode.id)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold transition"
                style={{
                  backgroundColor: isActive ? "rgba(155,77,255,0.15)" : "transparent",
                  color: isActive ? "#9b4dff" : "var(--text-muted)",
                }}
                title={mode.label}
              >
                <Icon size={11} />
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 border-b px-3 py-1.5 text-[11px]" style={{ borderColor: "rgba(239,68,68,0.2)", backgroundColor: "rgba(239,68,68,0.06)", color: "#fca5a5" }}>
          {error}
          <button type="button" onClick={() => setError(null)} className="ml-2 text-[10px] underline">dismiss</button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex min-h-0 flex-1">
        {/* Left: File Explorer */}
        <div
          className="shrink-0 overflow-y-auto glass-panel"
          style={{ width: 220, borderRight: "1px solid var(--glass-border)", borderRadius: 0 }}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between px-2.5 py-2" style={{ backgroundColor: "var(--studio-surface)", borderBottom: "1px solid var(--studio-border)" }}>
            <span className="text-[10px] font-black uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>Files</span>
            <button
              type="button"
              onClick={() => projectId && void loadDirectory(".")}
              className="rounded p-0.5 transition hover:bg-white/8"
              style={{ color: "var(--text-muted)" }}
              title="Refresh"
            >
              <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
          <FileTree
            entries={entries}
            expanded={expanded}
            activePath={activeTab}
            onToggle={toggleFolder}
            onOpen={openFile}
            loading={loading}
          />
        </div>

        {/* Center: Editor + Preview */}
        <div className="flex min-w-0 flex-1">
          {/* Editor */}
          {(viewMode === "code" || viewMode === "split") && (
            <div className="flex min-w-0 flex-1 flex-col" style={viewMode === "split" ? { borderRight: "1px solid var(--studio-border)" } : {}}>
              {/* Tabs */}
              <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)", minHeight: 32 }}>
                {openTabs.length === 0 && (
                  <span className="px-2 py-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>No file open</span>
                )}
                {openTabs.map((tab) => {
                  const dirty = tab.content !== tab.original;
                  const isActive = tab.path === activeTab;
                  const name = tab.path.split("/").pop() ?? tab.path;
                  return (
                    <div
                      key={tab.path}
                      onClick={() => setActiveTab(tab.path)}
                      className="group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t px-2.5 py-1.5 text-[11px] font-medium transition"
                      style={{
                        backgroundColor: isActive ? "#0a0b10" : "transparent",
                        color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                        borderBottom: isActive ? "2px solid #9b4dff" : "2px solid transparent",
                      }}
                    >
                      <span className="truncate max-w-[120px]">{name}</span>
                      {dirty && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#e3b341" }} />}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                        className="rounded p-0.5 opacity-0 transition group-hover:opacity-100 hover:bg-white/10"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                <div className="flex-1" />
                {activeTab && isDirty && writeAccess && (
                  <button
                    type="button"
                    onClick={() => void saveFile(activeTab)}
                    disabled={saving}
                    className="flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-bold transition hover:bg-white/8"
                    style={{ color: "#72f238" }}
                    title="Save (Ctrl+S)"
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                    Save
                  </button>
                )}
              </div>

              {/* Monaco Editor */}
              <div className="min-h-0 flex-1">
                {fileLoading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                  </div>
                ) : activeTabData ? (
                  <MonacoEditor
                    height="100%"
                    language={getLanguage(activeTabData.path)}
                    value={activeTabData.content}
                    theme="vs-dark"
                    onChange={(value) => updateTabContent(activeTabData.path, value ?? "")}
                    onMount={(editor) => { editorRef.current = editor; }}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontLigatures: true,
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      tabSize: 2,
                      automaticLayout: true,
                      padding: { top: 12 },
                      lineNumbers: "on",
                      folding: true,
                      renderWhitespace: "selection",
                      smoothScrolling: true,
                      cursorBlinking: "smooth",
                      cursorSmoothCaretAnimation: "on",
                    }}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2">
                    <FileText size={32} opacity={0.2} style={{ color: "var(--text-muted)" }} />
                    <p className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>Open a file from the sidebar</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          {(viewMode === "preview" || viewMode === "split") && (
            <div className="flex min-w-0 flex-1 flex-col">
              <StudioPreviewPanel
                projectId={projectId}
                projectName={repositoryName}
                repositoryName={repositoryName}
                branch={branch}
                workspaceStatus={workspaceStatus}
                refreshKey={previewRefreshKey}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── File Tree Component ──────────────────────────────────────────

function FileTree({
  entries,
  expanded,
  activePath,
  onToggle,
  onOpen,
  loading,
}: {
  entries: Record<string, FileEntry[]>;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  loading: boolean;
}) {
  function renderDir(dir: string, depth: number): React.ReactNode {
    const items = entries[dir];
    if (!items) return null;
    return items.map((item) => {
      const isExpanded = expanded.has(item.path);
      const isActive = activePath === item.path;
      const indent = depth * 12 + 8;

      if (item.type === "folder") {
        return (
          <div key={item.path}>
            <button
              type="button"
              onClick={() => onToggle(item.path)}
              className="flex w-full items-center gap-1 py-1 pr-2 text-left transition hover:bg-white/4"
              style={{ paddingLeft: indent, color: "var(--text-secondary)" }}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={12} style={{ color: "var(--text-muted)" }} />
              <span className="truncate text-[11px] font-medium">{item.name}</span>
            </button>
            {isExpanded && renderDir(item.path, depth + 1)}
          </div>
        );
      }

      return (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item.path)}
          className="flex w-full items-center gap-1 py-1 pr-2 text-left transition hover:bg-white/4"
          style={{ paddingLeft: indent + 16, color: isActive ? "#9b4dff" : "var(--text-secondary)" }}
        >
          <FileText size={11} style={{ color: isActive ? "#9b4dff" : "var(--text-muted)" }} />
          <span className="truncate text-[11px] font-medium" style={{ fontWeight: isActive ? 700 : 400 }}>{item.name}</span>
        </button>
      );
    });
  }

  if (loading && Object.keys(entries).length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  return <div className="py-1">{renderDir(".", 0)}</div>;
}
