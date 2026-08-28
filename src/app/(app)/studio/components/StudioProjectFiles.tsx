"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useStudioContext } from "../context/StudioContext";

interface FileEntry {
  name: string;
  type: "file" | "folder";
  path: string;
  size?: number;
  gitStatus?: "M" | "A" | "D" | "U" | "C";
}

/** Git status badge colors: M=yellow, A=green, D=red, U=blue, C=cyan */
const GIT_BADGE_COLORS: Record<NonNullable<FileEntry["gitStatus"]>, { bg: string; color: string; label: string }> = {
  M: { bg: "rgba(227,179,65,0.15)", color: "#e3b341", label: "Modified" },
  A: { bg: "rgba(114,242,56,0.15)", color: "#72f238", label: "Added" },
  D: { bg: "rgba(239,68,68,0.15)", color: "#ef4444", label: "Deleted" },
  U: { bg: "rgba(96,165,250,0.15)", color: "#60a5fa", label: "Untracked" },
  C: { bg: "rgba(34,211,238,0.15)", color: "#22d3ee", label: "Conflict" },
};

function GitBadge({ status }: { status: NonNullable<FileEntry["gitStatus"]> }) {
  const colors = GIT_BADGE_COLORS[status];
  return (
    <span
      className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[7px] font-black"
      style={{ backgroundColor: colors.bg, color: colors.color }}
      title={colors.label}
      aria-label={`Git: ${colors.label}`}
    >
      {status}
    </span>
  );
}

type DialogState =
  | { kind: "file" | "folder"; directory: string; value: string }
  | { kind: "rename"; sourcePath: string; value: string }
  | null;

type MutationAction = "write" | "delete" | "mkdir" | "rename";

const TEXT_EXTENSIONS = new Set([
  "astro",
  "css",
  "csv",
  "env",
  "html",
  "jsx",
  "json",
  "md",
  "mdx",
  "mjs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "yaml",
  "yml",
]);

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

function joinPath(directory: string, name: string): string {
  const cleanName = name.trim();
  if (!cleanName || cleanName === "." || cleanName === ".." || /[\\/\0]/.test(cleanName)) {
    throw new Error("Use a single valid file or folder name");
  }
  const base = directory === "." ? "" : normalizePath(directory);
  return base ? `${base}/${cleanName}` : cleanName;
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

function isTextFile(path: string): boolean {
  const name = baseName(path);
  if (["Dockerfile", "LICENSE", "Makefile", "README"].includes(name) || name.startsWith(".env")) return true;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}

function formatSize(size?: number): string {
  if (typeof size !== "number") return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StudioProjectFiles({
  projectId,
  repositoryName,
  branch,
  workspaceStatus,
  writeAccess,
  onSaved,
  onMutation,
  onWorkspacePrepared,
}: {
  projectId: string | null;
  repositoryName: string | null;
  branch: string | null;
  workspaceStatus: string | null;
  writeAccess: boolean;
  onSaved?: () => void;
  onMutation?: () => void;
  onWorkspacePrepared?: () => void;
}) {
  const { getToken } = useClerkAuth();
  const { setActiveFile } = useStudioContext();
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupportedPath, setUnsupportedPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const dirty = activePath !== null && content !== originalContent;

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
      headers: {
        ...(await authHeaders(Boolean(init?.body))),
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : `Request failed (${response.status})`);
    }
    return payload;
  }, [authHeaders]);

  const loadDirectory = useCallback(async (directory: string, silent = false) => {
    if (!projectId) return;
    const safeDirectory = normalizePath(directory);
    if (!silent) setLoading(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(safeDirectory)}`);
      if (!payload || !Array.isArray(payload.entries)) throw new Error("Malformed file-tree response");
      const nextEntries = payload.entries.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const raw = entry as { name?: unknown; type?: unknown; size?: unknown };
        if (typeof raw.name !== "string" || (raw.type !== "file" && raw.type !== "folder")) return [];
        return [{
          name: raw.name,
          type: raw.type,
          size: typeof raw.size === "number" ? raw.size : undefined,
          path: safeDirectory === "." ? raw.name : `${safeDirectory}/${raw.name}`,
        } satisfies FileEntry];
      }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
      setEntries((current) => ({ ...current, [safeDirectory]: nextEntries }));
    } catch (loadError) {
      const msg = loadError instanceof Error ? loadError.message : "Failed to load project files";
      // Auto-recover on any files endpoint failure, not just workspace-state
      // errors. A 500 from /ws-files often means the terminal-server lost the
      // workspace root or the workspace was evicted; treat it as recoverable.
      const recoverable =
        msg.includes("Workspace") ||
        response.status === 500 ||
        response.status === 503;
      if (recoverable && !preparing) {
        setPreparing(true);
        try {
          const prepPayload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`, { method: "POST" });
          if (prepPayload && prepPayload.workspaceStatus === "ready") {
            onWorkspacePrepared?.();
            const retryPayload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(safeDirectory)}`);
            if (retryPayload && Array.isArray(retryPayload.entries)) {
              const retryEntries = retryPayload.entries.flatMap((entry) => {
                if (!entry || typeof entry !== "object") return [];
                const raw = entry as { name?: unknown; type?: unknown; size?: unknown };
                if (typeof raw.name !== "string" || (raw.type !== "file" && raw.type !== "folder")) return [];
                return [{
                  name: raw.name,
                  type: raw.type,
                  size: typeof raw.size === "number" ? raw.size : undefined,
                  path: safeDirectory === "." ? raw.name : `${safeDirectory}/${raw.name}`,
                } satisfies FileEntry];
              }).sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1);
              setEntries((current) => ({ ...current, [safeDirectory]: retryEntries }));
              return;
            }
          }
          const prepErr = typeof prepPayload?.error === "string" ? prepPayload.error : "Workspace re-preparation failed. Click Prepare to retry.";
          setError(prepErr);
        } catch {
          setError("Workspace was lost and could not be re-prepared automatically. Click Prepare to retry.");
        } finally {
          setPreparing(false);
        }
      } else {
        setError(msg);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [projectId, requestJson, preparing, onWorkspacePrepared]);

  useEffect(() => {
    setEntries({});
    setExpanded(new Set());
    setActivePath(null);
    setActiveFile(null); // Clear canonical activeFile on project change
    setContent("");
    setOriginalContent("");
    setUnsupportedPath(null);
    setError(null);
    if (projectId) {
      // Always try to load — the files route will auto-recover if the
      // workspace was lost on the terminal server.
      void loadDirectory(".");
    }
  }, [projectId, loadDirectory]);

  const prepareWorkspace = useCallback(async () => {
    if (!projectId || preparing) return;
    setPreparing(true);
    setError(null);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/workspace/prepare`, { method: "POST" });
      if (!payload || payload.workspaceStatus !== "ready") throw new Error("Workspace preparation did not complete");
      onWorkspacePrepared?.();
      await loadDirectory(".");
    } catch (prepareError) {
      setError(prepareError instanceof Error ? prepareError.message : "Workspace preparation failed");
    } finally {
      setPreparing(false);
    }
  }, [loadDirectory, onWorkspacePrepared, preparing, projectId, requestJson]);

  const refresh = useCallback(async () => {
    setEntries({});
    setExpanded(new Set());
    await loadDirectory(".");
  }, [loadDirectory]);

  // Listen for Canvas Accept events — refresh file tree when Canvas writes files
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        void refresh();
      }
    };
    window.addEventListener("studio:files-changed", handler);
    return () => window.removeEventListener("studio:files-changed", handler);
  }, [projectId, refresh]);

  const toggleFolder = useCallback(async (entry: FileEntry) => {
    if (entry.type !== "folder") return;
    if (expanded.has(entry.path)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(entry.path);
        return next;
      });
      return;
    }
    setExpanded((current) => new Set(current).add(entry.path));
    if (!entries[entry.path]) await loadDirectory(entry.path);
  }, [entries, expanded, loadDirectory]);

  const openFile = useCallback(async (entry: FileEntry) => {
    if (entry.type !== "file") return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setActivePath(entry.path);
    setActiveFile(entry.path); // Drive canonical StudioContext.activeFile
    setUnsupportedPath(null);
    setError(null);
    if (!isTextFile(entry.path)) {
      setContent("");
      setOriginalContent("");
      setUnsupportedPath(entry.path);
      return;
    }
    setFileLoading(true);
    try {
      const payload = await requestJson(`/api/studio-projects/${encodeURIComponent(projectId ?? "")}/files`, {
        method: "POST",
        body: JSON.stringify({ action: "read", path: normalizePath(entry.path) }),
      });
      if (!payload || typeof payload.content !== "string") throw new Error("Malformed file response");
      setContent(payload.content);
      setOriginalContent(payload.content);
    } catch (readError) {
      setContent("");
      setOriginalContent("");
      setError(readError instanceof Error ? readError.message : "Failed to open file");
    } finally {
      setFileLoading(false);
    }
  }, [dirty, projectId, requestJson]);

  const mutate = useCallback(async (action: MutationAction, body: Record<string, unknown>) => {
    if (!projectId) throw new Error("No project selected");
    if (!writeAccess) throw new Error("Workspace writes are unavailable until the project workspace is ready");
    await requestJson(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
      method: "POST",
      body: JSON.stringify({ action, ...body }),
    });
    onMutation?.();
  }, [onMutation, projectId, requestJson, writeAccess]);

  const saveFile = useCallback(async () => {
    if (!activePath || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await mutate("write", { path: normalizePath(activePath), content });
      setOriginalContent(content);
      await loadDirectory(parentPath(activePath), true);
      onSaved?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [activePath, content, dirty, loadDirectory, mutate, onSaved]);

  const submitDialog = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dialog) return;
    setError(null);
    try {
      if (dialog.kind === "file") {
        const path = joinPath(dialog.directory, dialog.value);
        await mutate("write", { path, content: "" });
        await loadDirectory(dialog.directory, true);
        setDialog(null);
        onSaved?.();
      } else if (dialog.kind === "folder") {
        const path = joinPath(dialog.directory, dialog.value);
        await mutate("mkdir", { path });
        await loadDirectory(dialog.directory, true);
        setDialog(null);
      } else if (dialog.kind === "rename") {
        const path = normalizePath(dialog.sourcePath);
        const newPath = joinPath(parentPath(path), dialog.value);
        await mutate("rename", { path, newPath });
        await loadDirectory(parentPath(path), true);
        if (activePath === path) setActivePath(newPath);
        setDialog(null);
      }
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "File operation failed");
    }
  }, [activePath, dialog, loadDirectory, mutate, onSaved]);

  const deleteEntry = useCallback(async (entry: FileEntry) => {
    if (!window.confirm(`Delete ${entry.path}? This cannot be undone.`)) return;
    setError(null);
    try {
      await mutate("delete", { path: normalizePath(entry.path) });
      await loadDirectory(parentPath(entry.path), true);
      if (activePath === entry.path || activePath?.startsWith(`${entry.path}/`)) {
        setActivePath(null);
        setContent("");
        setOriginalContent("");
        setUnsupportedPath(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete path");
    }
  }, [activePath, loadDirectory, mutate]);

  const renderEntries = (directory: string, depth = 0): React.ReactNode => {
    const list = entries[directory] ?? [];
    return list.map((entry) => {
      const isOpen = expanded.has(entry.path);
      return (
        <div key={entry.path}>
          <div className="group flex min-w-0 items-center gap-1 rounded-lg hover:bg-white/5" style={{ paddingLeft: `${Math.min(depth, 5) * 10 + 2}px` }}>
            <button
              type="button"
              onClick={() => entry.type === "folder" ? void toggleFolder(entry) : void openFile(entry)}
              className="flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left text-[10px]"
              style={{ color: activePath === entry.path ? "var(--litt-primary)" : "var(--text-secondary)" }}
              title={entry.path}
            >
              {entry.type === "folder" ? (isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
              {entry.type === "folder" ? <Folder size={13} /> : <FileText size={13} />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.gitStatus && <GitBadge status={entry.gitStatus} />}
              {entry.type === "file" && <span className="hidden shrink-0 text-[8px] text-white/30 xl:inline">{formatSize(entry.size)}</span>}
            </button>
            {entry.type === "folder" && <>
              <button type="button" onClick={() => setDialog({ kind: "file", directory: entry.path, value: "" })} disabled={!writeAccess} className="grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-0 transition hover:bg-white/10 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Create file in ${entry.name}`} title={`Create file in ${entry.name}`}><Plus size={11} /></button>
              <button type="button" onClick={() => setDialog({ kind: "folder", directory: entry.path, value: "" })} disabled={!writeAccess} className="grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-0 transition hover:bg-white/10 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Create folder in ${entry.name}`} title={`Create folder in ${entry.name}`}><FolderPlus size={11} /></button>
            </>}
            <button type="button" onClick={() => setDialog({ kind: "rename", sourcePath: entry.path, value: entry.name })} disabled={!writeAccess} className="grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-0 transition hover:bg-white/10 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Rename ${entry.name}`} title="Rename">
              <Pencil size={11} />
            </button>
            <button type="button" onClick={() => void deleteEntry(entry)} disabled={!writeAccess} className="grid h-9 w-9 shrink-0 place-items-center rounded-md opacity-0 transition hover:bg-red-500/10 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Delete ${entry.name}`} title="Delete">
              <Trash2 size={11} />
            </button>
          </div>
          {entry.type === "folder" && isOpen && renderEntries(entry.path, depth + 1)}
        </div>
      );
    });
  };

  if (!projectId) {
    return <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-[10px]" style={{ color: "var(--text-muted)" }}>Select a project to browse files.</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="studio-project-files">
      <div className="flex shrink-0 items-start gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
        <Folder size={14} className="mt-0.5 shrink-0" style={{ color: "var(--litt-primary)" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{repositoryName ?? "Project workspace"}</div>
          <div className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>{branch ?? "Branch unavailable"} · workspace {workspaceStatus ?? "unknown"}</div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-40" aria-label="Refresh project files" title="Refresh">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {workspaceStatus !== "ready" && <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[9px] leading-4" style={{ borderColor: "rgba(227,179,65,0.25)", backgroundColor: "rgba(227,179,65,0.06)", color: "#e3b341" }}><span className="min-w-0 flex-1">Workspace is {workspaceStatus ?? "not prepared"}. Prepare it before browsing project files.</span><button type="button" onClick={() => void prepareWorkspace()} disabled={preparing || workspaceStatus === "provisioning" || workspaceStatus === "preparing"} className="flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 font-bold disabled:opacity-40" style={{ backgroundColor: "#e3b341", color: "#000" }}>{preparing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Prepare</button></div>}
      {workspaceStatus === "ready" && !writeAccess && <div className="rounded-lg border px-2.5 py-2 text-[9px] leading-4" style={{ borderColor: "rgba(227,179,65,0.25)", backgroundColor: "rgba(227,179,65,0.06)", color: "#e3b341" }}>Editing is unavailable because this workspace is read-only. The server will continue to enforce project ownership and mutation permissions.</div>}
      {error && <div className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[9px] leading-4" style={{ borderColor: "rgba(239,68,68,0.3)", backgroundColor: "rgba(239,68,68,0.06)", color: "#fca5a5" }}><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss file error"><X size={12} /></button></div>}

      {dialog && (
        <form onSubmit={submitDialog} className="flex shrink-0 items-center gap-1.5 rounded-lg border p-1.5" style={{ borderColor: "var(--studio-border)" }}>
          <span className="min-w-0 flex-1 truncate px-1 text-[9px]" style={{ color: "var(--text-muted)" }}>{dialog.kind === "rename" ? `Rename ${baseName(dialog.sourcePath)}` : dialog.kind === "folder" ? "New folder" : "New file"}</span>
          <input autoFocus value={dialog.value} onChange={(event) => setDialog({ ...dialog, value: event.target.value })} className="min-w-0 flex-[1.5] rounded-md border bg-transparent px-2 py-2 text-[10px] outline-none" style={{ borderColor: "var(--studio-border)", color: "var(--text-primary)" }} aria-label="File or folder name" />
          <button type="submit" className="grid h-9 w-9 place-items-center rounded-md" style={{ backgroundColor: "var(--litt-primary)", color: "#000" }} aria-label="Confirm file operation"><Save size={12} /></button>
          <button type="button" onClick={() => setDialog(null)} className="grid h-9 w-9 place-items-center rounded-md hover:bg-white/8" style={{ color: "var(--text-muted)" }} aria-label="Cancel file operation"><X size={12} /></button>
        </form>
      )}

      <div className="flex shrink-0 items-center gap-1 overflow-x-auto rounded-lg border p-1" style={{ borderColor: "var(--studio-border)" }}>
        <button type="button" onClick={() => setDialog({ kind: "file", directory: ".", value: "" })} disabled={!writeAccess} className="flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[9px] font-bold hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35" title="Create file"><Plus size={12} /> File</button>
        <button type="button" onClick={() => setDialog({ kind: "folder", directory: ".", value: "" })} disabled={!writeAccess} className="flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[9px] font-bold hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35" title="Create folder"><FolderPlus size={12} /> Folder</button>
        <span className="ml-auto shrink-0 px-1 text-[9px]" style={{ color: "var(--text-muted)" }}>{loading ? "Loading…" : `${Object.values(entries).flat().length} loaded`}</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-[minmax(130px,0.8fr)_minmax(0,1.7fr)]">
        <div className="min-h-28 overflow-y-auto rounded-xl border p-1.5 xl:min-h-0" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          {loading && !entries["."] ? <div className="flex items-center gap-2 px-2 py-3 text-[10px]" style={{ color: "var(--text-muted)" }}><Loader2 size={12} className="animate-spin" /> Loading files…</div> : entries["."]?.length ? renderEntries(".") : <div className="px-2 py-3 text-[10px]" style={{ color: "var(--text-muted)" }}>No files found.</div>}
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          {activePath ? (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-2" style={{ borderColor: "var(--studio-border)" }}>
                <FileText size={12} style={{ color: "var(--litt-primary)" }} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{activePath}</span>
                {dirty && <span className="shrink-0 text-[9px] font-bold" style={{ color: "#e3b341" }}>Unsaved</span>}
                <button type="button" onClick={() => void saveFile()} disabled={!dirty || saving || !writeAccess || Boolean(unsupportedPath)} className="flex min-h-10 items-center gap-1 rounded-md px-2 text-[9px] font-bold disabled:cursor-not-allowed disabled:opacity-35" style={{ backgroundColor: dirty && writeAccess ? "var(--litt-primary)" : "var(--studio-surface)", color: dirty && writeAccess ? "#000" : "var(--text-muted)" }}><Save size={11} /> {saving ? "Saving" : "Save"}</button>
              </div>
              {/* Contextual selection actions bar — Explain, Fix, Refactor, Add tests, Ask LiTT */}
              {!unsupportedPath && !fileLoading && (
                <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1" style={{ borderColor: "var(--studio-border)" }}>
                  {[
                    { label: "Explain", prompt: `Explain what ${activePath} does` },
                    { label: "Fix", prompt: `Find and fix bugs in ${activePath}` },
                    { label: "Refactor", prompt: `Refactor ${activePath} for clarity` },
                    { label: "Add tests", prompt: `Add unit tests for ${activePath}` },
                    { label: "Ask LiTT", prompt: `Review ${activePath}` },
                  ].map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent("studio:quick-action", { detail: { prompt: action.prompt } }));
                      }}
                      className="flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[9px] font-bold transition hover:bg-white/8"
                      style={{ color: "var(--text-muted)" }}
                      aria-label={action.label}
                      title={action.prompt}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
              {unsupportedPath ? <div className="flex flex-1 items-center justify-center px-5 text-center text-[10px] leading-5" style={{ color: "var(--text-muted)" }}>This file type is not text-editable in Studio. It remains safe to browse, but binary content is not loaded into the editor.</div> : fileLoading ? <div className="flex flex-1 items-center justify-center gap-2 text-[10px]" style={{ color: "var(--text-muted)" }}><Loader2 size={13} className="animate-spin" /> Opening file…</div> : <textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false} className="min-h-[220px] flex-1 resize-none bg-transparent p-3 font-mono text-[10px] leading-5 outline-none" style={{ color: "var(--text-primary)" }} aria-label={`Edit ${activePath}`} />}
            </>
          ) : <div className="flex flex-1 items-center justify-center px-5 text-center text-[10px] leading-5" style={{ color: "var(--text-muted)" }}>Select a text file to inspect and edit it. Changes stay local until you press Save.</div>}
        </div>
      </div>
    </div>
  );
}
