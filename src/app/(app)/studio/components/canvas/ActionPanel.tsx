"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Folder, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { ArtifactAction } from "@/lib/canvas/types";
import {
  PANEL_ACTION_CATEGORIES,
  resolvePanelActionAvailability,
  type PanelActionAvailability,
  type PanelActionCategory,
  type PanelActionDefinition,
} from "@/lib/canvas/panel-actions";

interface ActionPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  onActionSelect: (action: ArtifactAction) => void;
}

const RECENT_KEY = "litt-action-panel-recent";
const MAX_RECENT = 3;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {
    // Storage unavailable — recents just won't persist.
  }
}

/**
 * ActionPanel — the "What LiTT can do" menu for the Studio canvas.
 *
 * Renders as a bottom-anchored sheet inside the canvas container (absolute
 * overlay), so it works both in the desktop split-pane and inside the
 * mobile bottom sheet. Thumb-zone friendly: category pills scroll
 * horizontally, actions are a 2-column card grid.
 */
export function ActionPanel({ open, onClose, projectId, onActionSelect }: ActionPanelProps) {
  const [resolved, setResolved] = useState<
    { def: PanelActionDefinition; availability: PanelActionAvailability }[] | null
  >(null);
  const [activeCategory, setActiveCategory] = useState<PanelActionCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  /** Non-null when drilled into the file tree: the directory being browsed. */
  const [browseDir, setBrowseDir] = useState<string | null>(null);

  // Resolve availability each time the panel opens (readiness can change).
  useEffect(() => {
    if (!open) return;
    setResolved(null);
    setSearchQuery("");
    setActiveCategory("all");
    setBrowseDir(null);
    setRecentIds(readRecent());
    let cancelled = false;
    void resolvePanelActionAvailability({ projectId }).then((items) => {
      if (!cancelled) setResolved(items);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    if (!resolved) return [];
    const q = searchQuery.trim().toLowerCase();
    return resolved.filter(({ def }) => {
      if (activeCategory !== "all" && def.category !== activeCategory) return false;
      if (q && !`${def.label} ${def.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [resolved, activeCategory, searchQuery]);

  const recentItems = useMemo(() => {
    if (!resolved || searchQuery.trim() || activeCategory !== "all") return [];
    const byId = new Map(resolved.map((r) => [r.def.id, r]));
    return recentIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  }, [resolved, recentIds, searchQuery, activeCategory]);

  if (!open) return null;

  const handleSelect = (def: PanelActionDefinition) => {
    // The file tree is a drill-in sub-view inside the panel, not an
    // immediately-executed action: show the real file list first.
    if (def.id === "browse_files") {
      setRecentIds((prev) => {
        const next = [def.id, ...prev.filter((id) => id !== def.id)].slice(0, MAX_RECENT);
        writeRecent(next);
        return next;
      });
      setBrowseDir(".");
      return;
    }
    let action: ArtifactAction;
    try {
      action = def.buildAction({ projectId });
    } catch {
      return;
    }
    setRecentIds((prev) => {
      const next = [def.id, ...prev.filter((id) => id !== def.id)].slice(0, MAX_RECENT);
      writeRecent(next);
      return next;
    });
    onActionSelect(action);
    onClose();
  };

  const handleOpenFile = (path: string) => {
    if (!projectId) return;
    onActionSelect({ type: "studio.open_file", projectId, path });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="What LiTT can do">
      {/* Backdrop */}
      <button
        aria-label="Close action panel"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      {/* Sheet */}
      <div className="relative flex max-h-[62vh] w-full flex-col rounded-t-2xl border-t border-white/10 bg-[#14141a] shadow-2xl">
        {/* Handle + header */}
        <div className="flex items-center justify-between px-4 pb-1 pt-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">What LiTT can do</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/15" aria-hidden="true" />

        {browseDir !== null && projectId ? (
          <FileTreeView
            projectId={projectId}
            dir={browseDir}
            onNavigate={setBrowseDir}
            onBackToActions={() => setBrowseDir(null)}
            onOpenFile={handleOpenFile}
          />
        ) : (
          <>
        {/* Search */}
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5">
            <Search size={14} className="shrink-0 text-white/40" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions…"
              aria-label="Search actions"
              className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2.5" role="tablist" aria-label="Action categories">
          {PANEL_ACTION_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              role="tab"
              aria-selected={activeCategory === cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === cat.id
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:text-white/80",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
          {resolved === null ? (
            <div className="grid grid-cols-2 gap-2" aria-label="Loading actions">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-xl border border-white/5 bg-white/5" />
              ))}
            </div>
          ) : (
            <>
              {recentItems.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                    Recent
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {recentItems.map(({ def, availability }) => (
                      <ActionCard key={def.id} def={def} availability={availability} onSelect={handleSelect} />
                    ))}
                  </div>
                </div>
              )}
              {visible.length === 0 ? (
                <div className="py-8 text-center text-sm text-white/35">
                  No actions match{searchQuery ? ` “${searchQuery}”` : ""}.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {visible.map(({ def, availability }) => (
                    <ActionCard key={def.id} def={def} availability={availability} onSelect={handleSelect} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function ActionCard({
  def,
  availability,
  onSelect,
}: {
  def: PanelActionDefinition;
  availability: PanelActionAvailability;
  onSelect: (def: PanelActionDefinition) => void;
}) {
  const Icon = def.icon;
  const disabled = !availability.available;
  return (
    <button
      onClick={() => onSelect(def)}
      disabled={disabled}
      title={disabled ? availability.reason : def.description}
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-3 text-left transition-all",
        disabled
          ? "cursor-not-allowed border-white/5 bg-white/[0.02] opacity-55"
          : "border-white/10 bg-white/5 hover:border-accent/40 hover:bg-accent/10 active:scale-[0.98]",
      )}
    >
      <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", disabled ? "bg-white/5 text-white/35" : "bg-accent/15 text-accent")}>
        <Icon size={15} />
      </span>
      <span className="text-[13px] font-semibold text-white">{def.label}</span>
      <span className="line-clamp-2 text-[11px] leading-4 text-white/45">
        {disabled && availability.reason ? availability.reason : def.description}
      </span>
    </button>
  );
}

interface FileTreeEntry {
  name: string;
  type: "file" | "folder";
}

/**
 * FileTreeView — the "Browse files" drill-in sub-view.
 *
 * Lists the project's real files through the existing
 * GET /api/studio-projects/[projectId]/files?path= route (the same
 * mechanism the dock Files tab uses — no new API). Folders drill down,
 * files hand their path back so the panel can execute studio.open_file.
 * Only entries the server actually returns are shown; loading, empty,
 * and error states are real, never placeholders.
 */
function FileTreeView({
  projectId,
  dir,
  onNavigate,
  onBackToActions,
  onOpenFile,
}: {
  projectId: string;
  dir: string;
  onNavigate: (dir: string) => void;
  onBackToActions: () => void;
  onOpenFile: (path: string) => void;
}) {
  const { getToken } = useClerkAuth();
  const [entries, setEntries] = useState<FileTreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    void (async () => {
      try {
        const token = await getToken?.();
        const res = await fetch(
          `/api/studio-projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(dir)}`,
          {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: AbortSignal.timeout(20_000),
          },
        );
        const payload = (await res.json().catch(() => null)) as {
          entries?: unknown;
          error?: unknown;
        } | null;
        if (!res.ok) {
          throw new Error(
            typeof payload?.error === "string"
              ? payload.error
              : `Couldn't list files (${res.status})`,
          );
        }
        const list = Array.isArray(payload?.entries)
          ? payload.entries
              .flatMap((entry): FileTreeEntry[] => {
                if (!entry || typeof entry !== "object") return [];
                const raw = entry as { name?: unknown; type?: unknown };
                if (
                  typeof raw.name !== "string" ||
                  (raw.type !== "file" && raw.type !== "folder")
                ) {
                  return [];
                }
                // Entry names are single path segments; anything else is rejected.
                if (
                  raw.name === "" ||
                  raw.name === "." ||
                  raw.name === ".." ||
                  raw.name.includes("/") ||
                  raw.name.includes("\\") ||
                  raw.name.includes("\0")
                ) {
                  return [];
                }
                return [{ name: raw.name, type: raw.type }];
              })
              .sort((a, b) =>
                a.type === b.type
                  ? a.name.localeCompare(b.name)
                  : a.type === "folder"
                    ? -1
                    : 1,
              )
          : [];
        if (!cancelled) setEntries(list);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't list files");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, dir, getToken, reloadKey]);

  const slash = dir.lastIndexOf("/");
  const parentDir = dir === "." ? null : slash === -1 ? "." : dir.slice(0, slash) || ".";
  const goBack = () => {
    if (parentDir === null) onBackToActions();
    else onNavigate(parentDir);
  };

  return (
    <>
      {/* Sub-view header */}
      <div className="flex items-center gap-2 px-4 pb-2.5">
        <button
          onClick={goBack}
          aria-label={parentDir === null ? "Back to actions" : parentDir === "." ? "Back to project root" : `Back to ${parentDir}`}
          className="rounded-full p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="shrink-0 text-sm font-semibold text-white">Files</span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/40">
          {dir === "." ? "project root" : dir}
        </span>
      </div>

      {/* File list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5" aria-label="Project files">
        {entries === null && !error ? (
          <div className="flex flex-col gap-1.5" aria-label="Loading files">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg border border-white/5 bg-white/5" />
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-6 text-center">
            <p className="text-[13px] text-red-200/90">{error}</p>
            <button
              onClick={() => setReloadKey((k) => k + 1)}
              className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 transition-colors hover:border-accent/40 hover:text-white"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        ) : (entries ?? []).length === 0 ? (
          <div className="py-8 text-center text-sm text-white/35">No files in this folder.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {(entries ?? []).map((entry) => {
              const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
              const isFolder = entry.type === "folder";
              return (
                <li key={entry.name}>
                  <button
                    onClick={() => (isFolder ? onNavigate(path) : onOpenFile(path))}
                    aria-label={isFolder ? `Open folder ${entry.name}` : `Open file ${path}`}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-accent/30 hover:bg-accent/10 active:scale-[0.99]"
                  >
                    {isFolder ? (
                      <Folder size={15} className="shrink-0 text-accent/80" />
                    ) : (
                      <FileText size={15} className="shrink-0 text-white/45" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white">
                      {entry.name}
                    </span>
                    {isFolder && <ChevronRight size={14} className="shrink-0 text-white/30" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
