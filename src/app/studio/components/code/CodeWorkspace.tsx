"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
  Code2,
  Eye,
  Columns2,
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

type DialogState =
  | { kind: "file" | "folder"; directory: string; value: string }
  | { kind: "rename"; sourcePath: string; value: string }
  | null;

type MutationAction = "write" | "delete" | "mkdir" | "rename";

const GIT_BADGE_COLORS: Record<NonNullable<FileEntry["gitStatus"]>, { bg: string; color: string; label: string }> = {
  M: { bg: "rgba(227,179,65,0.15)", color: "#e3b341", label: "Modified" },
  A: { bg: "rgba(114,242,56,0.15)", color: "#72f238", label: "Added" },
  D: { bg: "rgba(239,68,68,0.15)", color: "#ef4444", label: "Deleted" },
  U: { bg: "rgba(96,165,250,0.15)", color: "#60a5fa", label: "Untracked" },
  C: { bg: "rgba(34,211,238,0.15)", color: "#22d3ee", label: "Conflict" },
};

function normalizePath(value: string): string {
  const path = value.replace(/\\/g, "/").trim();
  if (!path || path === ".") return ".";
  if (path.startsWith("/") || path.includes("\0")) throw new Error("Invalid workspace path");
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => segment === ".." || segment === ".")) {
    throw new Error("Parent paths are not allowed");
  }
  return segments.join("/");
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? "." : normalized.slice(0, slash);
}

function baseName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.split("/").pop() ?? normalized;
}

function joinPath(directory: string, name: string): string {
  const cleanName = name.trim();
  if (!cleanName || cleanName === "." || cleanName === ".." || /[\\/\0]/.test(cleanName)) {
    throw new Error("Use a single valid file or folder name");
  }
  const base = directory === "." ? "" : normalizePath(directory);
  return base ? `${base}/${cleanName}` : cleanName;
}

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
  const [preparing, setPreparing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
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
  const loadDirectory = useCallback(async (dir: string, silent = false) => {
    if (!projectId) return;
    const safeDir = normalizePath(dir);
    if (!silent) setLoading(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(safeDir)}`);
      if (!payload || !Array.isArray(payload.entries)) throw new Error("Malformed response");
      const items: FileEntry[] = payload.entries
        .filter((e: unknown) => e && typeof e === "object" && typeof (e as FileEntry).name === "string")
        .map((e: unknown) => {
          const raw = e as FileEntry;
          return {
            name: raw.name,
            type: raw.type,
            size: raw.size,
            gitStatus: raw.gitStatus,
            path: safeDir === "." ? raw.name : `${safeDir}/${raw.name}`,
          };
        })
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
      setEntries((prev) => ({ ...prev, [safeDir]: items }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load files";
      if ((msg.includes("Workspace not found") || msg.includes("Workspace not provisioned") || msg.includes("Workspace not ready")) && !preparing) {
        setPreparing(true);
        try {
          const prepPayload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`, { method: "POST" });
          if (prepPayload && prepPayload.workspaceStatus === "ready") {
            const retryPayload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(safeDir)}`);
            if (retryPayload && Array.isArray(retryPayload.entries)) {
              const retryItems: FileEntry[] = retryPayload.entries
                .filter((e: unknown) => e && typeof e === "object" && typeof (e as FileEntry).name === "string")
                .map((e: unknown) => {
                  const raw = e as FileEntry;
                  return { name: raw.name, type: raw.type, size: raw.size, gitStatus: raw.gitStatus, path: safeDir === "." ? raw.name : `${safeDir}/${raw.name}` };
                })
                .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
              setEntries((prev) => ({ ...prev, [safeDir]: retryItems }));
              return;
            }
          }
          setError(typeof prepPayload?.error === "string" ? prepPayload.error : "Workspace re-preparation failed");
        } catch {
          setError("Workspace was lost and could not be re-prepared automatically");
        } finally {
          setPreparing(false);
        }
      } else {
        setError(msg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, requestJson, preparing]);

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
      setOpenTabs((prev) => prev.map((t) => t.path === path ? { ...t, original: t.content } : t));
      void loadDirectory(parentPath(path), true);
      setPreviewRefreshKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [projectId, requestJson, writeAccess, openTabs, loadDirectory]);

  // Generic mutation helper
  const mutate = useCallback(async (action: MutationAction, body: Record<string, unknown>) => {
    if (!projectId) throw new Error("No project selected");
    if (!writeAccess) throw new Error("Workspace writes are unavailable");
    setMutating(true);
    try {
      await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
        method: "POST",
        body: JSON.stringify({ action, ...body }),
      });
    } finally {
      setMutating(false);
    }
  }, [projectId, requestJson, writeAccess]);

  // Dialog submit (create file/folder, rename)
  const submitDialog = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dialog) return;
    setError(null);
    try {
      if (dialog.kind === "file") {
        const path = joinPath(dialog.directory, dialog.value);
        await mutate("write", { path, content: "" });
        await loadDirectory(dialog.directory, true);
        setDialog(null);
        window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path } }));
      } else if (dialog.kind === "folder") {
        const path = joinPath(dialog.directory, dialog.value);
        await mutate("mkdir", { path });
        await loadDirectory(dialog.directory, true);
        setDialog(null);
        window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path } }));
      } else if (dialog.kind === "rename") {
        const path = normalizePath(dialog.sourcePath);
        const newPath = joinPath(parentPath(path), dialog.value);
        await mutate("rename", { path, newPath });
        // Clear cached entries for old path and its children
        setEntries((prev) => {
          const next: Record<string, FileEntry[]> = {};
          for (const key of Object.keys(prev)) {
            if (key === path || key.startsWith(`${path}/`)) continue;
            next[key] = prev[key];
          }
          return next;
        });
        await loadDirectory(parentPath(path), true);
        // Update open tabs that match the renamed path or are inside it
        const prefix = `${path}/`;
        setOpenTabs((prev) => prev.map((t) => {
          if (t.path === path) return { ...t, path: newPath };
          if (t.path.startsWith(prefix)) return { ...t, path: `${newPath}/${t.path.slice(prefix.length)}` };
          return t;
        }));
        setActiveTab((current) => {
          if (current === path) return newPath;
          if (current?.startsWith(prefix)) return `${newPath}/${current.slice(prefix.length)}`;
          return current;
        });
        setDialog(null);
        window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path: newPath } }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File operation failed");
    }
  }, [dialog, mutate, loadDirectory, projectId]);

  // Close tab
  const closeTab = useCallback((path: string) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const tab = prev[idx];
      if (tab.content !== tab.original) {
        if (!window.confirm(`Close ${path}? Unsaved changes will be lost.`)) return prev;
      }
      const remaining = prev.filter((t) => t.path !== path);
      setActiveTab((current) => {
        if (current !== path) return current;
        if (remaining.length === 0) return null;
        const newIdx = Math.min(idx, remaining.length - 1);
        return remaining[newIdx].path;
      });
      return remaining;
    });
  }, []);

  // Delete entry
  const deleteEntry = useCallback(async (entry: FileEntry) => {
    if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
    setError(null);
    try {
      await mutate("delete", { path: normalizePath(entry.path) });
      await loadDirectory(parentPath(entry.path), true);
      // Close all open tabs for the deleted file, or all files inside a deleted folder
      const prefix = `${entry.path}/`;
      setOpenTabs((prev) => {
        const remaining = prev.filter((t) => t.path !== entry.path && !t.path.startsWith(prefix));
        setActiveTab((current) => {
          if (current === entry.path || current?.startsWith(prefix)) {
            return remaining.length > 0 ? remaining[remaining.length - 1].path : null;
          }
          return current;
        });
        return remaining;
      });
      window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, path: entry.path } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }, [mutate, loadDirectory, projectId]);

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

  // Keyboard: Ctrl+S to save, Ctrl+W to close tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s" && activeTab) {
        e.preventDefault();
        void saveFile(activeTab);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "w" && activeTab) {
        e.preventDefault();
        closeTab(activeTab);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeTab, saveFile, closeTab]);

  // Listen for external file change events (e.g. from Canvas or chat)
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        const changedPath = typeof detail.path === "string" ? detail.path : ".";
        void loadDirectory(parentPath(changedPath), true);
        // Also reload root to catch top-level changes
        if (changedPath !== ".") void loadDirectory(".", true);
        setPreviewRefreshKey((k) => k + 1);
      }
    };
    window.addEventListener("studio:files-changed", handler);
    return () => window.removeEventListener("studio:files-changed", handler);
  }, [projectId, loadDirectory]);

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
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => setDialog({ kind: "file", directory: ".", value: "" })}
                disabled={!writeAccess}
                className="rounded p-0.5 transition hover:bg-white/8 disabled:opacity-30"
                style={{ color: "var(--text-muted)" }}
                title="New file"
              >
                <Plus size={11} />
              </button>
              <button
                type="button"
                onClick={() => setDialog({ kind: "folder", directory: ".", value: "" })}
                disabled={!writeAccess}
                className="rounded p-0.5 transition hover:bg-white/8 disabled:opacity-30"
                style={{ color: "var(--text-muted)" }}
                title="New folder"
              >
                <FolderPlus size={11} />
              </button>
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
          </div>
          {/* Dialog: create file/folder or rename */}
          {dialog && (
            <form onSubmit={submitDialog} className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: "var(--studio-border)" }}>
              <span className="min-w-0 truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                {dialog.kind === "rename" ? `Rename ${baseName(dialog.sourcePath)}` : dialog.kind === "folder" ? "New folder" : "New file"}
              </span>
              <input
                autoFocus
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                className="min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-[10px] outline-none"
                style={{ borderColor: "var(--studio-border)", color: "var(--text-primary)" }}
                aria-label="Name"
              />
              <button type="submit" className="rounded p-1" style={{ backgroundColor: "var(--litt-primary)", color: "#000" }} aria-label="Confirm">
                <Save size={10} />
              </button>
              <button type="button" onClick={() => setDialog(null)} className="rounded p-1 hover:bg-white/8" style={{ color: "var(--text-muted)" }} aria-label="Cancel">
                <X size={10} />
              </button>
            </form>
          )}
          {preparing && (
            <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[10px]" style={{ borderColor: "rgba(227,179,65,0.2)", color: "#e3b341" }}>
              <Loader2 size={11} className="animate-spin" /> Preparing workspace…
            </div>
          )}
          {mutating && (
            <div className="flex items-center gap-1.5 border-b px-2.5 py-1.5 text-[10px]" style={{ borderColor: "rgba(155,77,255,0.2)", color: "#9b4dff" }}>
              <Loader2 size={11} className="animate-spin" /> Working…
            </div>
          )}
          <FileTree
            entries={entries}
            expanded={expanded}
            activePath={activeTab}
            onToggle={toggleFolder}
            onOpen={openFile}
            onRename={(path, name) => setDialog({ kind: "rename", sourcePath: path, value: name })}
            onDelete={deleteEntry}
            onCreateFile={(dir) => setDialog({ kind: "file", directory: dir, value: "" })}
            onCreateFolder={(dir) => setDialog({ kind: "folder", directory: dir, value: "" })}
            writeAccess={writeAccess}
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

              {/* Breadcrumb + quick actions */}
              {activeTabData && (
                <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}>
                  <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                    {activeTabData.path.split("/").map((seg, i, arr) => (
                      <span key={i} className="flex items-center gap-0.5 shrink-0">
                        {i > 0 && <span style={{ color: "var(--studio-border-strong)" }}>/</span>}
                        <span style={{ color: i === arr.length - 1 ? "var(--text-primary)" : "var(--text-muted)", fontWeight: i === arr.length - 1 ? 700 : 400 }}>{seg}</span>
                      </span>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {[
                      { label: "Explain", prompt: `Explain what ${activeTabData.path} does` },
                      { label: "Fix", prompt: `Find and fix bugs in ${activeTabData.path}` },
                      { label: "Refactor", prompt: `Refactor ${activeTabData.path} for clarity` },
                      { label: "Ask LiTT", prompt: `Review ${activeTabData.path}` },
                    ].map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        onClick={() => window.dispatchEvent(new CustomEvent("studio:quick-action", { detail: { prompt: action.prompt } }))}
                        className="rounded px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-white/8"
                        style={{ color: "var(--text-muted)" }}
                        title={action.prompt}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
  onRename,
  onDelete,
  onCreateFile,
  onCreateFolder,
  writeAccess,
  loading,
}: {
  entries: Record<string, FileEntry[]>;
  expanded: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onRename: (path: string, name: string) => void;
  onDelete: (entry: FileEntry) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  writeAccess: boolean;
  loading: boolean;
}) {
  function renderDir(dir: string, depth: number): React.ReactNode {
    const items = entries[dir];
    if (!items) return null;
    return items.map((item) => {
      const isExpanded = expanded.has(item.path);
      const isActive = activePath === item.path;
      const indent = depth * 12 + 8;
      const name = item.name;

      if (item.type === "folder") {
        return (
          <div key={item.path}>
            <div className="group flex items-center" style={{ paddingLeft: indent }}>
              <button
                type="button"
                onClick={() => onToggle(item.path)}
                className="flex flex-1 items-center gap-1 py-1 pr-1 text-left transition hover:bg-white/4"
                style={{ color: "var(--text-secondary)" }}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Folder size={12} style={{ color: "var(--text-muted)" }} />
                <span className="truncate text-[11px] font-medium">{name}</span>
                {item.gitStatus && <GitBadge status={item.gitStatus} />}
              </button>
              <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                <button type="button" onClick={() => onCreateFile(item.path)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" title={`New file in ${name}`}><Plus size={10} /></button>
                <button type="button" onClick={() => onCreateFolder(item.path)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" title={`New folder in ${name}`}><FolderPlus size={10} /></button>
                <button type="button" onClick={() => onRename(item.path, name)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" title="Rename"><Pencil size={10} /></button>
                <button type="button" onClick={() => onDelete(item)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-red-500/10 disabled:opacity-30" title="Delete"><Trash2 size={10} /></button>
              </div>
            </div>
            {isExpanded && renderDir(item.path, depth + 1)}
          </div>
        );
      }

      return (
        <div key={item.path} className="group flex items-center" style={{ paddingLeft: indent + 16 }}>
          <button
            type="button"
            onClick={() => onOpen(item.path)}
            className="flex flex-1 items-center gap-1 py-1 pr-1 text-left transition hover:bg-white/4"
            style={{ color: isActive ? "#9b4dff" : "var(--text-secondary)" }}
          >
            <FileText size={11} style={{ color: isActive ? "#9b4dff" : "var(--text-muted)" }} />
            <span className="truncate text-[11px]" style={{ fontWeight: isActive ? 700 : 400 }}>{name}</span>
            {item.gitStatus && <GitBadge status={item.gitStatus} />}
          </button>
          <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
            <button type="button" onClick={() => onRename(item.path, name)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30" title="Rename"><Pencil size={10} /></button>
            <button type="button" onClick={() => onDelete(item)} disabled={!writeAccess} className="rounded p-0.5 hover:bg-red-500/10 disabled:opacity-30" title="Delete"><Trash2 size={10} /></button>
          </div>
        </div>
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

function GitBadge({ status }: { status: NonNullable<FileEntry["gitStatus"]> }) {
  const colors = GIT_BADGE_COLORS[status];
  return (
    <span
      className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded text-[7px] font-black"
      style={{ backgroundColor: colors.bg, color: colors.color }}
      title={colors.label}
    >
      {status}
    </span>
  );
}
